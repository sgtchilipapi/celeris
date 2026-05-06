import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { getSolanaExplorerTransactionUrl } from "../solana/explorer.js";
import { MockRelayerNetwork } from "../services/mock-relayer-network.js";
import type { WalletPrincipal } from "../types.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import {
  createDeveloperApp,
  configureDeveloperAction,
  provisionSponsorWallet,
  registerProgram,
  signUpDeveloper
} from "./helpers/developer.js";

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

async function fundPlayer({
  api,
  services,
  appId,
  walletPrincipal,
  credits = 100,
  amountCents = 499,
  eventId
}: {
  api: ReturnType<typeof createApi>;
  services: ReturnType<typeof buildServices>;
  appId: string;
  walletPrincipal: WalletPrincipal;
  credits?: number;
  amountCents?: number;
  eventId: string;
}) {
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress: walletPrincipal.walletAddress,
    chainId: walletPrincipal.chainId
  });
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": `${eventId}:checkout`, authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId,
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits,
    amountCents
  });

  await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": `${eventId}:webhook`,
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return {
    ...session,
    walletPrincipal: session.player satisfies WalletPrincipal
  };
}

async function createSayHelloHarness({
  relayerNetworkClient = new MockRelayerNetwork({
    sendTransaction: async () => ({ txHash: Keypair.generate().publicKey.toBase58() }),
    confirmTransaction: async () => "success"
  })
}: {
  relayerNetworkClient?: MockRelayerNetwork;
} = {}) {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });
  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Hello Celeris App",
    priceCents: 499,
    credits: 100,
    allowedChainId: "solana:103"
  });
  const appId = app.appId as string;

  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId,
    actionType: "say_hello",
    cost: 25,
    executionMode: "managed"
  });

  const sponsorWallet = await provisionSponsorWallet({
    api,
    accessToken: developer.accessToken,
    appId
  });
  const registeredProgram = await registerProgram({
    api,
    accessToken: developer.accessToken,
    appId,
    programId: Keypair.generate().publicKey.toBase58()
  });

  const walletPrincipal = {
    walletAddress: Keypair.generate().publicKey.toBase58(),
    chainId: "solana:103"
  } satisfies WalletPrincipal;
  const session = await fundPlayer({
    api,
    services,
    appId,
    walletPrincipal,
    eventId: "evt-say-hello-1"
  });

  return {
    services,
    api,
    developer,
    appId,
    walletPrincipal: session.walletPrincipal,
    session,
    sponsorWallet,
    registeredProgram
  };
}

test("say_hello executes successfully, captures credits, and appears in the app-wide player feed", async () => {
  const txHash = Keypair.generate().publicKey.toBase58();
  const { services, api, appId, walletPrincipal, session, sponsorWallet, registeredProgram } = await createSayHelloHarness({
    relayerNetworkClient: new MockRelayerNetwork({
      sendTransaction: async () => ({ txHash }),
      confirmTransaction: async () => "success"
    })
  });

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-exec-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      payload: {
        username: "  Sam  "
      }
    }
  });
  const catalog = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/catalog`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  const feed = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/transactions`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.username, "Sam");
  assert.equal(response.body.message, "Sam says Hello Celeris!");
  assert.equal(response.body.providerTxId, txHash);
  assert.equal(response.body.explorerUrl, getSolanaExplorerTransactionUrl(txHash));
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 75);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);

  const transaction = [...services.store.transactions.values()][0];
  assert.equal(transaction.summary.actionType, "say_hello");
  if (transaction.summary.actionType !== "say_hello") {
    throw new Error("expected say_hello summary");
  }
  assert.equal(transaction.summary.username, "Sam");
  assert.equal(transaction.summary.message, "Sam says Hello Celeris!");
  assert.equal(transaction.summary.sponsorWalletPublicKey, sponsorWallet.publicKey);
  assert.equal(transaction.summary.playerWalletAddress, walletPrincipal.walletAddress);
  assert.equal(transaction.summary.providerTxId, txHash);
  assert.equal(transaction.summary.explorerUrl, getSolanaExplorerTransactionUrl(txHash));
  assert.equal(transaction.summary.status, "success");

  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.registeredProgram.programId, registeredProgram.programId);
  assert.equal(catalog.body.actions.some((action: { actionType: string }) => action.actionType === "say_hello"), true);

  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.length, 1);
  assert.deepEqual(feed.body[0], {
    transactionId: transaction.txId,
    actionId: "say_hello",
    providerTxId: txHash,
    explorerUrl: getSolanaExplorerTransactionUrl(txHash),
    walletAddress: walletPrincipal.walletAddress,
    username: "Sam",
    message: "Sam says Hello Celeris!",
    status: "success",
    submittedAt: transaction.createdAt,
    confirmedAt: transaction.confirmedAt
  });
});

test("say_hello payload validation rejects blank, oversized, and caller-supplied wallet/message fields", async () => {
  const { services, api, appId, walletPrincipal, session } = await createSayHelloHarness();

  const cases = [
    {
      idempotencyKey: "say-hello-invalid-1",
      payload: { username: "   " },
      error: "username must not be empty"
    },
    {
      idempotencyKey: "say-hello-invalid-2",
      payload: { username: "x".repeat(33) },
      error: "username must be at most 32 UTF-8 bytes"
    },
    {
      idempotencyKey: "say-hello-invalid-3",
      payload: { username: "Sam", walletAddress: walletPrincipal.walletAddress },
      error: "caller-supplied wallet identity is not allowed"
    },
    {
      idempotencyKey: "say-hello-invalid-4",
      payload: { username: "Sam", message: "custom text" },
      error: "caller-supplied message text is not allowed"
    }
  ] as const;

  for (const testCase of cases) {
    const response = await api.handle({
      method: "POST",
      url: `/v1/apps/${appId}/actions/say_hello/execute`,
      headers: {
        "idempotency-key": testCase.idempotencyKey,
        authorization: `Bearer ${session.accessToken}`
      },
      body: {
        payload: testCase.payload
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, testCase.error);
  }

  assert.equal(services.store.transactions.size, 0);
  assert.equal(services.store.pendingActions.size, 0);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("duplicate say_hello execution requests remain idempotent", async () => {
  const { services, api, appId, session } = await createSayHelloHarness();

  const first = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-dup-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      payload: { username: "Ada" }
    }
  });
  const second = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-dup-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      payload: { username: "Ada" }
    }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.transactionId, second.body.transactionId);
  assert.equal(services.store.transactions.size, 1);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "reserve").length, 1);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 1);
});

test("player transaction feed is app-wide and sorts newest first", async () => {
  const txHashes = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const { services, api, appId, session } = await createSayHelloHarness({
    relayerNetworkClient: new MockRelayerNetwork({
      sendTransaction: async () => ({ txHash: txHashes.shift()! }),
      confirmTransaction: async () => "success"
    })
  });

  await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-feed-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: { payload: { username: "Ada" } }
  });

  const secondWallet = {
    walletAddress: Keypair.generate().publicKey.toBase58(),
    chainId: "solana:103"
  } satisfies WalletPrincipal;
  const secondSession = await fundPlayer({
    api,
    services,
    appId,
    walletPrincipal: secondWallet,
    eventId: "evt-say-hello-2"
  });
  await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-feed-2",
      authorization: `Bearer ${secondSession.accessToken}`
    },
    body: { payload: { username: "Bert" } }
  });

  const feed = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/transactions`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.length, 2);
  assert.equal(feed.body[0].username, "Bert");
  assert.equal(feed.body[0].walletAddress, secondSession.walletPrincipal.walletAddress);
  assert.equal(feed.body[1].username, "Ada");
});

test("failed say_hello relay releases reserved credits", async () => {
  const { services, api, appId, walletPrincipal, session } = await createSayHelloHarness({
    relayerNetworkClient: new MockRelayerNetwork({
      sendTransaction: async () => ({ txHash: Keypair.generate().publicKey.toBase58() }),
      confirmTransaction: async () => "failed"
    })
  });

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-fail-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      payload: { username: "Nora" }
    }
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "transaction failed after submission");
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
