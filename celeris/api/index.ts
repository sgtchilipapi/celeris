import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./create-api.js";
import { MemoryStore } from "../db/memory-store.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";
import { PaymentService } from "../services/payment-service.js";
import { DeveloperBackendClient } from "../services/developer-backend-client.js";
import { MintItemService } from "../services/mint-item-service.js";
import { MetricsService } from "../services/metrics-service.js";
import { AppService } from "../services/app-service.js";
import { AuthService } from "../services/auth-service.js";
import { MockStripeGateway } from "../services/mock-stripe-gateway.js";
import { StripeTestCheckoutGateway } from "../services/stripe-test-checkout-gateway.js";
import { PendingActionService } from "../services/pending-action-service.js";
import { RelayerService } from "../services/relayer-service.js";
import { MockRelayerNetwork } from "../services/mock-relayer-network.js";
import { AssetService } from "../services/asset-service.js";
import { ClaimRewardsService } from "../services/claim-rewards-service.js";
import type { RelayerNetworkClient } from "../types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

loadDotEnv(path.join(projectRoot, ".env"));
loadDotEnv(path.join(projectRoot, ".env.local"));

const enableStripeCheckout = Boolean(process.env.STRIPE_SECRET_KEY) && !isTestRuntime();

export function buildServices({
  developerFetch = fetch,
  relayerNetworkClient = new MockRelayerNetwork()
}: {
  developerFetch?: typeof fetch;
  relayerNetworkClient?: RelayerNetworkClient;
} = {}) {
  const store = new MemoryStore();
  const defaultDeveloper = store.createDeveloper({ email: "dev@celeris.local" });
  const ledgerService = new CreditLedgerService({ store });
  const stripeGateway = new MockStripeGateway();
  const stripeCheckoutGateway = enableStripeCheckout
    ? new StripeTestCheckoutGateway({ secretKey: process.env.STRIPE_SECRET_KEY! })
    : null;
  const pendingActionService = new PendingActionService({ store, ledgerService });
  const relayerService = new RelayerService({ networkClient: relayerNetworkClient });
  const assetService = new AssetService({ store });
  const services = {
    store,
    authService: new AuthService({ store }),
    appService: new AppService({ store }),
    paymentService: new PaymentService({ store, ledgerService, stripeCheckoutGateway, stripeGateway }),
    claimRewardsService: new ClaimRewardsService({ store, ledgerService }),
    mintItemService: new MintItemService({
      store,
      ledgerService,
      developerClient: new DeveloperBackendClient({ store, fetchImpl: developerFetch }),
      relayerService,
      pendingActionService,
      assetService
    }),
    metricsService: new MetricsService({ store }),
    stripeGateway,
    pendingActionService,
    relayerService,
    assetService
  };
  return { ...services, defaultDeveloper };
}

const services = buildServices();
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
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
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === "test";
}
