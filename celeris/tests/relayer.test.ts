import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { WalletPrincipal } from "../types.js";
import { getSolanaExplorerTransactionUrl } from "../solana/explorer.js";
import { MockRelayerNetwork } from "../services/mock-relayer-network.js";
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

async function setupRelayerFlow(relayerNetworkClient: MockRelayerNetwork) {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xrelayer123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Relayer App",
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
  const sponsorWallet = await provisionSponsorWallet({
    api,
    accessToken: developer.accessToken,
    appId
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "relayer-checkout-1", authorization: `Bearer ${session.accessToken}` },
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

  return { services, api, appId, token: session.accessToken, walletPrincipal, sponsorWallet };
}

test("relayer retries submission once on retryable network error and succeeds", async () => {
  let sendAttempts = 0;
  const networkClient = new MockRelayerNetwork({
    sendTransaction: async () => {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        throw Object.assign(new Error("temporary network issue"), { retryable: true });
      }
      return { txHash: "mock_chain_retry_success" };
    },
    confirmTransaction: async () => "success"
  });

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
  assert.equal(tx.explorerUrl, getSolanaExplorerTransactionUrl("mock_chain_retry_success"));
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 450);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("relayer marks submitted transaction failed and releases credits", async () => {
  const networkClient = new MockRelayerNetwork({
    sendTransaction: async () => ({ txHash: "mock_chain_failed" }),
    confirmTransaction: async () => "failed"
  });

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
  const networkClient = new MockRelayerNetwork({
    sendTransaction: async () => {
      sendAttempts += 1;
      throw Object.assign(new Error("network still down"), { retryable: true });
    },
    confirmTransaction: async () => {
      throw new Error("should not be called");
    }
  });

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

test("relayer rejects apps without a sponsor wallet", async () => {
  const services = buildServices({ relayerNetworkClient: new MockRelayerNetwork() });
  await assert.rejects(
    () =>
      services.relayerService.submitTransaction({
        appId: "missing-sponsor-app",
        sponsorWalletPublicKey: null,
        transaction: new Transaction()
      }),
    /sponsor wallet not provisioned/
  );
});

test("relayer rejects insufficient sponsor-wallet SOL before submission", async () => {
  const networkClient = new MockRelayerNetwork({
    balanceLamports: 50_000,
    feeLamports: 10_000
  });
  const { services, sponsorWallet, appId } = await setupRelayerFlow(networkClient);

  await assert.rejects(
    () =>
      services.relayerService.submitTransaction({
        appId,
        sponsorWalletPublicKey: sponsorWallet.publicKey,
        transaction: new Transaction().add(
          new TransactionInstruction({
            programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            keys: [],
            data: Buffer.from("insufficient-sol-test", "utf8")
          })
        )
      }),
    /insufficient SOL/
  );
});
