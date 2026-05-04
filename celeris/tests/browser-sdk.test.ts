import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createBrowserClient } from "../sdk/browser-client.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, configureDeveloperAction, signUpDeveloper } from "./helpers/developer.js";

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

test("browser SDK composes player routes with bearer auth and rejects missing tokens", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: "app_123",
    tokenProvider: async () => "privy-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await client.me.get();
  await client.catalog.get();
  await client.credits.getBalance();
  await client.payments.createCheckoutSession({
    packageId: "pkg_123",
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    idempotencyKey: "checkout-1"
  });
  await client.actions.execute("mint_item", { itemDefId: "iron_sword" }, { idempotencyKey: "mint-1" });
  await client.assets.getHistory();

  assert.deepEqual(
    requests.map((entry) => entry.url),
    [
      "/api/v1/me",
      "/api/v1/apps/app_123/catalog",
      "/api/v1/apps/app_123/me/credits",
      "/api/v1/apps/app_123/checkout-sessions",
      "/api/v1/apps/app_123/actions/mint_item/execute",
      "/api/v1/apps/app_123/me/asset-history"
    ]
  );

  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer privy-token");
  }

  const checkoutBody = JSON.parse(String(requests[3].init?.body));
  assert.equal(checkoutBody.packageId, "pkg_123");
  assert.equal(checkoutBody.walletAddress, undefined);
  assert.equal(checkoutBody.userId, undefined);

  const actionBody = JSON.parse(String(requests[4].init?.body));
  assert.deepEqual(actionBody, {
    payload: { itemDefId: "iron_sword" },
    idempotencyKey: "mint-1"
  });

  const missingTokenClient = createBrowserClient({
    apiBaseUrl: "/api",
    appId: "app_123",
    tokenProvider: async () => "",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  await assert.rejects(() => missingTokenClient.me.get(), /player session is required/);
});

test("player catalog and asset history routes support the standalone browser SDK flow", async () => {
  const services = buildServices();
  const api = createApi(services);
  const walletAddress = "0xdemo123";
  const chainId = "eip155:1";
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Browser SDK App",
    priceCents: 499,
    credits: 500,
    allowedChainId: chainId
  });

  const appId = app.appId as string;
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress
  });
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId,
    actionType: "mint_item",
    cost: 50,
    executionMode: "managed"
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "browser-sdk-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_browser_sdk_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletAddress,
    chainId,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "browser-sdk-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "browser-sdk-mint-1", authorization: `Bearer ${session.accessToken}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  const catalog = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/catalog`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  const assetHistory = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/me/asset-history`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.name, "Browser SDK App");
  assert.equal(catalog.body.playerPolicy.allowedChainId, chainId);
  assert.equal(catalog.body.creditPackages[0].packageId, packageId);
  assert.equal(catalog.body.actions[0].actionType, "mint_item");

  assert.equal(assetHistory.statusCode, 200);
  assert.equal(assetHistory.body.walletAddress, walletAddress);
  assert.equal(assetHistory.body.chainId, chainId);
  assert.equal(assetHistory.body.deliveries.length, 1);
  assert.equal(assetHistory.body.deliveries[0].destinationWalletAddress, walletAddress);
});

test("legacy API-served demo frontend routes and demo checkout completion helper are removed", async () => {
  const services = buildServices();
  const api = createApi(services);

  for (const [method, url] of [
    ["GET", "/demo"],
    ["GET", "/demo/app.js"],
    ["GET", "/demo/styles.css"],
    ["POST", "/demo/checkout/complete"]
  ] as const) {
    const response = await api.handle({
      method,
      url,
      headers: method === "POST" ? { "idempotency-key": `removed-${url}` } : undefined,
      body: method === "POST" ? {} : undefined
    });
    assert.equal(response.statusCode, 404);
  }
});
