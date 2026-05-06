import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { AssetDeliveryService } from "../services/asset-delivery-service.js";
import { ManagedActionService } from "../services/managed-action-service.js";
import type { WalletPrincipal } from "../types.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, configureDeveloperAction, provisionSponsorWallet, signUpDeveloper } from "./helpers/developer.js";

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

async function createManagedActionHarness() {
  const services = buildServices();
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xmanaged123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Managed Actions App",
    priceCents: 499,
    credits: 500,
    allowedChainId: walletPrincipal.chainId
  });

  const appId = app.appId as string;
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress: walletPrincipal.walletAddress
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
  await provisionSponsorWallet({
    api,
    accessToken: developer.accessToken,
    appId
  });
  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId,
    actionType: "claim_rewards",
    cost: 25,
    executionMode: "managed"
  });
  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId,
    actionType: "first_time_claim",
    cost: 50,
    executionMode: "managed"
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "managed-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_managed_1",
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
      "idempotency-key": "managed-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, walletPrincipal, token: session.accessToken };
}

test("ManagedActionService validates mint payloads and claim action ids", () => {
  const service = new ManagedActionService();

  assert.throws(
    () =>
      service.buildMintItemTransaction({
        pendingActionId: "pending-1",
        appId: "app-1",
        walletPrincipal: { walletAddress: "0xabc", chainId: "eip155:1" },
        cost: 50,
        payload: { itemDefId: "" }
      }),
    /itemDefId is required/
  );
  assert.throws(() => service.validateClaimRewardsRequest({ actionId: "bad_action" as "claim_rewards" }), /unsupported claim rewards action id/);
});

test("AssetDeliveryService records confirmed wallet delivery metadata", () => {
  const services = buildServices();
  const walletPrincipal = { walletAddress: "0xdelivery", chainId: "eip155:1" } satisfies WalletPrincipal;
  const deliveryService = new AssetDeliveryService({ store: services.store });
  const developer = services.store.createDeveloper({ email: "delivery@test.local" });
  const app = services.store.createApp({ developerId: developer.developerId, name: "Delivery App", apiKey: "key_delivery" });
  const transaction = services.store.createTransaction({
    txId: "tx-delivery-1",
    pendingActionId: "pending-delivery-1",
    appId: app.appId,
    walletAddress: walletPrincipal.walletAddress,
    chainId: walletPrincipal.chainId,
    providerTxId: "provider-delivery-1",
    rawTx: Buffer.from("delivery").toString("base64"),
    status: "success",
    summary: { actionType: "mint_item", itemDefId: "iron_sword", debit: 50 },
    createdAt: new Date().toISOString()
  });

  const delivery = deliveryService.createDeliveryRecord({
    appId: app.appId,
    walletPrincipal,
    itemDefId: "iron_sword",
    transactionId: transaction.txId,
    idempotencyKey: "delivery-1"
  });

  assert.equal(delivery.destinationWalletAddress, walletPrincipal.walletAddress);
  assert.equal(delivery.status, "confirmed");
});

test("managed action routes execute mint and reward claims without any developer webhook dependency", async () => {
  const { services, api, appId, walletPrincipal, token } = await createManagedActionHarness();

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "managed-mint-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });
  const claim = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/claim_rewards/execute`,
    headers: { "idempotency-key": "managed-claim-1", authorization: `Bearer ${token}` },
    body: {}
  });
  const firstTimeClaim = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/first_time_claim/execute`,
    headers: { "idempotency-key": "managed-claim-2", authorization: `Bearer ${token}` },
    body: {}
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(claim.statusCode, 200);
  assert.equal(firstTimeClaim.statusCode, 200);
  assert.equal(claim.body.remainingCredits, 425);
  assert.equal(firstTimeClaim.body.remainingCredits, 375);
  assert.equal(services.store.assetDeliveries.size, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 375);
});

test("unsupported managed action ids are rejected on the unified execute route", async () => {
  const { api, appId, token } = await createManagedActionHarness();

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/burn_item/execute`,
    headers: { "idempotency-key": "managed-unsupported-1", authorization: `Bearer ${token}` },
    body: {}
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "action not supported");
});
