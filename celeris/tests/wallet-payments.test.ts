import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, signUpDeveloper } from "./helpers/developer.js";

function buildCompletedCheckoutEvent({
  eventId,
  checkoutSessionId,
  appId,
  walletAddress,
  chainId,
  credits,
  amountCents
}: {
  eventId: string;
  checkoutSessionId: string;
  appId: string;
  walletAddress: string;
  chainId: string;
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
          walletAddress,
          chainId,
          credits
        }
      }
    }
  };
}

async function createWalletPaymentHarness() {
  const services = buildServices();
  const api = createApi(services);
  const requestedWalletPrincipal = {
    walletAddress: "0xabc123",
    chainId: "sui:testnet"
  } satisfies { walletAddress: string; chainId: string };
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Wallet Payments Test",
    priceCents: 499,
    credits: 500,
    allowedChainId: requestedWalletPrincipal.chainId
  });

  const appId = app.appId as string;
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress: requestedWalletPrincipal.walletAddress,
    chainId: requestedWalletPrincipal.chainId
  });
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;
  const walletPrincipal = session.player;

  return {
    services,
    api,
    appId,
    packageId,
    token: session.accessToken,
    walletPrincipal
  };
}

test("POST /v1/apps/:appId/checkout-sessions creates a wallet-keyed Stripe checkout session", async () => {
  const { services, api, appId, packageId, token, walletPrincipal } = await createWalletPaymentHarness();

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "wallet-checkout-1"
    },
    body: {
      packageId
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.provider, "stripe");
  assert.match(response.body.checkoutSessionId as string, /^cs_test_/);
  assert.deepEqual(response.body.metadata, {
    appId,
    walletAddress: walletPrincipal.walletAddress,
    chainId: walletPrincipal.chainId,
    credits: 500
  });

  const storedPayment = services.store.getPaymentByProviderSessionId(response.body.checkoutSessionId as string)!;
  assert.equal(storedPayment.status, "pending");
  assert.equal(storedPayment.walletAddress, walletPrincipal.walletAddress);
  assert.equal(storedPayment.chainId, walletPrincipal.chainId);
  assert.deepEqual(storedPayment.metadata, response.body.metadata);
});

test("POST /v1/webhooks/stripe grants credits to the authenticated wallet once", async () => {
  const { services, api, appId, packageId, token, walletPrincipal } = await createWalletPaymentHarness();

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "wallet-checkout-2"
    },
    body: { packageId }
  });

  const event = buildCompletedCheckoutEvent({
    eventId: "evt_wallet_paid",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletAddress: walletPrincipal.walletAddress,
    chainId: walletPrincipal.chainId,
    credits: 500,
    amountCents: 499
  });
  const signature = services.stripeGateway.signWebhookPayload(event);

  const webhook = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "wallet-webhook-1",
      "stripe-signature": signature
    },
    body: event
  });

  assert.equal(webhook.statusCode, 200);
  assert.equal(webhook.body.status, "paid");
  assert.equal(webhook.body.walletAddress, walletPrincipal.walletAddress);
  assert.equal(webhook.body.chainId, walletPrincipal.chainId);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
});

test("wallet payment webhook idempotency and signature verification prevent duplicate grants", async () => {
  const { services, api, appId, packageId, token, walletPrincipal } = await createWalletPaymentHarness();

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "wallet-checkout-3"
    },
    body: { packageId }
  });

  const event = buildCompletedCheckoutEvent({
    eventId: "evt_wallet_manual",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletAddress: walletPrincipal.walletAddress,
    chainId: walletPrincipal.chainId,
    credits: 500,
    amountCents: 499
  });
  const validSignature = services.stripeGateway.signWebhookPayload(event);

  const first = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "wallet-webhook-2",
      "stripe-signature": validSignature
    },
    body: event
  });
  const duplicate = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "wallet-webhook-2",
      "stripe-signature": validSignature
    },
    body: event
  });
  const invalid = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "wallet-webhook-3",
      "stripe-signature": "bad-signature"
    },
    body: event
  });

  assert.equal(first.body.paymentId, duplicate.body.paymentId);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, "invalid stripe signature");

  const unauthorizedCheckout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "wallet-checkout-missing-auth" },
    body: { packageId: "pkg_missing" }
  });
  const removedCheckoutRoute = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "wallet-legacy-checkout" },
    body: {}
  });
  const removedWebhookRoute = await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: { "idempotency-key": "wallet-legacy-webhook" },
    body: {}
  });

  assert.equal(unauthorizedCheckout.statusCode, 401);
  assert.equal(unauthorizedCheckout.body.error, "authorization token required");
  assert.equal(removedCheckoutRoute.statusCode, 404);
  assert.equal(removedWebhookRoute.statusCode, 404);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});
