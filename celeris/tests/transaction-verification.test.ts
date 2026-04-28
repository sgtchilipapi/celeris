import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

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
        metadata: {
          userId,
          appId,
          credits
        }
      }
    }
  };
}

async function setupMintFlow({
  developerFetch
}: {
  developerFetch: typeof fetch;
}) {
  const services = buildServices({ developerFetch });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "txv-session-1" },
    body: { provider: "dummy", email: "txv@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "txv-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Transaction Verification App",
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
    headers: { "idempotency-key": "txv-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "txv-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_txv_1",
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
      "idempotency-key": "txv-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, userId, token };
}

test("verification rejects mismatched debit and releases reserved credits", async () => {
  const { services, api, appId, userId, token } = await setupMintFlow({
    developerFetch: async () =>
      new Response(
        JSON.stringify({
          status: "approved",
          tx: "bW9ja190eA==",
          summary: {
            actionType: "mint_item",
            itemDefId: "iron_sword",
            debit: 75
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "txv-mint-debit-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "developer summary debit mismatch");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
  const pendingAction = [...services.store.pendingActions.values()].find((candidate) => candidate.appId === appId)!;
  assert.equal(pendingAction.status, "failed");
});

test("verification rejects invalid tx structure and releases reserved credits", async () => {
  const { services, api, appId, userId, token } = await setupMintFlow({
    developerFetch: async () =>
      new Response(
        JSON.stringify({
          status: "approved",
          tx: "not base64!!!",
          summary: {
            actionType: "mint_item",
            itemDefId: "iron_sword",
            debit: 50
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "txv-mint-tx-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "developer tx failed basic sanity checks");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});

test("verification rejects disallowed action types and releases reserved credits", async () => {
  const { services, api, appId, userId, token } = await setupMintFlow({
    developerFetch: async () =>
      new Response(
        JSON.stringify({
          status: "approved",
          tx: "bW9ja190eA==",
          summary: {
            actionType: "burn_item",
            itemDefId: "iron_sword",
            debit: 50
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "txv-mint-action-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "developer summary action type not allowed");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});

test("verification rejects when pending action disappears before execution", async () => {
  const { services, api, appId, userId, token } = await setupMintFlow({
    developerFetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { pendingActionId: string };
      services.store.pendingActions.delete(request.pendingActionId);
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
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "txv-mint-pa-1", authorization: `Bearer ${token}` },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "pending action not found during verification");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);
});
