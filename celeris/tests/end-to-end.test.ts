import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createPrivyTestToken } from "../services/privy-auth-service.js";
import type { RelayerNetworkClient, TransactionStatus, WalletPrincipal } from "../types.js";

function buildCompletedCheckoutEvent({
  eventId,
  checkoutSessionId,
  appId,
  walletPrincipal,
  credits,
  amountCents
}: {
  eventId: string;
  checkoutSessionId: string;
  appId: string;
  walletPrincipal: WalletPrincipal;
  credits: number;
  amountCents: number;
}) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutSessionId,
        amount_total: amountCents,
        metadata: {
          appId,
          walletAddress: walletPrincipal.walletAddress,
          chainId: walletPrincipal.chainId,
          credits
        }
      }
    }
  };
}

type Harness = {
  services: ReturnType<typeof buildServices>;
  api: ReturnType<typeof createApi>;
  appId: string;
  token: string;
  walletPrincipal: WalletPrincipal;
};

async function createHarness({
  relayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_e2e_success" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  } satisfies RelayerNetworkClient,
  checkoutCredits = 500
}: {
  relayerNetworkClient?: RelayerNetworkClient;
  checkoutCredits?: number;
} = {}): Promise<Harness> {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xe2e123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;
  const token = createPrivyTestToken(walletPrincipal);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "e2e-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "End to End App",
      priceCents: 499,
      credits: checkoutCredits,
      allowedChainId: walletPrincipal.chainId
    }
  });

  const appId = app.body.appId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  for (const [key, actionType, cost] of [
    ["e2e-action-mint-1", "mint_item", 50],
    ["e2e-action-first-claim-1", "first_time_claim", 50],
    ["e2e-action-claim-1", "claim_rewards", 25]
  ] as const) {
    await api.handle({
      method: "POST",
      url: `/apps/${appId}/actions`,
      headers: { "idempotency-key": key },
      body: { actionType, cost, executionMode: "managed" }
    });
  }

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "e2e-checkout-1", authorization: `Bearer ${token}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_e2e_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits: checkoutCredits,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "e2e-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, token, walletPrincipal };
}

test("end-to-end happy path covers checkout, mint, wallet delivery, and dashboard metrics", async () => {
  const { services, api, appId, token, walletPrincipal } = await createHarness();

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "e2e-mint-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(mint.body.status, "success");

  const delivery = [...services.store.assetDeliveries.values()][0];
  assert.equal(delivery.walletAddress, walletPrincipal.walletAddress);
  assert.equal(delivery.appId, appId);
  assert.equal(delivery.status, "confirmed");

  const metrics = await api.handle({ method: "GET", url: `/metrics?appId=${appId}` });
  const dashboard = await api.handle({ method: "GET", url: "/" });

  assert.equal(metrics.body.totalUsers, 1);
  assert.equal(metrics.body.totalRevenueCents, 499);
  assert.equal(metrics.body.creditsPurchased, 500);
  assert.equal(metrics.body.creditsSpent, 50);
  assert.equal(metrics.body.mintItemCount, 1);
  assert.equal(metrics.body.successfulTransactions, 1);
  assert.equal(metrics.body.failedTransactions, 0);
  assert.match(String(dashboard.body), /Celeris Dashboard/);
});

test("end-to-end insufficient credits blocks the next mint", async () => {
  const { api, appId, token } = await createHarness({ checkoutCredits: 50 });

  const firstMint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "e2e-mint-insufficient-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  const secondMint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "e2e-mint-insufficient-2", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(firstMint.statusCode, 200);
  assert.equal(secondMint.statusCode, 409);
  assert.equal(secondMint.body.error, "insufficient credits");
});

test("end-to-end claim rewards consumes configured credits", async () => {
  const { api, appId, token, walletPrincipal, services } = await createHarness({ checkoutCredits: 100 });

  const claim = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/claim_rewards/execute`,
    headers: { "idempotency-key": "e2e-claim-1", authorization: `Bearer ${token}` },
    body: {}
  });

  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.actionType, "claim_rewards");
  assert.equal(claim.body.debitedCredits, 25);
  assert.equal(claim.body.remainingCredits, 75);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 75);
});

test("end-to-end first time claim consumes its higher configured credits", async () => {
  const { api, appId, token, walletPrincipal, services } = await createHarness({ checkoutCredits: 100 });

  const claim = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/first_time_claim/execute`,
    headers: { "idempotency-key": "e2e-first-claim-1", authorization: `Bearer ${token}` },
    body: {}
  });

  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.actionType, "first_time_claim");
  assert.equal(claim.body.debitedCredits, 50);
  assert.equal(claim.body.remainingCredits, 50);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 50);
});

test("end-to-end duplicate payment webhook only grants credits once", async () => {
  const services = buildServices();
  const api = createApi(services);
  const walletPrincipal = { walletAddress: "0xe2edup123", chainId: "eip155:1" } satisfies WalletPrincipal;
  const token = createPrivyTestToken(walletPrincipal);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "e2e-dup-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Duplicate Webhook App",
      priceCents: 499,
      credits: 500,
      allowedChainId: walletPrincipal.chainId
    }
  });

  const appId = app.body.appId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "e2e-dup-checkout-1", authorization: `Bearer ${token}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_e2e_dup_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits: 500,
    amountCents: 499
  });

  const first = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const duplicate = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
});

test("end-to-end transaction failure returns error and does not create delivery record", async () => {
  const { services, api, appId, token, walletPrincipal } = await createHarness({
    relayerNetworkClient: {
      async sendTransaction() {
        return { txHash: "mock_chain_e2e_failed" };
      },
      async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
        return "failed";
      }
    }
  });

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "e2e-mint-fail-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction failed after submission");
  assert.equal(services.store.assetDeliveries.size, 0);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
