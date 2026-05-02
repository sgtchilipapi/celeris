import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { RelayerNetworkClient, TransactionStatus, WalletPrincipal } from "../types.js";
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

async function setupAssetFlow(relayerNetworkClient: RelayerNetworkClient) {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xasset123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "asset-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Asset App",
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
    headers: { "idempotency-key": "asset-action-1" },
    body: { actionType: "mint_item", cost: 50, executionMode: "managed" }
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "asset-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_asset_1",
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
      "idempotency-key": "asset-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, token: session.accessToken, walletPrincipal };
}

test("successful mint captures credits and records confirmed wallet delivery metadata", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_asset_success" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  };

  const { services, api, appId, token, walletPrincipal } = await setupAssetFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "asset-mint-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 1);
  assert.equal(services.store.assetDeliveries.size, 1);

  const delivery = [...services.store.assetDeliveries.values()][0];
  const transaction = [...services.store.transactions.values()][0];
  assert.equal(delivery.walletAddress, walletPrincipal.walletAddress);
  assert.equal(delivery.chainId, walletPrincipal.chainId);
  assert.equal(delivery.appId, appId);
  assert.equal(delivery.transactionId, transaction.txId);
  assert.equal(delivery.itemDefId, "iron_sword");
  assert.equal(delivery.destinationWalletAddress, walletPrincipal.walletAddress);
  assert.equal(delivery.status, "confirmed");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 450);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("failed transaction does not create a delivery record and releases credits", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_asset_failed" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "failed";
    }
  };

  const { services, api, appId, token, walletPrincipal } = await setupAssetFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "asset-mint-2", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(services.store.assetDeliveries.size, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
