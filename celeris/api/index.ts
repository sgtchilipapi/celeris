import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./create-api.js";
import { MemoryStore } from "../db/memory-store.js";
import { AssetDeliveryService } from "../services/asset-delivery-service.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";
import { AppService } from "../services/app-service.js";
import { ClaimRewardsService } from "../services/claim-rewards-service.js";
import { ManagedActionService } from "../services/managed-action-service.js";
import { MetricsService } from "../services/metrics-service.js";
import { MintItemService } from "../services/mint-item-service.js";
import { MockStripeGateway } from "../services/mock-stripe-gateway.js";
import { PaymentService } from "../services/payment-service.js";
import { PendingActionService } from "../services/pending-action-service.js";
import { PlayerSessionService } from "../services/player-session-service.js";
import { DeveloperSessionService } from "../services/developer-session-service.js";
import { RelayerService } from "../services/relayer-service.js";
import { SayHelloService } from "../services/say-hello-service.js";
import { MockRelayerNetwork } from "../services/mock-relayer-network.js";
import { SolanaRelayerNetwork } from "../services/solana-relayer-network.js";
import { StripeTestCheckoutGateway } from "../services/stripe-test-checkout-gateway.js";
import type { GoogleIdentityTokenVerifier, HostedAuthConfig, PlatformZkLoginConfig, RelayerNetworkClient } from "../types.js";
import { AuthGatewayService } from "../services/auth-gateway-service.js";
import {
  LocalGoogleIdentityTokenVerifier,
  LocalZkLoginProver,
  ZkLoginAuthService,
  resolvePlatformZkLoginConfigFromEnv
} from "../services/zklogin-auth-service.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

loadDotEnv(path.join(projectRoot, ".env"));
loadDotEnv(path.join(projectRoot, ".env.local"));

const enableStripeCheckout = Boolean(process.env.STRIPE_SECRET_KEY) && !isTestRuntime();

export function buildServices({
  relayerNetworkClient,
  managedActionService,
  platformZkLoginConfig = resolvePlatformZkLoginConfigFromEnv(process.env, { allowDevelopmentDefaults: true }),
  hostedAuthConfig = resolveHostedAuthConfigFromEnv(process.env, { allowDevelopmentDefaults: true }),
  solanaRpcOrigin = resolveSolanaRpcOriginFromEnv(process.env),
  googleIdentityTokenVerifier
}: {
  relayerNetworkClient?: RelayerNetworkClient;
  managedActionService?: ManagedActionService;
  platformZkLoginConfig?: PlatformZkLoginConfig;
  hostedAuthConfig?: HostedAuthConfig;
  solanaRpcOrigin?: string;
  googleIdentityTokenVerifier?: GoogleIdentityTokenVerifier;
} = {}) {
  const store = new MemoryStore();
  const defaultDeveloper = store.createDeveloper({ email: "dev@celeris.local" });
  const ledgerService = new CreditLedgerService({ store });
  const stripeGateway = new MockStripeGateway();
  const stripeCheckoutGateway = enableStripeCheckout
    ? new StripeTestCheckoutGateway({ secretKey: process.env.STRIPE_SECRET_KEY! })
    : null;
  const pendingActionService = new PendingActionService({ store, ledgerService });
  const resolvedRelayerNetworkClient = relayerNetworkClient ?? new MockRelayerNetwork();
  const relayerService = new RelayerService({ networkClient: resolvedRelayerNetworkClient, store });
  const assetDeliveryService = new AssetDeliveryService({ store });
  const resolvedManagedActionService = managedActionService ?? new ManagedActionService();
  const resolvedGoogleIdentityTokenVerifier =
    googleIdentityTokenVerifier ??
    new LocalGoogleIdentityTokenVerifier({
      secret: platformZkLoginConfig.googleVerifierSecret,
      issuer: platformZkLoginConfig.googleIssuer
    });
  const zkLoginAuthService = new ZkLoginAuthService({
    store,
    config: platformZkLoginConfig,
    googleIdentityTokenVerifier: resolvedGoogleIdentityTokenVerifier,
    prover: new LocalZkLoginProver({
      proverOrigin: platformZkLoginConfig.zkLoginProverOrigin
    })
  });
  const playerSessionService = new PlayerSessionService({ store, config: hostedAuthConfig });
  const developerSessionService = new DeveloperSessionService({ store, config: hostedAuthConfig });
  const services = {
    store,
    platformZkLoginConfig,
    hostedAuthConfig,
    solanaRpcOrigin,
    zkLoginAuthService,
    playerSessionService,
    developerSessionService,
    authGatewayService: new AuthGatewayService({
      store,
      zkLoginAuthService,
      playerSessionService,
      config: hostedAuthConfig
    }),
    appService: new AppService({ store }),
    paymentService: new PaymentService({ store, ledgerService, stripeCheckoutGateway, stripeGateway }),
    claimRewardsService: new ClaimRewardsService({ store, ledgerService, managedActionService: resolvedManagedActionService }),
    mintItemService: new MintItemService({
      store,
      ledgerService,
      managedActionService: resolvedManagedActionService,
      relayerService,
      pendingActionService,
      assetDeliveryService
    }),
    sayHelloService: new SayHelloService({
      store,
      ledgerService,
      managedActionService: resolvedManagedActionService,
      relayerService,
      pendingActionService
    }),
    metricsService: new MetricsService({ store }),
    stripeGateway,
    googleIdentityTokenVerifier: resolvedGoogleIdentityTokenVerifier,
    pendingActionService,
    relayerService,
    assetDeliveryService,
    managedActionService: resolvedManagedActionService
  };
  return { ...services, defaultDeveloper };
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const platformZkLoginConfig = resolveRuntimePlatformZkLoginConfig();
  const services = buildServices({
    relayerNetworkClient: new SolanaRelayerNetwork({
      rpcOrigin: resolveSolanaRpcOriginFromEnv(process.env)
    }),
    platformZkLoginConfig,
    hostedAuthConfig: resolveHostedAuthConfigFromEnv(process.env, { allowDevelopmentDefaults: false })
  });
  const api = createApi(services);
  const port = Number(process.env.PORT ?? 3000);
  api.createNodeServer().listen(port, () => {
    console.log(`Celeris MVP API listening on http://localhost:${port}`);
    console.log(`Seed developerId: ${services.defaultDeveloper.developerId}`);
    console.log(enableStripeCheckout ? "Stripe checkout mode: test" : "Stripe checkout mode: mock");
  });
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function isTestRuntime() {
  return isTestRuntimeEnv(process.env);
}

function isTestRuntimeEnv(env: NodeJS.ProcessEnv) {
  return (
    Boolean(env.NODE_TEST_CONTEXT) ||
    env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.includes("--test")
  );
}

export function resolveRuntimePlatformZkLoginConfig(env: NodeJS.ProcessEnv = process.env) {
  return resolvePlatformZkLoginConfigFromEnv(env, { allowDevelopmentDefaults: isTestRuntimeEnv(env) });
}

export function resolveHostedAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { allowDevelopmentDefaults = false }: { allowDevelopmentDefaults?: boolean } = {}
): HostedAuthConfig {
  const hostedAuthOrigin = String(
    env.CELERIS_HOSTED_AUTH_ORIGIN ?? (allowDevelopmentDefaults ? "https://auth.celeris.pro" : "")
  ).trim();
  const sessionSecret = String(
    env.CELERIS_SESSION_SECRET ?? (allowDevelopmentDefaults ? "celeris-session-dev-secret" : "")
  ).trim();

  if (!hostedAuthOrigin) {
    throw new Error("hosted auth origin is required");
  }
  if (!sessionSecret) {
    throw new Error("session secret is required");
  }

  return {
    hostedAuthOrigin,
    sessionSecret
  };
}

export function resolveSolanaRpcOriginFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return String(env.SOLANA_RPC_ORIGIN ?? "https://api.devnet.solana.com").trim() || "https://api.devnet.solana.com";
}
