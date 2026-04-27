import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

type CapturedDeveloperRequest = {
  pendingActionId: string;
  appId: string;
  userId: string;
  actionType: string;
  cost: number;
  payload: { itemDefId: string };
};

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

test("mint_item posts pending action details to the developer webhook", async () => {
  let requestUrl = "";
  let requestHeaders: Record<string, string> = {};
  let requestBody: CapturedDeveloperRequest | null = null;

  const services = buildServices({
    developerFetch: async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers as Record<string, string>;
      requestBody = JSON.parse(String(init?.body ?? "{}")) as CapturedDeveloperRequest;
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
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "dev-int-session-1" },
    body: { provider: "dummy", email: "dev-int@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-int-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Developer Interaction App",
      priceCents: 499,
      credits: 500,
      webhookUrl: "http://localhost:3001"
    }
  });
  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "dev-int-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "dev-int-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_dev_int_1",
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
      "idempotency-key": "dev-int-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "dev-int-mint-1" },
    body: { appId, userId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(requestUrl, "http://localhost:3001");
  assert.equal(requestHeaders.authorization, `Bearer ${services.store.apps.get(appId)!.apiKey}`);
  assert.equal(requestHeaders["content-type"], "application/json");
  if (!requestBody) {
    throw new Error("expected developer webhook request body");
  }
  const developerRequest = requestBody as CapturedDeveloperRequest;
  assert.equal(developerRequest.appId, appId);
  assert.equal(developerRequest.userId, userId);
  assert.equal(developerRequest.actionType, "mint_item");
  assert.equal(developerRequest.cost, 50);
  assert.deepEqual(developerRequest.payload, { itemDefId: "iron_sword" });
  assert.equal(typeof developerRequest.pendingActionId, "string");
});

test("developer rejection releases credits, marks pending action failed, and returns an error", async () => {
  const services = buildServices({
    developerFetch: async () =>
      new Response(JSON.stringify({ status: "rejected", reason: "developer says no" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "dev-int-session-2" },
    body: { provider: "dummy", email: "dev-int-reject@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-int-app-2" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Developer Rejection App",
      priceCents: 499,
      credits: 500,
      webhookUrl: "http://localhost:3001"
    }
  });
  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "dev-int-action-2" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "dev-int-checkout-2" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_dev_int_2",
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
      "idempotency-key": "dev-int-webhook-2",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  const mint = await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: { "idempotency-key": "dev-int-mint-2" },
    body: { appId, userId, payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "developer says no");
  assert.equal(mint.body.details.status, "failed");
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(services.store.getBalance(userId, appId).reserved, 0);

  const pendingAction = [...services.store.pendingActions.values()].find((candidate) => candidate.appId === appId)!;
  assert.equal(pendingAction.status, "failed");
});
