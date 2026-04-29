import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

function approvedDeveloperResponse(itemDefId = "iron_sword") {
  return new Response(
    JSON.stringify({
      status: "approved",
      tx: "bW9ja190eA==",
      summary: {
        actionType: "mint_item",
        itemDefId,
        debit: 50
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function rejectedDeveloperResponse(reason = "developer rejected action") {
  return new Response(
    JSON.stringify({
      status: "rejected",
      reason
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function buildCompletedCheckoutEvent({
  eventId,
  checkoutSessionId,
  userId,
  appId,
  credits,
  amountCents
}: {
  eventId: string;
  checkoutSessionId: string;
  userId: string;
  appId: string;
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
        metadata: { userId, appId, credits }
      }
    }
  };
}

type Harness = {
  services: ReturnType<typeof buildServices>;
  api: ReturnType<typeof createApi>;
  appId: string;
  userId: string;
  token: string;
  packageId: string;
  checkoutSessionId: string;
};

async function createHarness({
  developerFetch = async () => approvedDeveloperResponse(),
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
  developerFetch?: typeof fetch;
  relayerNetworkClient?: RelayerNetworkClient;
  checkoutCredits?: number;
} = {}): Promise<Harness> {
  const services = buildServices({ developerFetch, relayerNetworkClient });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "e2e-session-1" },
    body: { provider: "dummy", email: "e2e@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "e2e-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "End to End App",
      priceCents: 499,
      credits: checkoutCredits,
      webhookUrl: "http://localhost:3001"
    }
  });

  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const token = session.body.token as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "e2e-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "e2e-action-first-claim-1" },
    body: { actionType: "first_time_claim", cost: 50 }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "e2e-action-claim-1" },
    body: { actionType: "claim_rewards", cost: 25 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "e2e-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_e2e_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    userId,
    appId,
    credits: checkoutCredits,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "e2e-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return {
    services,
    api,
    appId,
    userId,
    token,
    packageId,
    checkoutSessionId: checkout.body.checkoutSessionId as string
  };
}

test("end-to-end happy path covers signup, credits, mint, asset, and dashboard metrics", async () => {
  const { services, api, appId, userId, token } = await createHarness();

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "e2e-mint-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(mint.body.status, "success");

  const asset = [...services.store.assets.values()][0];
  assert.equal(asset.userId, userId);
  assert.equal(asset.appId, appId);
  assert.equal(asset.status, "held");

  const metrics = await api.handle({
    method: "GET",
    url: `/metrics?appId=${appId}`
  });
  const dashboard = await api.handle({
    method: "GET",
    url: "/"
  });

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
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "e2e-mint-insufficient-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  const secondMint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "e2e-mint-insufficient-2",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  assert.equal(firstMint.statusCode, 200);
  assert.equal(secondMint.statusCode, 409);
  assert.equal(secondMint.body.error, "insufficient credits");
});

test("end-to-end claim rewards consumes configured credits", async () => {
  const { api, appId, userId, token, services } = await createHarness({ checkoutCredits: 100 });

  const claim = await api.handle({
    method: "POST",
    url: "/actions/claim_rewards",
    headers: {
      "idempotency-key": "e2e-claim-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId
    }
  });

  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.actionType, "claim_rewards");
  assert.equal(claim.body.debitedCredits, 25);
  assert.equal(claim.body.remainingCredits, 75);
  assert.equal(services.store.getBalance(userId, appId).balance, 75);
});

test("end-to-end first time claim consumes its higher configured credits", async () => {
  const { api, appId, userId, token, services } = await createHarness({ checkoutCredits: 100 });

  const claim = await api.handle({
    method: "POST",
    url: "/actions/claim_rewards",
    headers: {
      "idempotency-key": "e2e-first-claim-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      actionId: "first_time_claim"
    }
  });

  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.actionType, "first_time_claim");
  assert.equal(claim.body.debitedCredits, 50);
  assert.equal(claim.body.remainingCredits, 50);
  assert.equal(services.store.getBalance(userId, appId).balance, 50);
});

test("end-to-end duplicate payment webhook only grants credits once", async () => {
  const services = buildServices();
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "e2e-dup-session-1" },
    body: { provider: "dummy", email: "e2e-dup@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "e2e-dup-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Duplicate Webhook App",
      priceCents: 499,
      credits: 500,
      webhookUrl: "http://localhost:3001"
    }
  });

  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "e2e-dup-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_e2e_dup_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    userId,
    appId,
    credits: 500,
    amountCents: 499
  });

  const first = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const duplicate = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
});

test("end-to-end transaction failure returns error and does not create asset", async () => {
  const { services, api, appId, userId, token } = await createHarness({
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
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "e2e-mint-fail-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction failed after submission");
  assert.equal(services.store.assets.size, 0);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});

test("end-to-end developer rejection releases credits and returns an error", async () => {
  const { services, api, appId, userId, token } = await createHarness({
    developerFetch: async () => rejectedDeveloperResponse("developer says no")
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "e2e-mint-reject-1",
      authorization: `Bearer ${token}`
    },
    body: {
      appId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "developer says no");
  assert.equal(services.store.assets.size, 0);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});
