import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudflaredPath = path.join(rootDir, ".bin", "cloudflared");
const defaultApiOrigin = "http://localhost:3000";
const defaultDashboardOrigin = defaultApiOrigin;
const defaultFrontendOrigin = "http://localhost:3002";
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

type DemoConfig = {
  appName: string;
  creditsPerDollar: number;
  itemDefId: string;
  programId: string;
  firstTimeClaimActionId: string;
  mintItemActionId: string;
  claimRewardsActionId: string;
  webhookUrl: string;
  enableTunnels: boolean;
};

type DemoSession = {
  developerId: string;
  developerEmail: string;
  developerUsername: string;
  developerPassword: string;
  appId: string;
  apiKey: string;
};

const children: ChildProcess[] = [];
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
});

async function main() {
  const config = parseArgs(process.argv.slice(2));

  console.log("Starting Celeris API...");
  const apiProcess = spawnManagedProcess("api", ["node", "--import", "tsx", "celeris/api/index.ts"]);
  await waitForHttp(`${defaultApiOrigin}/apps`);

  console.log("Starting mock developer backend...");
  spawnManagedProcess("mock-developer", ["node", "--import", "tsx", "scripts/mock-developer-backend.ts"]);
  await waitForHttp("http://localhost:3001", { expectJson: false });

  const demoSession = await provisionDemo(config);

  console.log("Starting mock game frontend...");
  spawnManagedProcess("mock-game", [
    "node",
    "--import",
    "tsx",
    "scripts/mock-game-frontend.ts",
    `--app-id=${demoSession.appId}`,
    `--program-id=${config.programId}`,
    `--first-time-claim-action-id=${config.firstTimeClaimActionId}`,
    `--mint-item-action-id=${config.mintItemActionId}`,
    `--claim-rewards-action-id=${config.claimRewardsActionId}`,
    `--item-def-id=${config.itemDefId}`
  ]);
  await waitForHttp(defaultFrontendOrigin, { expectJson: false });

  const stripeMode = await detectStripeMode();

  let apiTunnelUrl: string | null = null;
  let gameTunnelUrl: string | null = null;
  if (config.enableTunnels) {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.log("Warning: STRIPE_SECRET_KEY is not configured. Checkout will stay in mock mode.");
    }

    if (process.env.CLOUDFLARED_TUNNEL_TOKEN) {
      console.log("Starting named cloudflared tunnel...");
      const namedTunnelUrls = await spawnNamedTunnel({
        token: process.env.CLOUDFLARED_TUNNEL_TOKEN,
        dashboardHostname: process.env.CLOUDFLARED_DASHBOARD_HOSTNAME,
        gameHostname: process.env.CLOUDFLARED_GAME_HOSTNAME
      });
      apiTunnelUrl = namedTunnelUrls.dashboardUrl;
      gameTunnelUrl = namedTunnelUrls.gameUrl;
    } else {
      console.log("Starting cloudflared tunnels...");
      apiTunnelUrl = await spawnTunnel("dashboard-tunnel", defaultApiOrigin);
      gameTunnelUrl = await spawnTunnel("game-tunnel", defaultFrontendOrigin);
    }
  }

  const dashboardUrl = buildDashboardUrl(apiTunnelUrl ?? defaultDashboardOrigin, demoSession);

  console.log("");
  console.log("Full demo is ready.");
  console.log("");
  console.log(`Stripe checkout mode: ${stripeMode}`);
  console.log(`Developer username: ${demoSession.developerUsername}`);
  console.log(`Developer password: ${demoSession.developerPassword}`);
  console.log(`Developer email: ${demoSession.developerEmail}`);
  console.log(`App ID: ${demoSession.appId}`);
  console.log(`API key: ${demoSession.apiKey}`);
  console.log(`Mock Solana program ID: ${config.programId}`);
  console.log("");
  console.log("Add the program and actions manually in the developer dashboard before testing player actions.");
  console.log("");
  console.log(`Local dashboard: ${buildDashboardUrl(defaultDashboardOrigin, demoSession)}`);
  console.log(`Local game frontend: ${defaultFrontendOrigin}`);
  if (apiTunnelUrl) {
    console.log(`Public dashboard: ${dashboardUrl}`);
  }
  if (gameTunnelUrl) {
    console.log(`Public game frontend: ${gameTunnelUrl}`);
  }
  console.log("");
  console.log("Press Ctrl+C to stop all demo services.");

  await waitForever(apiProcess);
}

function parseArgs(args: string[]): DemoConfig {
  const config: DemoConfig = {
    appName: "Celeris Demo Game",
    creditsPerDollar: 500,
    itemDefId: "iron_sword",
    programId: createMockSolanaProgramId(),
    firstTimeClaimActionId: "first_time_claim",
    mintItemActionId: "mint_item",
    claimRewardsActionId: "claim_rewards",
    webhookUrl: "http://localhost:3001",
    enableTunnels: true
  };

  for (const arg of args) {
    if (arg === "--no-tunnel") {
      config.enableTunnels = false;
      continue;
    }
    if (arg.startsWith("--app-name=")) {
      config.appName = arg.slice("--app-name=".length);
      continue;
    }
    if (arg.startsWith("--credits-per-dollar=")) {
      config.creditsPerDollar = Number(arg.slice("--credits-per-dollar=".length));
      continue;
    }
    if (arg.startsWith("--program-id=")) {
      config.programId = arg.slice("--program-id=".length);
      continue;
    }
    if (arg.startsWith("--first-time-claim-action-id=")) {
      config.firstTimeClaimActionId = arg.slice("--first-time-claim-action-id=".length);
      continue;
    }
    if (arg.startsWith("--mint-item-action-id=")) {
      config.mintItemActionId = arg.slice("--mint-item-action-id=".length);
      continue;
    }
    if (arg.startsWith("--claim-rewards-action-id=")) {
      config.claimRewardsActionId = arg.slice("--claim-rewards-action-id=".length);
      continue;
    }
    if (arg.startsWith("--item-def-id=")) {
      config.itemDefId = arg.slice("--item-def-id=".length);
      continue;
    }
    if (arg.startsWith("--webhook-url=")) {
      config.webhookUrl = arg.slice("--webhook-url=".length);
    }
  }

  return config;
}

function spawnManagedProcess(name: string, args: string[]) {
  const child = spawn(args[0], args.slice(1), {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);

  child.stdout?.on("data", (chunk) => {
    writePrefixed(name, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    writePrefixed(name, chunk);
  });
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.log(`[${name}] exited with ${reason}`);
  });

  return child;
}

function writePrefixed(name: string, chunk: Buffer | string) {
  const lines = String(chunk).split(/\r?\n/);
  for (const line of lines) {
    if (!line) {
      continue;
    }
    console.log(`[${name}] ${line}`);
  }
}

async function waitForHttp(url: string, { expectJson = true }: { expectJson?: boolean } = {}) {
  const start = Date.now();
  let lastError = "not started";
  while (Date.now() - start < 30_000) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        if (expectJson) {
          await response.text();
        }
        return;
      }
      lastError = `unexpected status ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function provisionDemo(config: DemoConfig): Promise<DemoSession> {
  const credentialSuffix = randomUUID().slice(0, 8);
  const developerUsername = `demo-dev-${credentialSuffix}`;
  const developerPassword = `demo-pass-${credentialSuffix}`;
  const developerId = `dev-${randomUUID()}`;

  const developerSession = await postJson("/developer/sign-up", {
    username: developerUsername,
    password: developerPassword,
    developerId
  });
  const app = await postJson("/apps", {
    developerId: developerSession.developerId,
    name: config.appName,
    priceCents: 100,
    credits: config.creditsPerDollar,
    webhookUrl: config.webhookUrl
  });

  return {
    developerId: developerSession.developerId,
    developerEmail: developerSession.email,
    developerUsername,
    developerPassword,
    appId: app.appId,
    apiKey: app.apiKey
  };
}

async function postJson(pathname: string, body: Record<string, unknown>) {
  const response = await fetch(`${defaultApiOrigin}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `full-demo-${randomUUID()}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed for ${pathname}: ${response.status} ${text}`);
  }

  return response.json();
}

async function detectStripeMode() {
  return process.env.STRIPE_SECRET_KEY ? "test" : "mock";
}

async function spawnTunnel(name: string, url: string) {
  const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), `cloudflared-${name}-`));
  const isolatedConfigPath = path.join(isolatedHome, "config.yml");
  await fs.writeFile(isolatedConfigPath, "", "utf8");

  const tunnelEnv = { ...process.env };
  for (const key of Object.keys(tunnelEnv)) {
    if (key.startsWith("TUNNEL_") || key.startsWith("CLOUDFLARED_") || key === "CF_API_TOKEN") {
      delete tunnelEnv[key];
    }
  }
  tunnelEnv.HOME = isolatedHome;
  tunnelEnv.XDG_CONFIG_HOME = isolatedHome;

  const child = spawn(cloudflaredPath, ["tunnel", "--config", isolatedConfigPath, "--url", url], {
    cwd: rootDir,
    env: tunnelEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let lastOutput = "";
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for ${name} public URL.${lastOutput ? ` Last tunnel output: ${lastOutput}` : ""}`));
      }
    }, 30_000);

    const handleChunk = (chunk: Buffer | string) => {
      const text = String(chunk);
      const trimmed = text.trim();
      if (trimmed) {
        lastOutput = trimmed.split(/\r?\n/).slice(-3).join(" | ");
      }
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);
    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `${name} exited before publishing a URL (${signal ?? code ?? "unknown"}).${lastOutput ? ` Last tunnel output: ${lastOutput}` : ""}`
          )
        );
      }
    });
  });
}

async function spawnNamedTunnel({
  token,
  dashboardHostname,
  gameHostname
}: {
  token: string;
  dashboardHostname?: string;
  gameHostname?: string;
}) {
  if (!dashboardHostname || !gameHostname) {
    throw new Error(
      "Named tunnel mode requires CLOUDFLARED_DASHBOARD_HOSTNAME and CLOUDFLARED_GAME_HOSTNAME."
    );
  }

  const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "cloudflared-named-"));
  const isolatedConfigPath = path.join(isolatedHome, "config.yml");
  const configSource = [
    "ingress:",
    `  - hostname: ${dashboardHostname}`,
    `    service: ${defaultApiOrigin}`,
    `  - hostname: ${gameHostname}`,
    `    service: ${defaultFrontendOrigin}`,
    "  - service: http_status:404",
    ""
  ].join("\n");
  await fs.writeFile(isolatedConfigPath, configSource, "utf8");

  const tunnelEnv = { ...process.env };
  for (const key of Object.keys(tunnelEnv)) {
    if (key.startsWith("TUNNEL_") || key.startsWith("CLOUDFLARED_") || key === "CF_API_TOKEN") {
      delete tunnelEnv[key];
    }
  }
  tunnelEnv.HOME = isolatedHome;
  tunnelEnv.XDG_CONFIG_HOME = isolatedHome;

  const child = spawn(
    cloudflaredPath,
    ["tunnel", "--config", isolatedConfigPath, "run", "--token", token],
    {
      cwd: rootDir,
      env: tunnelEnv,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  children.push(child);

  return await new Promise<{ dashboardUrl: string; gameUrl: string }>((resolve, reject) => {
    let settled = false;
    let lastOutput = "";
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Timed out waiting for named tunnel to start.${lastOutput ? ` Last tunnel output: ${lastOutput}` : ""}`
          )
        );
      }
    }, 30_000);

    const handleChunk = (chunk: Buffer | string) => {
      const text = String(chunk);
      const trimmed = text.trim();
      if (trimmed) {
        lastOutput = trimmed.split(/\r?\n/).slice(-3).join(" | ");
      }
      if (text.includes("Registered tunnel connection") && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          dashboardUrl: `https://${dashboardHostname}`,
          gameUrl: `https://${gameHostname}`
        });
      }
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);
    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `Named tunnel exited before becoming ready (${signal ?? code ?? "unknown"}).${
              lastOutput ? ` Last tunnel output: ${lastOutput}` : ""
            }`
          )
        );
      }
    });
  });
}

function buildDashboardUrl(base: string, demoSession: DemoSession) {
  const url = new URL(base);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/";
  }
  url.searchParams.set("demoUsername", demoSession.developerUsername);
  url.searchParams.set("demoPassword", demoSession.developerPassword);
  url.searchParams.set("developerId", demoSession.developerId);
  url.searchParams.set("appId", demoSession.appId);
  return url.toString();
}

function createMockSolanaProgramId(length = 44) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += base58Alphabet[Math.floor(Math.random() * base58Alphabet.length)];
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForever(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`API exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(exitCode);
}

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    shutdown(1);
  });
}
