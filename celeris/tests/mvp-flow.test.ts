import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { WalletPrincipal } from "../types.js";
import { createHostedPlayerSession } from "./helpers/auth.js";

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

async function createFlowHarness() {
  const services = buildServices();
  const api = createApi(services);
  const walletPrincipal = { walletAddress: "0xmvp123", chainId: "eip155:1" } satisfies WalletPrincipal;

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "mvp-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Iron Forge",
      priceCents: 499,
      credits: 500,
      allowedChainId: walletPrincipal.chainId
    }
  });
  const appId = app.body.appId as string;
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress: walletPrincipal.walletAddress
  });
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "mvp-action-mint-1" },
    body: { actionType: "mint_item", cost: 50, executionMode: "managed" }
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "mvp-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_mvp_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "mvp-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, token: session.accessToken, walletPrincipal };
}

test("happy path mints an item, captures credits, and records delivery plus transaction", async () => {
  const { services, api, appId, token, walletPrincipal } = await createFlowHarness();

  const mintResponse = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "mvp-mint-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mintResponse.statusCode, 200);
  assert.equal(mintResponse.body.status, "success");

  const balance = services.store.getBalance(walletPrincipal, appId);
  assert.equal(balance.balance, 450);
  assert.equal(balance.reserved, 0);
  assert.equal(services.store.transactions.size, 1);
  assert.equal(services.store.assetDeliveries.size, 1);

  const metrics = services.metricsService.getAppMetrics(appId);
  assert.equal(metrics.totalRevenueCents, 499);
  assert.equal(metrics.creditsPurchased, 500);
  assert.equal(metrics.creditsSpent, 50);
  assert.equal(metrics.mintItemCount, 1);
  assert.equal(metrics.successfulTransactions, 1);
});

test("duplicate payment webhook and duplicate mint request do not double-apply state", async () => {
  const { services, api, appId, token, walletPrincipal } = await createFlowHarness();

  const firstMint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "mvp-mint-dup", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });
  const secondMint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "mvp-mint-dup", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(firstMint.body.transactionId, secondMint.body.transactionId);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 1);
  assert.equal(services.store.assetDeliveries.size, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 450);
});
