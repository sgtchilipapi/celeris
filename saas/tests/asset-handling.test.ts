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

async function setupAssetFlow(relayerNetworkClient: RelayerNetworkClient) {
  const services = buildServices({
    developerFetch: async () => approvedDeveloperResponse(),
    relayerNetworkClient
  });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "asset-session-1" },
    body: { provider: "dummy", email: "asset@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "asset-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Asset App",
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
    headers: { "idempotency-key": "asset-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "asset-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_asset_1",
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
      "idempotency-key": "asset-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, userId, token };
}

test("successful mint captures credits and creates a held asset linked to the user", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_asset_success" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  };

  const { services, api, appId, userId, token } = await setupAssetFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "asset-mint-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 1);
  assert.equal(services.store.assets.size, 1);

  const asset = [...services.store.assets.values()][0];
  const transaction = [...services.store.transactions.values()][0];
  assert.equal(asset.userId, userId);
  assert.equal(asset.appId, appId);
  assert.equal(asset.transactionId, transaction.txId);
  assert.equal(asset.itemDefId, "iron_sword");
  assert.equal(asset.status, "held");
  assert.equal(services.store.getBalance(userId, appId).balance, 450);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});

test("failed transaction does not create an asset and releases credits", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_asset_failed" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "failed";
    }
  };

  const { services, api, appId, userId, token } = await setupAssetFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "asset-mint-2", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(services.store.assets.size, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});
