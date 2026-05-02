import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createPrivyTestToken } from "../services/privy-auth-service.js";
import type { RelayerNetworkClient, TransactionStatus, WalletPrincipal } from "../types.js";

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

async function setupRelayerFlow(relayerNetworkClient: RelayerNetworkClient) {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xrelayer123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;
  const token = createPrivyTestToken(walletPrincipal);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "relayer-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Relayer App",
      priceCents: 499,
      credits: 500,
      privyAppId: "relayer-privy",
      allowedChainId: walletPrincipal.chainId
    }
  });

  const appId = app.body.appId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "relayer-action-1" },
    body: { actionType: "mint_item", cost: 50, executionMode: "managed" }
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "relayer-checkout-1", authorization: `Bearer ${token}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_relayer_1",
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
      "idempotency-key": "relayer-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, token, walletPrincipal };
}

test("relayer retries submission once on retryable network error and succeeds", async () => {
  let sendAttempts = 0;
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        throw Object.assign(new Error("temporary network issue"), { retryable: true });
      }
      return { txHash: "mock_chain_retry_success" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  };

  const { services, api, appId, token, walletPrincipal } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "relayer-mint-retry-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 200);
  assert.equal(sendAttempts, 2);
  const tx = [...services.store.transactions.values()][0];
  assert.equal(tx.providerTxId, "mock_chain_retry_success");
  assert.equal(tx.status, "success");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 450);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("relayer marks submitted transaction failed and releases credits", async () => {
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_failed" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "failed";
    }
  };

  const { services, api, appId, token, walletPrincipal } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "relayer-mint-failed-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction failed after submission");
  assert.equal(mint.body.details.status, "failed");
  const tx = [...services.store.transactions.values()][0];
  assert.equal(tx.providerTxId, "mock_chain_failed");
  assert.equal(tx.status, "failed");
  const pendingAction = [...services.store.pendingActions.values()][0];
  assert.equal(pendingAction.status, "failed");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
  assert.equal(services.store.assetDeliveries.size, 0);
});

test("relayer fails after one retryable submission retry and leaves no capture", async () => {
  let sendAttempts = 0;
  const networkClient: RelayerNetworkClient = {
    async sendTransaction() {
      sendAttempts += 1;
      throw Object.assign(new Error("network still down"), { retryable: true });
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      throw new Error("should not be called");
    }
  };

  const { services, api, appId, token, walletPrincipal } = await setupRelayerFlow(networkClient);
  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "relayer-mint-submit-error-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 502);
  assert.equal(mint.body.error, "transaction submission failed");
  assert.equal(mint.body.details.attempts, 2);
  assert.equal(sendAttempts, 2);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
