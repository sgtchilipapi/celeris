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
import { PendingActionService } from "../services/pending-action-service.js";
import { RelayerService } from "../services/relayer-service.js";
import { MockRelayerNetwork } from "../services/mock-relayer-network.js";
import { AssetService } from "../services/asset-service.js";
import type { RelayerNetworkClient } from "../types.js";

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
  const pendingActionService = new PendingActionService({ store, ledgerService });
  const relayerService = new RelayerService({ networkClient: relayerNetworkClient });
  const assetService = new AssetService({ store });
  const services = {
    store,
    authService: new AuthService({ store }),
    appService: new AppService({ store }),
    paymentService: new PaymentService({ store, ledgerService, stripeGateway }),
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
  });
}
