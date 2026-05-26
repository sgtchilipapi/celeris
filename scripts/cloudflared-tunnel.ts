import fs from "node:fs";
import { spawn as spawnCallback } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

loadDotEnv(path.join(projectRoot, ".env"));
loadDotEnv(path.join(projectRoot, ".env.local"));

export type CloudflaredTunnelConfig = {
  binaryPath: string;
  tunnelToken: string;
  apiPort: number;
  frontendPort: number;
  authHostname: string | null;
  demoFrontendHostname: string | null;
};

export function parseCloudflaredTunnelArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CloudflaredTunnelConfig {
  let binaryPath = resolveDefaultCloudflaredBinaryPath();
  let tunnelToken = String(env.CLOUDFLARED_TUNNEL_TOKEN ?? "").trim();

  for (const arg of args) {
    if (arg.startsWith("--cloudflared-bin=")) {
      binaryPath = path.resolve(projectRoot, arg.slice("--cloudflared-bin=".length).trim());
      continue;
    }
    if (arg.startsWith("--token=")) {
      tunnelToken = arg.slice("--token=".length).trim();
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!tunnelToken) {
    throw new Error("CLOUDFLARED_TUNNEL_TOKEN is required");
  }
  if (binaryPath.includes(path.sep) && !fs.existsSync(binaryPath)) {
    throw new Error(`cloudflared binary was not found at ${binaryPath}`);
  }

  return {
    binaryPath,
    tunnelToken,
    apiPort: Number(env.PORT ?? 3000),
    frontendPort: Number(env.MOCK_GAME_FRONTEND_PORT ?? 3002),
    authHostname: normalizeHostname(env.CLOUDFLARED_AUTH_HOSTNAME),
    demoFrontendHostname: normalizeHostname(env.CLOUDFLARED_DEMO_FRONTEND_HOSTNAME)
  };
}

export function buildCloudflaredTunnelCommand(
  config: CloudflaredTunnelConfig,
  env: NodeJS.ProcessEnv = process.env
): {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  return {
    file: config.binaryPath,
    args: ["tunnel", "run"],
    env: {
      ...env,
      TUNNEL_TOKEN: config.tunnelToken
    }
  };
}

export async function runCloudflaredTunnel(
  config: CloudflaredTunnelConfig,
  {
    spawnImpl = spawnCallback
  }: {
    spawnImpl?: typeof spawnCallback;
  } = {}
) {
  const command = buildCloudflaredTunnelCommand(config);
  printTunnelSummary(config);

  await new Promise<void>((resolve, reject) => {
    const child = spawnImpl(command.file, command.args, {
      cwd: projectRoot,
      env: command.env,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`cloudflared tunnel exited from signal ${signal}`));
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(new Error(`cloudflared tunnel exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function printTunnelSummary(config: CloudflaredTunnelConfig) {
  console.log("Starting Cloudflare tunnel.");
  console.log(`Local auth target: http://localhost:${config.apiPort}`);
  console.log(`Local demo frontend target: http://localhost:${config.frontendPort}`);
  if (config.authHostname) {
    console.log(`Hosted auth hostname: https://${config.authHostname}`);
  }
  if (config.demoFrontendHostname) {
    console.log(`Hosted demo frontend hostname: https://${config.demoFrontendHostname}`);
  }
}

function resolveDefaultCloudflaredBinaryPath() {
  const localBinary = path.join(projectRoot, ".bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(localBinary)) {
    return localBinary;
  }
  return "cloudflared";
}

function normalizeHostname(value: string | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function loadDotEnv(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main() {
  const config = parseCloudflaredTunnelArgs(process.argv.slice(2));
  await runCloudflaredTunnel(config);
}

if (isMainModule) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
