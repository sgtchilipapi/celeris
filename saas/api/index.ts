import { fileURLToPath } from "node:url";
import { createApi } from "./create-api.js";
import { MemoryStore } from "../db/memory-store.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";
import { PaymentService } from "../services/payment-service.js";
import { MockDeveloperClient } from "../services/mock-developer-client.js";
import { MockTransactionExecutor } from "../services/mock-transaction-executor.js";
import { MintItemService } from "../services/mint-item-service.js";
import { MetricsService } from "../services/metrics-service.js";
import { AppService } from "../services/app-service.js";
import { AuthService } from "../services/auth-service.js";
import { MockStripeGateway } from "../services/mock-stripe-gateway.js";
import { PendingActionService } from "../services/pending-action-service.js";

export function buildServices() {
  const store = new MemoryStore();
  const defaultDeveloper = store.createDeveloper({ email: "dev@celeris.local" });
  const ledgerService = new CreditLedgerService({ store });
  const stripeGateway = new MockStripeGateway();
  const pendingActionService = new PendingActionService({ store, ledgerService });
  const services = {
    store,
    authService: new AuthService({ store }),
    appService: new AppService({ store }),
    paymentService: new PaymentService({ store, ledgerService, stripeGateway }),
    mintItemService: new MintItemService({
      store,
      ledgerService,
      developerClient: new MockDeveloperClient(),
      executor: new MockTransactionExecutor(),
      pendingActionService
    }),
    metricsService: new MetricsService({ store }),
    stripeGateway,
    pendingActionService
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
