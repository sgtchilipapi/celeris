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

  return session;
}

type Harness = {
  services: ReturnType<typeof buildServices>;
  api: ReturnType<typeof createApi>;
  appId: string;
  developerAccessToken: string;
  session: Awaited<ReturnType<typeof createHostedPlayerSession>>;
  walletPrincipal: WalletPrincipal;
  sponsorWallet: { publicKey: string };
  registeredProgram: { programId: string; statePda: string };
};

async function createHarness({
  relayerNetworkClient = new MockRelayerNetwork({
    sendTransaction: async () => ({ txHash: Keypair.generate().publicKey.toBase58() }),
    confirmTransaction: async () => "success"
  }),
  checkoutCredits = 100
}: {
  relayerNetworkClient?: MockRelayerNetwork;
  checkoutCredits?: number;
} = {}): Promise<Harness> {
  const services = buildServices({ relayerNetworkClient });
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Hello Celeris App",
    priceCents: 499,
    credits: checkoutCredits,
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
    credits: checkoutCredits,
    eventId: "evt-e2e-say-hello-1"
  });

  return {
    services,
    api,
    appId,
    developerAccessToken: developer.accessToken,
    session,
    walletPrincipal,
    sponsorWallet,
    registeredProgram
  };
}

test("end-to-end happy path covers sponsor wallet, program registration, checkout, say_hello, and app transaction feed", async () => {
  const txHash = Keypair.generate().publicKey.toBase58();
  const { services, api, appId, developerAccessToken, session, walletPrincipal, sponsorWallet, registeredProgram } =
    await createHarness({
      relayerNetworkClient: new MockRelayerNetwork({
        sendTransaction: async () => ({ txHash }),
        confirmTransaction: async () => "success"
      })
    });

  const execution = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "e2e-say-hello-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      payload: { username: "Sam" }
    }
  });
  const setup = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${appId}`,
    headers: { authorization: `Bearer ${developerAccessToken}` }
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

  assert.equal(execution.statusCode, 200);
  assert.equal(execution.body.username, "Sam");
  assert.equal(execution.body.message, "Sam says Hello Celeris!");
  assert.equal(execution.body.providerTxId, txHash);
  assert.equal(execution.body.explorerUrl, getSolanaExplorerTransactionUrl(txHash));

  assert.equal(setup.statusCode, 200);
  assert.equal(setup.body.sponsorWallet.publicKey, sponsorWallet.publicKey);
  assert.equal(setup.body.registeredProgram.programId, registeredProgram.programId);

  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.actions.some((action: { actionType: string }) => action.actionType === "say_hello"), true);
  assert.equal(catalog.body.registeredProgram.programId, registeredProgram.programId);

  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.length, 1);
  assert.equal(feed.body[0].walletAddress, walletPrincipal.walletAddress);
  assert.equal(feed.body[0].username, "Sam");
  assert.equal(feed.body[0].message, "Sam says Hello Celeris!");
  assert.equal(feed.body[0].providerTxId, txHash);
  assert.equal(feed.body[0].explorerUrl, getSolanaExplorerTransactionUrl(txHash));

  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 75);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("end-to-end duplicate payment webhook only grants credits once", async () => {
  const services = buildServices();
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: Keypair.generate().publicKey.toBase58(),
    chainId: "solana:103"
  } satisfies WalletPrincipal;
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Duplicate Webhook App",
    priceCents: 499,
    credits: 500,
    allowedChainId: walletPrincipal.chainId
  });
  const appId = app.appId as string;
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
    headers: { "idempotency-key": "e2e-dup-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });
  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt-e2e-dup-1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits: 500,
    amountCents: 499
  });

  const first = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });
  const duplicate = await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "e2e-dup-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "grant").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
});

test("end-to-end insufficient credits blocks the next say_hello", async () => {
  const { api, appId, session } = await createHarness({ checkoutCredits: 25 });

  const first = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: { "idempotency-key": "e2e-say-hello-insufficient-1", authorization: `Bearer ${session.accessToken}` },
    body: { payload: { username: "Ada" } }
  });
  const second = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: { "idempotency-key": "e2e-say-hello-insufficient-2", authorization: `Bearer ${session.accessToken}` },
    body: { payload: { username: "Bert" } }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error, "insufficient credits");
});

test("end-to-end failed say_hello relay releases reserved credits and records no success", async () => {
  const { services, api, appId, session, walletPrincipal } = await createHarness({
    relayerNetworkClient: new MockRelayerNetwork({
      sendTransaction: async () => ({ txHash: Keypair.generate().publicKey.toBase58() }),
      confirmTransaction: async () => "failed"
    })
  });

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "e2e-say-hello-failed-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: { payload: { username: "Nora" } }
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "transaction failed after submission");
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "capture").length, 0);
  assert.equal(services.store.creditLedger.filter((entry) => entry.type === "release").length, 1);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
