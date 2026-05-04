import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformPrivyConfigFromEnv } from "../celeris/services/privy-auth-service.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(rootDir, ".env"));
loadDotEnv(path.join(rootDir, ".env.local"));

const cloudflaredPath = path.join(rootDir, ".bin", "cloudflared");
const defaultApiOrigin = "http://localhost:3000";
const defaultDashboardOrigin = defaultApiOrigin;
const defaultFrontendOrigin = "http://localhost:3002";
const configuredHostedAuthOrigin = String(process.env.CELERIS_HOSTED_AUTH_ORIGIN ?? defaultApiOrigin).trim() || defaultApiOrigin;
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
const platformPrivyConfig = resolvePlatformPrivyConfigFromEnv();

type DemoConfig = {
  appName: string;
  creditsPerDollar: number;
  itemDefId: string;
  programId: string;
  allowedChainId: string;
  firstTimeClaimActionId: string;
  mintItemActionId: string;
  claimRewardsActionId: string;
  firstTimeClaimExecutionMode: "managed" | "server" | "webhook";
  mintItemExecutionMode: "managed" | "server" | "webhook";
  claimRewardsExecutionMode: "managed" | "server" | "webhook";
  enableTunnels: boolean;
  startPlayerFrontend: boolean;
};

type DemoSession = {
  developerId: string;
  developerEmail: string;
  developerUsername: string;
  developerPassword: string;
  developerAccessToken: string;
  appId: string;
  apiKey: string;
};

type AppSetupDetails = {
  appId: string;
  apiKey: string;
  playerPolicy: {
    authProvider: "privy";
    allowedChainId: string;
  };
  creditPackages: Array<{
    packageId: string;
    priceCents: number;
    credits: number;
  }>;
  actions: Array<{
    actionType: string;
    cost: number;
    executionMode: string;
  }>;
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
  const tunnelConfig = resolveTunnelConfig({ startPlayerFrontend: config.startPlayerFrontend });
  validateTunnelConfig(tunnelConfig, config);

  console.log("Starting Celeris API...");
  const apiProcess = spawnManagedProcess("api", ["node", "--import", "tsx", "celeris/api/index.ts"]);
  await waitForHttp(defaultApiOrigin, { expectJson: false });

  const demoSession = await provisionDemo(config, tunnelConfig);
  const setup = await getJson<AppSetupDetails>(`/v1/developer/apps/${demoSession.appId}`, {
    accessToken: demoSession.developerAccessToken
  });

  let playerFrontendStarted = false;
  if (config.startPlayerFrontend) {
    console.log("Starting mock game frontend...");
    spawnManagedProcess("mock-game", [
      "node",
      "--import",
      "tsx",
      "scripts/mock-game-frontend.ts",
      `--app-id=${demoSession.appId}`,
      `--app-name=${config.appName}`,
      `--program-id=${config.programId}`,
      `--hosted-auth-origin=${tunnelConfig.hostedAuthOrigin}`,
      `--allowed-chain-id=${config.allowedChainId}`,
      `--first-time-claim-action-id=${config.firstTimeClaimActionId}`,
      `--mint-item-action-id=${config.mintItemActionId}`,
      `--claim-rewards-action-id=${config.claimRewardsActionId}`,
      `--item-def-id=${config.itemDefId}`
    ]);
    await waitForHttp(defaultFrontendOrigin, { expectJson: false });
    playerFrontendStarted = true;
  }

  const stripeMode = await detectStripeMode();
  let apiTunnelUrl: string | null = null;
  let gameTunnelUrl: string | null = null;

  if (config.enableTunnels) {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.log("Warning: STRIPE_SECRET_KEY is not configured. Checkout remains in mock mode.");
    }

    if (process.env.CLOUDFLARED_TUNNEL_TOKEN) {
      console.log("Starting named cloudflared tunnel...");
      const namedTunnelUrls = await spawnNamedTunnel({
        token: process.env.CLOUDFLARED_TUNNEL_TOKEN,
        apiHostname: tunnelConfig.apiHostname,
        frontendHostname: playerFrontendStarted ? tunnelConfig.frontendHostname : undefined
      });
      apiTunnelUrl = namedTunnelUrls.apiUrl;
      gameTunnelUrl = namedTunnelUrls.frontendUrl;
    } else {
      console.log("Starting cloudflared dashboard tunnel...");
      apiTunnelUrl = await spawnTunnel("dashboard-tunnel", defaultApiOrigin);
      if (playerFrontendStarted) {
        console.log("Starting cloudflared game tunnel...");
        gameTunnelUrl = await spawnTunnel("game-tunnel", defaultFrontendOrigin);
      }
    }
  }

  printSummary({
    config,
    demoSession,
    setup,
    stripeMode,
    apiTunnelUrl,
    gameTunnelUrl,
    playerFrontendStarted,
    hostedAuthOrigin: tunnelConfig.hostedAuthOrigin
  });

  await waitForever(apiProcess);
}

function parseArgs(args: string[]): DemoConfig {
  const config: DemoConfig = {
    appName: "Celeris Demo Game",
    creditsPerDollar: 500,
    itemDefId: "iron_sword",
    programId: createMockSolanaProgramId(),
    allowedChainId: "solana:103",
    firstTimeClaimActionId: "first_time_claim",
    mintItemActionId: "mint_item",
    claimRewardsActionId: "claim_rewards",
    firstTimeClaimExecutionMode: "managed",
    mintItemExecutionMode: "managed",
    claimRewardsExecutionMode: "managed",
    enableTunnels: true,
    startPlayerFrontend: false
  };

  for (const arg of args) {
    if (arg === "--no-tunnel") {
      config.enableTunnels = false;
      continue;
    }
    if (arg === "--with-player-frontend") {
      config.startPlayerFrontend = true;
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
    if (arg.startsWith("--item-def-id=")) {
      config.itemDefId = arg.slice("--item-def-id=".length);
      continue;
    }
    if (arg.startsWith("--allowed-chain-id=")) {
      config.allowedChainId = arg.slice("--allowed-chain-id=".length);
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
    if (arg.startsWith("--first-time-claim-mode=")) {
      config.firstTimeClaimExecutionMode = parseExecutionMode(arg.slice("--first-time-claim-mode=".length));
      continue;
    }
    if (arg.startsWith("--mint-item-mode=")) {
      config.mintItemExecutionMode = parseExecutionMode(arg.slice("--mint-item-mode=".length));
      continue;
    }
    if (arg.startsWith("--claim-rewards-mode=")) {
      config.claimRewardsExecutionMode = parseExecutionMode(arg.slice("--claim-rewards-mode=".length));
    }
  }

  return config;
}

function parseExecutionMode(value: string): "managed" | "server" | "webhook" {
  if (value === "managed" || value === "server" || value === "webhook") {
    return value;
  }
  throw new Error(`Unsupported execution mode: ${value}`);
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

async function provisionDemo(
  config: DemoConfig,
  tunnelConfig: {
    allowedFrontendOrigins: string[];
    allowedRedirectUris: string[];
  }
): Promise<DemoSession> {
  const credentialSuffix = randomUUID().slice(0, 8);
  const developerUsername = `demo-dev-${credentialSuffix}`;
  const developerPassword = `demo-pass-${credentialSuffix}`;
  const developerId = `dev-${randomUUID()}`;

  const developerSession = await postJson("/v1/developer/sign-up", {
    username: developerUsername,
    password: developerPassword,
    developerId
  });

  const app = await postJson("/v1/developer/apps", {
    name: config.appName,
    priceCents: 100,
    credits: config.creditsPerDollar,
    allowedChainId: config.allowedChainId,
    allowedFrontendOrigins: tunnelConfig.allowedFrontendOrigins,
    allowedRedirectUris: tunnelConfig.allowedRedirectUris
  }, {
    accessToken: developerSession.accessToken
  });

  await configureAction(app.appId, config.firstTimeClaimActionId, 10, config.firstTimeClaimExecutionMode, developerSession.accessToken);
  await configureAction(app.appId, config.claimRewardsActionId, 25, config.claimRewardsExecutionMode, developerSession.accessToken);
  await configureAction(app.appId, config.mintItemActionId, 50, config.mintItemExecutionMode, developerSession.accessToken);

  return {
    developerId: developerSession.developerId,
    developerEmail: developerSession.email,
    developerUsername,
    developerPassword,
    developerAccessToken: developerSession.accessToken,
    appId: app.appId,
    apiKey: app.apiKey
  };
}

async function configureAction(
  appId: string,
  actionType: string,
  cost: number,
  executionMode: "managed" | "server" | "webhook",
  accessToken: string
) {
  await postJson(`/v1/developer/apps/${appId}/actions`, {
    actionType,
    cost,
    executionMode
  }, {
    accessToken
  });
}

async function postJson(pathname: string, body: Record<string, unknown>, { accessToken }: { accessToken?: string } = {}) {
  const response = await fetch(`${defaultApiOrigin}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `full-demo-${randomUUID()}`,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed for ${pathname}: ${response.status} ${text}`);
  }

  return response.json();
}

async function getJson<T>(pathname: string, { accessToken }: { accessToken?: string } = {}): Promise<T> {
  const response = await fetch(`${defaultApiOrigin}${pathname}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed for ${pathname}: ${response.status} ${text}`);
  }
  return response.json() as Promise<T>;
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
  apiHostname,
  frontendHostname
}: {
  token: string;
  apiHostname?: string;
  frontendHostname?: string;
}) {
  if (!apiHostname) {
    throw new Error(
      "Named tunnel mode requires CLOUDFLARED_AUTH_HOSTNAME or CLOUDFLARED_DASHBOARD_HOSTNAME."
    );
  }

  const ingress = [
    "ingress:",
    `  - hostname: ${apiHostname}`,
    `    service: ${defaultApiOrigin}`
  ];

  if (frontendHostname) {
    ingress.push(`  - hostname: ${frontendHostname}`, `    service: ${defaultFrontendOrigin}`);
  }

  ingress.push("  - service: http_status:404", "");

  const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "cloudflared-named-"));
  const isolatedConfigPath = path.join(isolatedHome, "config.yml");
  await fs.writeFile(isolatedConfigPath, ingress.join("\n"), "utf8");

  const tunnelEnv = { ...process.env };
  for (const key of Object.keys(tunnelEnv)) {
    if (key.startsWith("TUNNEL_") || key.startsWith("CLOUDFLARED_") || key === "CF_API_TOKEN") {
      delete tunnelEnv[key];
    }
  }
  tunnelEnv.HOME = isolatedHome;
  tunnelEnv.XDG_CONFIG_HOME = isolatedHome;

  const child = spawn(cloudflaredPath, ["tunnel", "--config", isolatedConfigPath, "run", "--token", token], {
    cwd: rootDir,
    env: tunnelEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);

  return await new Promise<{ apiUrl: string; frontendUrl: string | null }>((resolve, reject) => {
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
          apiUrl: `https://${apiHostname}`,
          frontendUrl: frontendHostname ? `https://${frontendHostname}` : null
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

function printSummary({
  config,
  demoSession,
  setup,
  stripeMode,
  apiTunnelUrl,
  gameTunnelUrl,
  playerFrontendStarted,
  hostedAuthOrigin
}: {
  config: DemoConfig;
  demoSession: DemoSession;
  setup: AppSetupDetails;
  stripeMode: string;
  apiTunnelUrl: string | null;
  gameTunnelUrl: string | null;
  playerFrontendStarted: boolean;
  hostedAuthOrigin: string;
}) {
  const localDashboardUrl = buildDashboardUrl(defaultDashboardOrigin, demoSession);
  const publicDashboardUrl = apiTunnelUrl ? buildDashboardUrl(apiTunnelUrl, demoSession) : null;

  console.log("");
  console.log("Full demo is ready.");
  console.log("");
  console.log(`Stripe checkout mode: ${stripeMode}`);
  console.log(`Developer username: ${demoSession.developerUsername}`);
  console.log(`Developer password: ${demoSession.developerPassword}`);
  console.log(`Developer email: ${demoSession.developerEmail}`);
  console.log(`Developer ID: ${demoSession.developerId}`);
  console.log(`App ID: ${demoSession.appId}`);
  console.log(`API key: ${demoSession.apiKey}`);
  console.log(`Hosted auth origin: ${hostedAuthOrigin}`);
  console.log(`Allowed chain ID: ${setup.playerPolicy.allowedChainId}`);
  console.log(`Mock program ID: ${config.programId}`);
  console.log("");
  console.log("Configured actions:");
  for (const action of setup.actions) {
    console.log(`- ${action.actionType}: ${action.cost} credits (${action.executionMode})`);
  }
  console.log("");
  console.log(`Local dashboard: ${localDashboardUrl}`);
  if (playerFrontendStarted) {
    console.log(`Local game frontend: ${defaultFrontendOrigin}`);
  } else {
    console.log("Local game frontend: not started");
    console.log("Reason: start it with --with-player-frontend when you want to exercise the hosted browser login flow.");
  }
  if (publicDashboardUrl) {
    console.log(`Public dashboard: ${publicDashboardUrl}`);
  }
  if (gameTunnelUrl) {
    console.log(`Public game frontend: ${gameTunnelUrl}`);
  }
  if (hostedAuthOrigin !== defaultApiOrigin) {
    console.log(`Public hosted login: ${hostedAuthOrigin}/auth/login`);
  }
  console.log("");
  console.log("WO-01 manual checks:");
  console.log(`1. Open the dashboard URL above and sign in with the provisioned developer credentials.`);
  console.log("2. Open the provisioned app and verify Setup summary shows the shared auth provider and Allowed chain.");
  console.log("3. Verify the dashboard does not show a webhook field or sponsor-wallet section.");
  console.log("4. Open the configured actions and verify each action has the expected execution mode.");
  console.log(`5. Optional API check: curl -H 'authorization: Bearer ${demoSession.developerAccessToken}' ${defaultApiOrigin}/v1/developer/apps/${demoSession.appId}`);
  console.log("");
  console.log("Press Ctrl+C to stop all demo services.");
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

function resolveTunnelConfig({ startPlayerFrontend }: { startPlayerFrontend: boolean }) {
  const apiHostname = normalizeHostname(
    process.env.CLOUDFLARED_AUTH_HOSTNAME ?? process.env.CLOUDFLARED_DASHBOARD_HOSTNAME
  );
  const frontendHostname = startPlayerFrontend
    ? normalizeHostname(process.env.CLOUDFLARED_DEMO_FRONTEND_HOSTNAME ?? process.env.CLOUDFLARED_GAME_HOSTNAME)
    : null;
  const publicFrontendOrigin = frontendHostname ? `https://${frontendHostname}` : null;
  const allowedFrontendOrigins = publicFrontendOrigin
    ? uniqueStrings([defaultFrontendOrigin, publicFrontendOrigin])
    : [defaultFrontendOrigin];
  const allowedRedirectUris = allowedFrontendOrigins.map((origin) => `${origin}/auth/callback`);

  return {
    apiHostname,
    frontendHostname,
    hostedAuthOrigin: configuredHostedAuthOrigin,
    allowedFrontendOrigins,
    allowedRedirectUris
  };
}

function validateTunnelConfig(
  tunnelConfig: {
    apiHostname?: string;
    frontendHostname: string | null;
    hostedAuthOrigin: string;
  },
  config: DemoConfig
) {
  if (!config.enableTunnels) {
    return;
  }

  const hasNamedHostname = Boolean(tunnelConfig.apiHostname || tunnelConfig.frontendHostname);
  if (hasNamedHostname && !process.env.CLOUDFLARED_TUNNEL_TOKEN) {
    throw new Error(
      "Named Cloudflare hostnames are configured, but CLOUDFLARED_TUNNEL_TOKEN is missing. " +
        "Set CLOUDFLARED_TUNNEL_TOKEN or remove the CLOUDFLARED_* hostname variables to use quick tunnels."
    );
  }

  if (tunnelConfig.apiHostname) {
    const expectedHostedAuthOrigin = `https://${tunnelConfig.apiHostname}`;
    if (tunnelConfig.hostedAuthOrigin !== expectedHostedAuthOrigin) {
      throw new Error(
        `CELERIS_HOSTED_AUTH_ORIGIN must match the named auth hostname. Expected ${expectedHostedAuthOrigin}, got ${tunnelConfig.hostedAuthOrigin}.`
      );
    }
  }
}

function normalizeHostname(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
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

function loadDotEnv(filePath: string) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }

  const source = fsSync.readFileSync(filePath, "utf8");
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    shutdown(1);
  });
}
