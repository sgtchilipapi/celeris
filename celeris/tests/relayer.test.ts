import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

function approvedDeveloperResponse() {
  return new Response(
    JSON.stringify({
      status: "approved",
      tx: "bW9ja190eA==",
      summary: {
        actionType: "mint_item",
        itemDefId: "iron_sword",
        debit: 50
      }
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

async function setupRelayerFlow(relayerNetworkClient: RelayerNetworkClient) {
  const services = buildServices({
    developerFetch: async () => approvedDeveloperResponse(),
    relayerNetworkClient
  });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "relayer-session-1" },
    body: { provider: "dummy", email: "relayer@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "relayer-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Relayer App",
      priceCents: 499,
      credits: 500,
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
    headers: { "idempotency-key": "relayer-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "relayer-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_relayer_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    userId,
    appId,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "relayer-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, userId, token };
}

test("relayer retries submission once on retryable network error and succeeds", async () => {
  let sendAttempts = 0;
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        throw Object.assign(new Error("temporary network issue"), { retryable: true });
      }
      return { txHash: "mock_chain_retry_success" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  };

  const { services, api, appId, userId, token } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "relayer-mint-retry-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(sendAttempts, 2);
  const tx = [...services.store.transactions.values()][0];
  assert.equal(tx.providerTxId, "mock_chain_retry_success");
  assert.equal(tx.status, "success");
  assert.equal(services.store.getBalance(userId, appId).balance, 450);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});

test("relayer marks submitted transaction failed and releases credits", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_failed" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "failed";
    }
  };

  const { services, api, appId, userId, token } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "relayer-mint-failed-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction failed after submission");
  assert.equal(mint.body.details.status, "failed");
  const tx = [...services.store.transactions.values()][0];
  assert.equal(tx.providerTxId, "mock_chain_failed");
  assert.equal(tx.status, "failed");
  const pendingAction = [...services.store.pendingActions.values()][0];
  assert.equal(pendingAction.status, "failed");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
  assert.equal(services.store.assets.size, 0);
});

test("relayer fails after one retryable submission retry and leaves no capture", async () => {
  let sendAttempts = 0;
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      sendAttempts += 1;
      throw Object.assign(new Error("network still down"), { retryable: true });
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      throw new Error("should not be called");
    }
  };

  const { services, api, appId, userId, token } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "relayer-mint-submit-error-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction submission failed");
  assert.equal(mint.body.details.attempts, 2);
  assert.equal(sendAttempts, 2);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});
