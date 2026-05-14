import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { SuiBuildClient, SuiGateway, SuiGasCoin, TransactionStatus, VerifiedSuiDigest, WalletPrincipal } from "../types.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import {
  createDeveloperApp,
  configureDeveloperAction,
  provisionSponsorWallet,
  registerProgram,
  signUpDeveloper
} from "./helpers/developer.js";
import { buildHelloCelerisSayHelloTransaction } from "../sui/hello-celeris.js";
import { normalizeSuiObjectId } from "@mysten/sui/utils";

const PACKAGE_ID = "0x2";
const APP_STATE_OBJECT_ID = "0x123";
const APP_AUTHORITY_CAP_OBJECT_ID = "0x456";
const VALID_DIGEST_1 = "11111111111111111111111111111111";
const VALID_DIGEST_2 = "21111111111111111111111111111111";

class TestSuiGateway implements SuiGateway {
  readonly buildClient: SuiBuildClient;
  readonly sponsorCoins: Map<string, SuiGasCoin[]>;
  readonly digests = new Map<string, VerifiedSuiDigest & { sender: string; sponsorAddress: string }>();

  constructor() {
    this.sponsorCoins = new Map();
    this.buildClient = {
      core: {
        getMoveFunction: async () => ({
          function: {
            parameters: [
              { body: {}, reference: "mutable" },
              { body: {}, reference: "mutable" },
              { body: {}, reference: "immutable" },
              { body: {} }
            ]
          }
        }),
        getObjects: async ({ objectIds }) => ({
          objects: objectIds.map((objectId) => {
            if (objectId === APP_AUTHORITY_CAP_OBJECT_ID.padStart(66, "0").replace(/^0+/, "0x")) {
              return {
                objectId,
                digest: `digest-${objectId.slice(-4)}`,
                version: "1",
                owner: { $kind: "AddressOwner", AddressOwner: "0xowner" }
              };
            }

            return {
              objectId,
              digest: `digest-${objectId.slice(-4)}`,
              version: "1",
              owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } }
            };
          })
        })
      }
    };
  }

  getBuildClient() {
    return this.buildClient;
  }

  async getCurrentEpoch() {
    return "100";
  }

  async getReferenceGasPrice() {
    return "1000";
  }

  async getChainIdentifier() {
    return "sui:testnet";
  }

  async listSponsorGasCoins(owner: string) {
    return this.sponsorCoins.get(owner) ?? [];
  }

  async getObjectReference(objectId: string) {
    return {
      objectId,
      digest: VALID_DIGEST_1,
      version: "1",
      initialSharedVersion: objectId === normalizeSuiObjectId(APP_AUTHORITY_CAP_OBJECT_ID) ? null : "1"
    };
  }

  async verifySubmittedDigest(input: {
    digest: string;
    expectedSender: string;
    expectedSponsorAddress: string;
  }) {
    const registered = this.digests.get(input.digest);
    if (!registered) {
      throw new Error("unknown digest");
    }
    if (registered.sender !== input.expectedSender) {
      throw new Error("sender mismatch");
    }
    if (registered.sponsorAddress !== input.expectedSponsorAddress) {
      throw new Error("sponsor mismatch");
    }
    return registered;
  }

  seedSponsorCoins(owner: string, coins: SuiGasCoin[]) {
    this.sponsorCoins.set(owner, coins);
  }

  registerDigest({
    digest,
    sender,
    sponsorAddress,
    status = "success"
  }: {
    digest: string;
    sender: string;
    sponsorAddress: string;
    status?: TransactionStatus;
  }) {
    this.digests.set(digest, {
      digest,
      sender,
      sponsorAddress,
      status,
      explorerUrl: `https://suiexplorer.com/txblock/${digest}?network=testnet`,
      confirmedAt: new Date().toISOString()
    });
  }
}

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

async function createSayHelloHarness() {
  const suiGateway = new TestSuiGateway();
  const services = buildServices({ suiGateway });
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });
  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Hello Celeris App",
    priceCents: 499,
    credits: 100,
    allowedChainId: "sui:testnet"
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
  suiGateway.seedSponsorCoins(sponsorWallet.address, [
    { objectId: "0x701", version: "1", digest: VALID_DIGEST_1 },
    { objectId: "0x702", version: "1", digest: VALID_DIGEST_2 }
  ]);
  const registeredProgram = await registerProgram({
    api,
    accessToken: developer.accessToken,
    appId,
    packageId: PACKAGE_ID,
    appStateObjectId: APP_STATE_OBJECT_ID,
    authorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID
  });

  const walletPrincipal = {
    walletAddress: Ed25519Keypair.generate().toSuiAddress(),
    chainId: "sui:testnet"
  } satisfies WalletPrincipal;
  const session = await fundPlayer({
    api,
    services,
    appId,
    walletPrincipal,
    eventId: "evt-say-hello-1"
  });

  return {
    suiGateway,
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

function buildDigest(transactionBytes: string) {
  return `digest-${createHash("sha256").update(transactionBytes).digest("hex").slice(0, 16)}`;
}

test("say_hello prepares a sponsor-signed transaction, completes successfully, and appears in the app-wide player feed", async () => {
  const { suiGateway, services, api, appId, walletPrincipal, session, sponsorWallet, registeredProgram } =
    await createSayHelloHarness();
  const transactionKind = buildHelloCelerisSayHelloTransaction({
    packageId: registeredProgram.packageId,
    appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
    appStateObjectId: registeredProgram.appStateObjectId,
    username: "  Sam  "
  }).transactionKind;

  const prepared = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-exec-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      username: "  Sam  ",
      transactionKind
    }
  });
  const digest = buildDigest(prepared.body.transactionBytes as string);
  suiGateway.registerDigest({
    digest,
    sender: walletPrincipal.walletAddress,
    sponsorAddress: sponsorWallet.address,
    status: "success"
  });

  const completed = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/complete`,
    headers: {
      "idempotency-key": "say-hello-complete-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      reservationId: prepared.body.reservationId,
      outcome: "submitted",
      digest
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

  assert.equal(prepared.statusCode, 200);
  assert.equal(prepared.body.username, "Sam");
  assert.equal(prepared.body.message, "Sam says Hello Celeris!");
  assert.equal(prepared.body.sponsorAddress, sponsorWallet.address);
  assert.match(prepared.body.transactionBytes as string, /^[A-Za-z0-9+/=]+$/);
  assert.match(prepared.body.sponsorSignature as string, /^[A-Za-z0-9+/=]+$/);

  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.digest, digest);
  assert.equal(completed.body.status, "success");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 75);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);

  const transaction = [...services.store.transactions.values()][0];
  assert.equal(transaction.summary.actionType, "say_hello");
  if (transaction.summary.actionType !== "say_hello") {
    throw new Error("expected say_hello summary");
  }
  assert.equal(transaction.summary.username, "Sam");
  assert.equal(transaction.summary.message, "Sam says Hello Celeris!");
  assert.equal(transaction.summary.sponsorAddress, sponsorWallet.address);
  assert.equal(transaction.summary.playerWalletAddress, walletPrincipal.walletAddress);
  assert.equal(transaction.summary.digest, digest);
  assert.equal(transaction.summary.status, "success");

  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.registeredProgram.packageId, registeredProgram.packageId);
  assert.equal(catalog.body.actions.some((action: { actionType: string }) => action.actionType === "say_hello"), true);

  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.length, 1);
  assert.deepEqual(feed.body[0], {
    transactionId: transaction.txId,
    actionId: "say_hello",
    digest,
    providerTxId: digest,
    explorerUrl: `https://suiexplorer.com/txblock/${digest}?network=testnet`,
    walletAddress: walletPrincipal.walletAddress,
    username: "Sam",
    message: "Sam says Hello Celeris!",
    status: "success",
    submittedAt: transaction.createdAt,
    confirmedAt: transaction.confirmedAt
  });
});

test("say_hello payload validation rejects blank, oversized, and caller-supplied wallet/message fields", async () => {
  const { services, api, appId, walletPrincipal, session, registeredProgram } = await createSayHelloHarness();
  const transactionKind = buildHelloCelerisSayHelloTransaction({
    packageId: registeredProgram.packageId,
    appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
    appStateObjectId: registeredProgram.appStateObjectId,
    username: "Sam"
  }).transactionKind;

  const cases = [
    {
      idempotencyKey: "say-hello-invalid-1",
      body: { username: "   ", transactionKind },
      error: "username must not be empty"
    },
    {
      idempotencyKey: "say-hello-invalid-2",
      body: { username: "x".repeat(33), transactionKind },
      error: "username must be at most 32 UTF-8 bytes"
    },
    {
      idempotencyKey: "say-hello-invalid-3",
      body: { username: "Sam", playerWallet: walletPrincipal.walletAddress, transactionKind },
      error: "caller-supplied wallet identity is not allowed"
    },
    {
      idempotencyKey: "say-hello-invalid-4",
      body: { username: "Sam", message: "custom text", transactionKind },
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
      body: testCase.body as Record<string, unknown>
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, testCase.error);
  }

  assert.equal(services.store.transactions.size, 0);
  assert.equal(services.store.pendingActions.size, 0);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("mismatched TransactionKind is rejected before sponsorship preparation", async () => {
  const { services, api, appId, walletPrincipal, session, registeredProgram } = await createSayHelloHarness();
  const transactionKind = buildHelloCelerisSayHelloTransaction({
    packageId: registeredProgram.packageId,
    appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
    appStateObjectId: registeredProgram.appStateObjectId,
    username: "Eve"
  }).transactionKind;

  const response = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-txkind-mismatch-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      username: "Sam",
      transactionKind
    }
  });

  assert.equal(response.statusCode, 422);
  assert.match(response.body.error, /canonical Hello Celeris say_hello shape|does not exactly match/);
  assert.equal(services.store.pendingActions.size, 0);
  assert.equal(services.store.sponsorGasReservations.size, 0);
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("duplicate say_hello preparation requests remain idempotent at the reservation layer", async () => {
  const { services, api, appId, session, registeredProgram } = await createSayHelloHarness();
  const transactionKind = buildHelloCelerisSayHelloTransaction({
    packageId: registeredProgram.packageId,
    appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
    appStateObjectId: registeredProgram.appStateObjectId,
    username: "Ada"
  }).transactionKind;

  const first = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-dup-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      username: "Ada",
      transactionKind
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
      username: "Ada",
      transactionKind
    }
  });

  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(services.store.pendingActions.size, 1);
  assert.equal(services.store.sponsorGasReservations.size, 1);
});

test("failed completion releases credits and the sponsor gas reservation", async () => {
  const { services, api, appId, walletPrincipal, session, registeredProgram } = await createSayHelloHarness();
  const transactionKind = buildHelloCelerisSayHelloTransaction({
    packageId: registeredProgram.packageId,
    appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
    appStateObjectId: registeredProgram.appStateObjectId,
    username: "Ada"
  }).transactionKind;

  const prepared = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/execute`,
    headers: {
      "idempotency-key": "say-hello-failed-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      username: "Ada",
      transactionKind
    }
  });
  const completed = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/say_hello/complete`,
    headers: {
      "idempotency-key": "say-hello-failed-complete-1",
      authorization: `Bearer ${session.accessToken}`
    },
    body: {
      reservationId: prepared.body.reservationId,
      outcome: "failed"
    }
  });

  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.status, "failed");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 100);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
  const reservation = services.store.getSponsorGasReservation(prepared.body.reservationId as string);
  assert.equal(reservation?.status, "released");
});
