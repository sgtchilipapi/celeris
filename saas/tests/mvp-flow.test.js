import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

function buildCompletedCheckoutEvent({ eventId, checkoutSessionId, userId, appId, credits, amountCents }) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutSessionId,
        amount_total: amountCents,
        metadata: {
          userId,
          appId,
          credits
        }
      }
    }
  };
}

test("happy path mints an item, captures credits, and records asset plus transaction", async () => {
  process.env.NODE_ENV = "test";
  const services = buildServices();
  const api = createApi(services);

  const sessionResponse = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-1" },
    body: { provider: "dummy", email: "player-happy@example.com" }
  });
  const userId = sessionResponse.body.userId;

  const appResponse = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Iron Forge",
      priceCents: 499,
      credits: 500
    }
  });
  const appId = appResponse.body.appId;
  const packageId = appResponse.body.defaultCreditPackage.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkoutResponse = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_happy_path",
    checkoutSessionId: checkoutResponse.body.checkoutSessionId,
    userId,
    appId,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const mintResponse = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "mint-1" },
    body: {
      appId,
      userId,
      payload: { itemDefId: "iron_sword" }
    }
  });

  assert.equal(mintResponse.statusCode, 200);
  assert.equal(mintResponse.body.status, "success");

  const balance = services.store.getBalance(userId, appId);
  assert.equal(balance.balance, 450);
  assert.equal(balance.reserved, 0);

  assert.equal(services.store.transactions.size, 1);
  assert.equal(services.store.assets.size, 1);

  const metrics = services.metricsService.getAppMetrics(appId);
  assert.equal(metrics.totalRevenueCents, 499);
  assert.equal(metrics.creditsPurchased, 500);
  assert.equal(metrics.creditsSpent, 50);
  assert.equal(metrics.mintItemCount, 1);
  assert.equal(metrics.successfulTransactions, 1);
});

test("duplicate payment webhook and duplicate mint request do not double-apply state", async () => {
  process.env.NODE_ENV = "test";
  const services = buildServices();
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-dup" },
    body: { provider: "dummy", email: "player-dup@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "app-dup" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Duplicate Test",
      priceCents: 499,
      credits: 500
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId}/actions`,
    headers: { "idempotency-key": "action-dup" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "checkout-dup" },
    body: { appId: app.body.appId, userId: session.body.userId, packageId: app.body.defaultCreditPackage.packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_dup",
    checkoutSessionId: checkout.body.checkoutSessionId,
    userId: session.body.userId,
    appId: app.body.appId,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "webhook-dup",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });
  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "webhook-dup",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const firstMint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "mint-dup" },
    body: { appId: app.body.appId, userId: session.body.userId, payload: { itemDefId: "iron_sword" } }
  });
  const secondMint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "mint-dup" },
    body: { appId: app.body.appId, userId: session.body.userId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(firstMint.body.transactionId, secondMint.body.transactionId);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 1);
  assert.equal(services.store.assets.size, 1);
  assert.equal(services.store.getBalance(session.body.userId, app.body.appId).balance, 450);
});
