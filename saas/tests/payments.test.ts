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

test("POST /checkout/session creates a stripe checkout session with attached metadata", async () => {
  const services = buildServices();
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "pay-session-user" },
    body: { provider: "dummy", email: "payments@example.com" }
  });
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "pay-app" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Payments Test",
      priceCents: 499,
      credits: 500
    }
  });

  const response = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "checkout-session-1" },
    body: {
      appId: app.body.appId as string,
      userId: session.body.userId as string,
      packageId: app.body.defaultCreditPackage.packageId as string,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.provider, "stripe");
  assert.match(response.body.checkoutSessionId as string, /^cs_test_/);
  assert.match(response.body.checkoutUrl as string, /^https:\/\/checkout\.stripe\.local\/session\//);
  assert.deepEqual(response.body.metadata, {
    userId: session.body.userId,
    appId: app.body.appId,
    credits: 500
  });

  const storedPayment = services.store.getPaymentByProviderSessionId(response.body.checkoutSessionId as string)!;
  assert.equal(storedPayment.status, "pending");
  assert.deepEqual(storedPayment.metadata, response.body.metadata);
});

test("POST /webhooks/payment verifies the stripe event, records payment state, and grants credits once", async () => {
  const services = buildServices();
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "pay-webhook-user" },
    body: { provider: "dummy", email: "webhook@example.com" }
  });
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "pay-webhook-app" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Webhook Test",
      priceCents: 499,
      credits: 500
    }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "pay-webhook-checkout" },
    body: {
      appId: app.body.appId as string,
      userId: session.body.userId as string,
      packageId: app.body.defaultCreditPackage.packageId as string
    }
  });

  const event = buildCompletedCheckoutEvent({
    eventId: "evt_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    userId: session.body.userId as string,
    appId: app.body.appId as string,
    credits: 500,
    amountCents: 499
  });
  const signature = services.stripeGateway.signWebhookPayload(event);

  const webhook = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "pay-webhook-1",
      "stripe-signature": signature
    },
    body: event
  });

  assert.equal(webhook.statusCode, 200);
  assert.equal(webhook.body.status, "paid");
  assert.equal(webhook.body.grantedCredits, 500);
  assert.equal(services.store.getBalance(session.body.userId as string, app.body.appId as string).balance, 500);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);

  const payment = services.store.getPaymentByProviderSessionId(checkout.body.checkoutSessionId as string)!;
  assert.equal(payment.providerEventId, "evt_1");
  assert.equal(payment.status, "paid");
});

test("payment webhook idempotency and signature verification prevent duplicate grants", async () => {
  const services = buildServices();
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "pay-idem-user" },
    body: { provider: "dummy", email: "idem@example.com" }
  });
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "pay-idem-app" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Idempotent Pay",
      priceCents: 499,
      credits: 500
    }
  });

  const event = buildCompletedCheckoutEvent({
    eventId: "evt_new_payment",
    checkoutSessionId: "cs_test_manual_event",
    userId: session.body.userId as string,
    appId: app.body.appId as string,
    credits: 500,
    amountCents: 499
  });
  const validSignature = services.stripeGateway.signWebhookPayload(event);

  const first = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "pay-idem-1",
      "stripe-signature": validSignature
    },
    body: event
  });
  const duplicate = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "pay-idem-1",
      "stripe-signature": validSignature
    },
    body: event
  });
  const invalid = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "pay-idem-2",
      "stripe-signature": "bad-signature"
    },
    body: event
  });

  assert.equal(first.body.paymentId, duplicate.body.paymentId);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.getBalance(session.body.userId as string, app.body.appId as string).balance, 500);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, "invalid stripe signature");
});
