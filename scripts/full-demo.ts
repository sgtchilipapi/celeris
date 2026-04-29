import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudflaredPath = path.join(rootDir, ".bin", "cloudflared");
const defaultApiOrigin = "http://localhost:3000";
const defaultDashboardOrigin = `${defaultApiOrigin}/dashboard`;
const defaultFrontendOrigin = "http://localhost:3002";
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

type DemoConfig = {
  appName: string;
  creditsPerDollar: number;
  actionCost: number;
  itemDefId: string;
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

    console.log("Starting cloudflared tunnels...");
    apiTunnelUrl = await spawnTunnel("dashboard-tunnel", defaultApiOrigin);
    gameTunnelUrl = await spawnTunnel("game-tunnel", defaultFrontendOrigin);
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
    actionCost: 50,
    itemDefId: "iron_sword",
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
    if (arg.startsWith("--action-cost=")) {
      config.actionCost = Number(arg.slice("--action-cost=".length));
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

  await postJson(`/apps/${encodeURIComponent(app.appId)}/actions`, {
    actionType: "mint_item",
    cost: config.actionCost
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
  const child = spawn(cloudflaredPath, ["tunnel", "--url", url], {
    cwd: rootDir,
    env: process.env,
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

function buildDashboardUrl(base: string, demoSession: DemoSession) {
  const url = new URL(base);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/dashboard";
  }
  url.searchParams.set("demoUsername", demoSession.developerUsername);
  url.searchParams.set("demoPassword", demoSession.developerPassword);
  url.searchParams.set("developerId", demoSession.developerId);
  url.searchParams.set("appId", demoSession.appId);
  return url.toString();
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
