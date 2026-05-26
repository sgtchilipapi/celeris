import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { buildServices } from "../celeris/api/index.js";
import { createApi } from "../celeris/api/create-api.js";
import { createServerClient } from "../celeris/sdk/server-client.js";
import {
  HELLO_CELERIS_INITIALIZE_APP_FUNCTION,
  HELLO_CELERIS_MODULE_NAME,
  parseSuiObjectId,
  parseSuiPackageId
} from "../celeris/sui/hello-celeris.js";
import { buildRunConfig, createMockGameFrontendServer } from "./mock-game-frontend.js";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

export type FullDemoConfig = {
  apiPort: number;
  frontendPort: number;
  apiOrigin: string;
  frontendOrigin: string;
  allowedFrontendOrigins: string[];
  allowedRedirectUris: string[];
  hostedAuthOrigin: string;
  suiRpcOrigin: string;
  appName: string;
  developerUsername: string;
  developerPassword: string;
  sponsorFundAmountMist: number;
  sponsorFundGasBudget: number;
  publishGasBudget: number;
  initializeGasBudget: number;
  sayHelloCost: number;
  packagePath: string;
  keepRunning: boolean;
  skipSponsorFunding: boolean;
  skipSuiPublish: boolean;
};

type SuiPublishResult = {
  packageId: string;
  raw: Record<string, unknown>;
};

type SuiInitializeResult = {
  appStateObjectId: string;
  authorityCapObjectId: string;
  raw: Record<string, unknown>;
};

type SuiCoin = {
  coinObjectId: string;
  balance: string;
};

type StartedDemo = {
  config: FullDemoConfig;
  apiServer: http.Server;
  frontendServer: http.Server;
  appId: string;
  apiKey: string;
  developerUsername: string;
  developerPassword: string;
  sponsorWalletAddress: string;
  packageId: string;
  appStateObjectId: string;
  authorityCapObjectId: string;
};

export function parseFullDemoArgs(args: string[], env: NodeJS.ProcessEnv = process.env): FullDemoConfig {
  const apiPort = Number(env.PORT ?? 3000);
  const frontendPort = Number(env.MOCK_GAME_FRONTEND_PORT ?? 3002);
  const apiOrigin = `http://localhost:${apiPort}`;
  const frontendOrigin = `http://localhost:${frontendPort}`;
  const additionalFrontendOrigins: string[] = [];
  const seed = randomUUID().slice(0, 8);
  const config: FullDemoConfig = {
    apiPort,
    frontendPort,
    apiOrigin,
    frontendOrigin,
    allowedFrontendOrigins: [frontendOrigin],
    allowedRedirectUris: [`${frontendOrigin}/auth/callback`],
    hostedAuthOrigin: env.CELERIS_HOSTED_AUTH_ORIGIN ?? apiOrigin,
    suiRpcOrigin: env.CELERIS_SUI_RPC_ORIGIN ?? "https://fullnode.testnet.sui.io:443",
    appName: "Hello Celeris",
    developerUsername: `full-demo-${seed}`,
    developerPassword: `demo-${seed}-password`,
    sponsorFundAmountMist: 50_000_000,
    sponsorFundGasBudget: 10_000_000,
    publishGasBudget: 200_000_000,
    initializeGasBudget: 50_000_000,
    sayHelloCost: 25,
    packagePath: path.join(projectRoot, "sui/hello-celeris"),
    keepRunning: true,
    skipSponsorFunding: false,
    skipSuiPublish: false
  };

  for (const arg of args) {
    if (arg.startsWith("--api-port=")) {
      config.apiPort = parseRequiredInteger(arg.slice("--api-port=".length), "api port");
      config.apiOrigin = `http://localhost:${config.apiPort}`;
      continue;
    }
    if (arg.startsWith("--frontend-port=")) {
      config.frontendPort = parseRequiredInteger(arg.slice("--frontend-port=".length), "frontend port");
      config.frontendOrigin = `http://localhost:${config.frontendPort}`;
      continue;
    }
    if (arg.startsWith("--allowed-frontend-origin=")) {
      additionalFrontendOrigins.push(arg.slice("--allowed-frontend-origin=".length).trim());
      continue;
    }
    if (arg.startsWith("--hosted-auth-origin=")) {
      config.hostedAuthOrigin = arg.slice("--hosted-auth-origin=".length).trim();
      continue;
    }
    if (arg.startsWith("--sui-rpc-origin=")) {
      config.suiRpcOrigin = arg.slice("--sui-rpc-origin=".length).trim();
      continue;
    }
    if (arg.startsWith("--app-name=")) {
      config.appName = arg.slice("--app-name=".length).trim();
      continue;
    }
    if (arg.startsWith("--developer-username=")) {
      config.developerUsername = arg.slice("--developer-username=".length).trim();
      continue;
    }
    if (arg.startsWith("--developer-password=")) {
      config.developerPassword = arg.slice("--developer-password=".length).trim();
      continue;
    }
    if (arg.startsWith("--sponsor-fund-amount-mist=")) {
      config.sponsorFundAmountMist = parseRequiredInteger(
        arg.slice("--sponsor-fund-amount-mist=".length),
        "sponsor fund amount"
      );
      continue;
    }
    if (arg.startsWith("--sponsor-fund-gas-budget=")) {
      config.sponsorFundGasBudget = parseRequiredInteger(
        arg.slice("--sponsor-fund-gas-budget=".length),
        "sponsor funding gas budget"
      );
      continue;
    }
    if (arg.startsWith("--publish-gas-budget=")) {
      config.publishGasBudget = parseRequiredInteger(arg.slice("--publish-gas-budget=".length), "publish gas budget");
      continue;
    }
    if (arg.startsWith("--initialize-gas-budget=")) {
      config.initializeGasBudget = parseRequiredInteger(
        arg.slice("--initialize-gas-budget=".length),
        "initialize gas budget"
      );
      continue;
    }
    if (arg.startsWith("--say-hello-cost=")) {
      config.sayHelloCost = parseRequiredInteger(arg.slice("--say-hello-cost=".length), "say_hello cost");
      continue;
    }
    if (arg.startsWith("--package-path=")) {
      config.packagePath = path.resolve(projectRoot, arg.slice("--package-path=".length).trim());
      continue;
    }
    if (arg === "--skip-sponsor-funding") {
      config.skipSponsorFunding = true;
      continue;
    }
    if (arg === "--skip-sui-publish") {
      config.skipSuiPublish = true;
      continue;
    }
    if (arg === "--no-keep-running") {
      config.keepRunning = false;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!config.hostedAuthOrigin) {
    config.hostedAuthOrigin = config.apiOrigin;
  }
  if (!config.packagePath) {
    throw new Error("package path is required");
  }
  if (!config.developerUsername) {
    throw new Error("developer username is required");
  }
  if (!config.developerPassword) {
    throw new Error("developer password is required");
  }

  config.allowedFrontendOrigins = resolveAllowedFrontendOrigins({
    frontendOrigin: config.frontendOrigin,
    additionalOrigins: additionalFrontendOrigins,
    env
  });
  config.allowedRedirectUris = config.allowedFrontendOrigins.map((origin) => new URL("/auth/callback", origin).toString());

  return config;
}

export async function runFullDemo(config: FullDemoConfig): Promise<StartedDemo> {
  await assertSuiCliReady();

  const services = buildServices({
    hostedAuthConfig: {
      hostedAuthOrigin: config.hostedAuthOrigin,
      sessionSecret: process.env.CELERIS_SESSION_SECRET ?? "celeris-session-dev-secret"
    },
    suiRpcOrigin: config.suiRpcOrigin
  });
  const api = createApi(services);
  const apiServer = await listenServer(api.createNodeServer(), config.apiPort);

  try {
    const developerClient = createServerClient({ apiBaseUrl: config.apiOrigin });
    const developerSession = await developerClient.auth.signUp({
      username: config.developerUsername,
      password: config.developerPassword,
      idempotencyKey: `full-demo-sign-up-${randomUUID()}`
    });
    const authenticatedClient = createServerClient({
      apiBaseUrl: config.apiOrigin,
      accessToken: developerSession.accessToken as string
    });

    const app = await authenticatedClient.apps.create({
      name: config.appName,
      priceCents: 499,
      credits: 100,
      allowedChainId: "sui:testnet",
      allowedFrontendOrigins: config.allowedFrontendOrigins,
      allowedRedirectUris: config.allowedRedirectUris,
      idempotencyKey: `full-demo-create-app-${randomUUID()}`
    });
    const appId = app.appId as string;
    const apiKey = app.apiKey as string;

    const sponsorWallet = await authenticatedClient.apps.createSponsorWallet(appId, {
      idempotencyKey: `full-demo-sponsor-wallet-${randomUUID()}`
    });
    const sponsorWalletAddress = String(sponsorWallet.address);

    if (!config.skipSponsorFunding) {
      await fundSponsorWallet({
        sponsorWalletAddress,
        amountMist: config.sponsorFundAmountMist,
        gasBudget: config.sponsorFundGasBudget,
        suiRpcOrigin: config.suiRpcOrigin
      });
    }

    let packageId = "0x0";
    let appStateObjectId = "0x0";
    let authorityCapObjectId = "0x0";

    if (!config.skipSuiPublish) {
      const published = await publishMovePackage({
        packagePath: config.packagePath,
        gasBudget: config.publishGasBudget,
        buildEnvironment: inferSuiBuildEnvironment(config.suiRpcOrigin)
      });
      packageId = published.packageId;

      const initialized = await initializeHelloCelerisApp({
        packageId,
        appId,
        gasBudget: config.initializeGasBudget
      });
      appStateObjectId = initialized.appStateObjectId;
      authorityCapObjectId = initialized.authorityCapObjectId;

      await authenticatedClient.apps.registerProgram(appId, {
        packageId,
        appStateObjectId,
        authorityCapObjectId,
        idempotencyKey: `full-demo-register-program-${randomUUID()}`
      });
    }

    await authenticatedClient.apps.configureAction(appId, {
      actionType: "say_hello",
      cost: config.sayHelloCost,
      executionMode: "managed",
      idempotencyKey: `full-demo-configure-action-${randomUUID()}`
    });

    const frontendConfig = buildRunConfig({
      appId,
      appName: config.appName,
      apiOrigin: "/api",
      hostedAuthOrigin: config.hostedAuthOrigin,
      suiRpcOrigin: config.suiRpcOrigin,
      redirectUri: `${config.frontendOrigin}/auth/callback`
    });
    const frontendServer = await listenServer(
      createMockGameFrontendServer({
        config: frontendConfig,
        upstreamApiOrigin: config.apiOrigin
      }),
      config.frontendPort
    );

    return {
      config,
      apiServer,
      frontendServer,
      appId,
      apiKey,
      developerUsername: config.developerUsername,
      developerPassword: config.developerPassword,
      sponsorWalletAddress,
      packageId,
      appStateObjectId,
      authorityCapObjectId
    };
  } catch (error) {
    await closeServer(apiServer);
    throw error;
  }
}

function resolveAllowedFrontendOrigins({
  frontendOrigin,
  additionalOrigins,
  env
}: {
  frontendOrigin: string;
  additionalOrigins: string[];
  env: NodeJS.ProcessEnv;
}) {
  const configuredOrigins = splitConfiguredOrigins(env.CELERIS_DEMO_FRONTEND_ORIGINS);
  const cloudflaredHostname = String(env.CLOUDFLARED_DEMO_FRONTEND_HOSTNAME ?? "").trim();
  if (cloudflaredHostname) {
    configuredOrigins.push(`https://${cloudflaredHostname}`);
  }

  return Array.from(new Set([frontendOrigin, ...configuredOrigins, ...additionalOrigins].map(normalizeOriginUrl)));
}

function splitConfiguredOrigins(raw: string | undefined) {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOriginUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`invalid allowed frontend origin: ${value}`);
  }
}

export async function assertSuiCliReady() {
  await runSuiCommand(["--version"]);
  await runSuiCommand(["client", "active-address"]);
}

export async function resolveActiveSuiAddress() {
  const output = await runSuiCommand(["client", "active-address"]);
  const value = output.stdout.trim();
  if (!value) {
    throw new Error("sui client active-address returned an empty value");
  }
  return value;
}

export async function fundSponsorWallet({
  sponsorWalletAddress,
  amountMist,
  gasBudget,
  suiRpcOrigin
}: {
  sponsorWalletAddress: string;
  amountMist: number;
  gasBudget: number;
  suiRpcOrigin: string;
}) {
  const activeSuiAddress = await resolveActiveSuiAddress();
  const suiCoinObjectId = await resolveTransferSuiCoinObjectId({
    suiRpcOrigin,
    ownerAddress: activeSuiAddress,
    amountMist,
    gasBudget
  });

  await runSuiCommand([
    "client",
    "transfer-sui",
    "--to",
    sponsorWalletAddress,
    "--sui-coin-object-id",
    suiCoinObjectId,
    "--amount",
    String(amountMist),
    "--gas-budget",
    String(gasBudget),
    "--json"
  ]);
}

export function inferSuiNetwork(suiRpcOrigin: string) {
  const normalized = suiRpcOrigin.toLowerCase();
  if (normalized.includes("mainnet")) {
    return "mainnet";
  }
  if (normalized.includes("devnet")) {
    return "devnet";
  }
  if (normalized.includes("localnet") || normalized.includes("localhost") || normalized.includes("127.0.0.1")) {
    return "localnet";
  }
  return "testnet";
}

export function inferSuiBuildEnvironment(suiRpcOrigin: string) {
  const network = inferSuiNetwork(suiRpcOrigin);
  if (network === "localnet") {
    return "testnet";
  }
  return network;
}

export function parseMist(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }
  return BigInt(value);
}

export function selectSuiCoinForTransfer(coins: SuiCoin[], requiredMist: bigint) {
  let bestCandidate: { coinObjectId: string; balance: bigint } | null = null;

  for (const coin of coins) {
    const balance = parseMist(coin.balance, `balance for coin ${coin.coinObjectId}`);
    if (balance < requiredMist) {
      continue;
    }
    if (!bestCandidate || balance < bestCandidate.balance) {
      bestCandidate = {
        coinObjectId: coin.coinObjectId,
        balance
      };
    }
  }

  if (!bestCandidate) {
    throw new Error(
      `active Sui address does not own a single SUI coin with at least ${requiredMist} MIST ` +
        `required to cover sponsor funding plus gas`
    );
  }

  return bestCandidate.coinObjectId;
}

export async function resolveTransferSuiCoinObjectId({
  suiRpcOrigin,
  ownerAddress,
  amountMist,
  gasBudget
}: {
  suiRpcOrigin: string;
  ownerAddress: string;
  amountMist: number;
  gasBudget: number;
}) {
  const requiredMist = BigInt(amountMist) + BigInt(gasBudget);
  const client = new SuiJsonRpcClient({
    network: inferSuiNetwork(suiRpcOrigin),
    url: suiRpcOrigin
  });

  let cursor: string | null | undefined = null;
  let bestCoin: { coinObjectId: string; balance: bigint } | null = null;

  do {
    const page = await client.getCoins({
      owner: ownerAddress,
      cursor,
      limit: 100
    });
    for (const coin of page.data) {
      const balance = parseMist(coin.balance, `balance for coin ${coin.coinObjectId}`);
      if (balance < requiredMist) {
        continue;
      }
      if (!bestCoin || balance < bestCoin.balance) {
        bestCoin = {
          coinObjectId: coin.coinObjectId,
          balance
        };
      }
    }

    cursor = page.nextCursor;
    if (bestCoin || !page.hasNextPage) {
      break;
    }
  } while (true);

  if (!bestCoin) {
    throw new Error(
      `active Sui address ${ownerAddress} does not own a single SUI coin with at least ${requiredMist} MIST ` +
        `required to cover sponsor funding plus gas`
    );
  }

  return bestCoin.coinObjectId;
}

export function buildSuiPublishArgs({
  packagePath,
  gasBudget,
  publicationFilePath,
  buildEnvironment
}: {
  packagePath: string;
  gasBudget: number;
  publicationFilePath: string;
  buildEnvironment: string;
}) {
  return [
    "client",
    "test-publish",
    "--gas-budget",
    String(gasBudget),
    "--build-env",
    buildEnvironment,
    "--pubfile-path",
    publicationFilePath,
    "--json",
    packagePath
  ];
}

export async function withEphemeralSuiPublicationFile<T>(callback: (publicationFilePath: string) => Promise<T>) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "celeris-sui-publish-"));
  const publicationFilePath = path.join(tempDirectory, "Published.toml");

  try {
    return await callback(publicationFilePath);
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function publishMovePackage({
  packagePath,
  gasBudget,
  buildEnvironment
}: {
  packagePath: string;
  gasBudget: number;
  buildEnvironment: string;
}): Promise<SuiPublishResult> {
  const output = await withEphemeralSuiPublicationFile(async (publicationFilePath) =>
    runSuiCommand(buildSuiPublishArgs({ packagePath, gasBudget, publicationFilePath, buildEnvironment }))
  );
  const payload = parseSuiJsonOutput(output.stdout, "publish output");

  return {
    packageId: extractPublishedPackageId(payload),
    raw: payload
  };
}

export async function initializeHelloCelerisApp({
  packageId,
  appId,
  gasBudget
}: {
  packageId: string;
  appId: string;
  gasBudget: number;
}): Promise<SuiInitializeResult> {
  const output = await runSuiCommand([
    "client",
    "call",
    "--package",
    packageId,
    "--module",
    HELLO_CELERIS_MODULE_NAME,
    "--function",
    HELLO_CELERIS_INITIALIZE_APP_FUNCTION,
    "--args",
    appId,
    "--gas-budget",
    String(gasBudget),
    "--json"
  ]);
  const payload = parseSuiJsonOutput(output.stdout, "initialize_app output");
  const { appStateObjectId, authorityCapObjectId } = extractInitializedAppObjects(payload);

  return {
    appStateObjectId,
    authorityCapObjectId,
    raw: payload
  };
}

export function extractPublishedPackageId(payload: Record<string, unknown>) {
  const directPackageId = typeof payload.packageId === "string" ? payload.packageId : null;
  if (directPackageId) {
    return parseSuiPackageId(directPackageId);
  }

  const objectChanges = Array.isArray(payload.objectChanges) ? payload.objectChanges : [];
  for (const change of objectChanges) {
    if (!change || typeof change !== "object") {
      continue;
    }
    const publishedChange = change as Record<string, unknown>;
    if (publishedChange.type === "published" && typeof publishedChange.packageId === "string") {
      return parseSuiPackageId(publishedChange.packageId);
    }
  }

  throw new Error("unable to locate published Sui package ID in publish output");
}

export function extractInitializedAppObjects(payload: Record<string, unknown>) {
  const objectChanges = Array.isArray(payload.objectChanges) ? payload.objectChanges : [];
  let appStateObjectId: string | null = null;
  let authorityCapObjectId: string | null = null;

  for (const change of objectChanges) {
    if (!change || typeof change !== "object") {
      continue;
    }
    const current = change as Record<string, unknown>;
    const objectType = typeof current.objectType === "string" ? current.objectType : "";
    const objectId = typeof current.objectId === "string" ? current.objectId : "";
    if (!objectType || !objectId) {
      continue;
    }
    if (objectType.endsWith("::hello_celeris::AppState")) {
      appStateObjectId = parseSuiObjectId(objectId, "Sui app state object ID");
    }
    if (objectType.endsWith("::hello_celeris::AppAuthorityCap")) {
      authorityCapObjectId = parseSuiObjectId(objectId, "Sui authority capability object ID");
    }
  }

  if (!appStateObjectId || !authorityCapObjectId) {
    throw new Error("unable to locate AppState and AppAuthorityCap object IDs in initialize_app output");
  }

  return {
    appStateObjectId,
    authorityCapObjectId
  };
}

export function parseSuiJsonOutput(source: string, label: string) {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`failed to parse ${label}: ${(error as Error).message}`);
  }
}

export function createSuiCommandError(args: string[], error: unknown) {
  const failed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  if (failed.code === "ENOENT") {
    return new Error(
      "Sui CLI was not found on PATH. `npm run start:full-demo` requires a local Sui CLI install " +
        "to fund the sponsor wallet, publish the Move package, and call initialize_app. " +
        "Install Sui CLI, then verify `sui --version` and `sui client active-address` both succeed before retrying."
    );
  }

  const stderr = String(failed.stderr ?? "").trim();
  const stdout = String(failed.stdout ?? "").trim();
  const command = ["sui", ...args].join(" ");
  const sections: string[] = [];

  if (stderr) {
    sections.push(stderr);
  }
  if (stdout && stdout !== stderr) {
    sections.push(`stdout:\n${stdout}`);
  }

  const detail = sections.join("\n\n") || failed.message;

  return new Error(`${command} failed: ${detail}`);
}

export async function runSuiCommand(args: string[]) {
  try {
    return await execFile("sui", args, {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    throw createSuiCommandError(args, error);
  }
}

function parseRequiredInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function listenServer(server: http.Server, port: number) {
  return new Promise<http.Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function closeServer(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForShutdown() {
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

function printFullDemoSummary(started: StartedDemo, activeSuiAddress: string) {
  console.log("Full demo is ready.");
  console.log(`API: ${started.config.apiOrigin}`);
  console.log(`Frontend: ${started.config.frontendOrigin}`);
  console.log(`Hosted auth origin: ${started.config.hostedAuthOrigin}`);
  console.log(`Sui RPC origin: ${started.config.suiRpcOrigin}`);
  console.log(`Active Sui deployer address: ${activeSuiAddress}`);
  console.log(`Developer username: ${started.developerUsername}`);
  console.log(`Developer password: ${started.developerPassword}`);
  console.log(`App ID: ${started.appId}`);
  console.log(`API key: ${started.apiKey}`);
  console.log(`Sponsor wallet address: ${started.sponsorWalletAddress}`);
  if (started.packageId !== "0x0") {
    console.log(`Package ID: ${started.packageId}`);
    console.log(`AppState object ID: ${started.appStateObjectId}`);
    console.log(`AuthorityCap object ID: ${started.authorityCapObjectId}`);
  } else {
    console.log("Sui publish step was skipped; package registration was not performed.");
  }
  if (!process.env.CELERIS_GOOGLE_CLIENT_ID) {
    console.log(
      "Warning: CELERIS_GOOGLE_CLIENT_ID is not set. Deployment is live, but hosted Google sign-in will not work until you provide a real client ID."
    );
  }
  console.log("Next steps:");
  console.log(`1. Open ${started.config.frontendOrigin}`);
  console.log("2. Sign in through hosted Google login.");
  console.log("3. Buy credits.");
  console.log("4. Execute Say Hello Celeris.");
}

async function main() {
  const config = parseFullDemoArgs(process.argv.slice(2));
  const activeSuiAddress = await resolveActiveSuiAddress();
  const started = await runFullDemo(config);

  printFullDemoSummary(started, activeSuiAddress);

  if (!config.keepRunning) {
    await closeServer(started.frontendServer);
    await closeServer(started.apiServer);
    return;
  }

  await waitForShutdown();
  await closeServer(started.frontendServer);
  await closeServer(started.apiServer);
}

if (isMainModule) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
