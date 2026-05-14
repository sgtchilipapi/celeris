import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createBrowserClient } from "../sdk/browser-client.js";
import { buildRunConfig } from "../../scripts/mock-game-frontend.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, configureDeveloperAction, signUpDeveloper } from "./helpers/developer.js";
import { buildCanonicalHelloCelerisSayHelloTransaction } from "../sui/hello-celeris.js";

function createMemoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

function createZkLoginSessionFixture() {
  const keypair = Ed25519Keypair.generate();

  return {
    session: {
      accessToken: "player-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      player: {
        walletAddress: "0x123",
        chainId: "sui:testnet"
      },
      projectId: "app_123",
      celerisUserId: "celeris-user-1",
      projectUserId: "project-user-1"
    },
    zkLoginSession: {
      ephemeralPrivateKey: keypair.getSecretKey(),
      ephemeralPublicKey: keypair.getPublicKey().toBase64(),
      maxEpoch: 30,
      createdAt: new Date().toISOString(),
      nonce: "nonce-123",
      userSalt: "salt-123",
      issuer: "https://accounts.google.com",
      audience: "google-client-dev",
      subject: "google-user-1",
      addressSeed: "123456789",
      proof: {
        proofDigest: "proof-digest-123",
        proverOrigin: "http://localhost:3001",
        proofPoints: {
          a: ["1", "2"],
          b: [["3", "4"], ["5", "6"]],
          c: ["7", "8"]
        },
        issBase64Details: {
          value: Buffer.from("https://accounts.google.com", "utf8").toString("base64"),
          indexMod4: 0
        },
        headerBase64: Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64")
      }
    }
  };
}

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
  await client.transactions.list();

  assert.deepEqual(
    requests.map((entry) => entry.url),
    [
      "/api/v1/me",
      "/api/v1/apps/app_123/catalog",
      "/api/v1/apps/app_123/me/credits",
      "/api/v1/apps/app_123/checkout-sessions",
      "/api/v1/apps/app_123/actions/mint_item/execute",
      "/api/v1/apps/app_123/me/asset-history",
      "/api/v1/apps/app_123/transactions"
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

test("browser SDK executes sponsored say_hello through prepare, silent zkLogin signing, submit, and completion", async () => {
  const fixture = createZkLoginSessionFixture();
  const localStorage = createMemoryStorage({
    "celeris-player-session:app_123": JSON.stringify(fixture.session)
  });
  const sessionStorage = createMemoryStorage({
    "celeris-player-session:app_123:zklogin-session": JSON.stringify(fixture.zkLoginSession)
  });
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const submitted: Array<{ transactionBlock: string; signature: string | string[]; options?: Record<string, unknown> }> = [];
  const registeredProgram = {
    packageId: "0x2",
    appStateObjectId: "0x123",
    authorityCapObjectId: "0x456"
  };
  const expectedBuilt = buildCanonicalHelloCelerisSayHelloTransaction({
    registeredProgram,
    playerWalletAddress: fixture.session.player.walletAddress,
    username: "  Sam  "
  });
  const preparedTransactionBytes = Buffer.from("hello-celeris-say-hello", "utf8").toString("base64");

  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: "app_123",
    auth: {
      storage: localStorage,
      sessionStorage
    },
    sui: {
      rpcClient: {
        async executeTransactionBlock(input) {
          submitted.push(input);
          return { digest: "digest-say-hello-1" };
        }
      }
    },
    fetchImpl: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      requests.push({ url: path, body });

      if (path === "/api/v1/apps/app_123/catalog") {
        return new Response(
          JSON.stringify({
            registeredProgram
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (path === "/api/v1/apps/app_123/actions/say_hello/execute") {
        return new Response(
          JSON.stringify({
            reservationId: "reservation-1",
            transactionBytes: preparedTransactionBytes,
            sponsorSignature: "sponsor-signature-1",
            sponsorAddress: "0xsponsor",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            username: "Sam",
            message: "Sam says Hello Celeris!"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (path === "/api/v1/apps/app_123/actions/say_hello/complete") {
        return new Response(
          JSON.stringify({
            reservationId: "reservation-1",
            transactionId: "tx-1",
            digest: body?.digest ?? "digest-say-hello-1",
            explorerUrl: "https://suiexplorer.com/txblock/digest-say-hello-1?network=testnet",
            status: "submitted"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`unexpected browser SDK request: ${path}`);
    }
  });

  const result = await client.actions.execute("say_hello", { username: "  Sam  " }, { idempotencyKey: "say-hello-1" });

  assert.equal(requests.map((entry) => entry.url).join("|"), [
    "/api/v1/apps/app_123/catalog",
    "/api/v1/apps/app_123/actions/say_hello/execute",
    "/api/v1/apps/app_123/actions/say_hello/complete"
  ].join("|"));
  assert.deepEqual(requests[1].body, {
    payload: {
      username: "Sam",
      transactionKind: expectedBuilt.transactionKind
    },
    idempotencyKey: "say-hello-1"
  });
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].transactionBlock, preparedTransactionBytes);
  assert.equal(Array.isArray(submitted[0].signature), true);
  assert.equal((submitted[0].signature as string[]).length, 2);
  assert.equal((submitted[0].signature as string[])[1], "sponsor-signature-1");
  assert.deepEqual(requests[2].body, {
    reservationId: "reservation-1",
    outcome: "submitted",
    digest: "digest-say-hello-1",
    idempotencyKey: "say-hello-1:complete"
  });
  assert.equal(result.digest, "digest-say-hello-1");
  assert.equal(result.completion.status, "submitted");
});

test("browser SDK fails closed when zkLogin session material is missing during say_hello execution", async () => {
  const fixture = createZkLoginSessionFixture();
  const localStorage = createMemoryStorage({
    "celeris-player-session:app_123": JSON.stringify(fixture.session)
  });
  const sessionStorage = createMemoryStorage();
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let rpcCalled = false;

  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: "app_123",
    auth: {
      storage: localStorage,
      sessionStorage
    },
    sui: {
      rpcClient: {
        async executeTransactionBlock() {
          rpcCalled = true;
          return { digest: "unexpected" };
        }
      }
    },
    fetchImpl: async (url, init) => {
      const path = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      requests.push({ url: path, body });

      if (path === "/api/v1/apps/app_123/catalog") {
        return new Response(
          JSON.stringify({
            registeredProgram: {
              packageId: "0x2",
              appStateObjectId: "0x123",
              authorityCapObjectId: "0x456"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (path === "/api/v1/apps/app_123/actions/say_hello/execute") {
        return new Response(
          JSON.stringify({
            reservationId: "reservation-2",
            transactionBytes: Buffer.from("hello-celeris-say-hello", "utf8").toString("base64"),
            sponsorSignature: "sponsor-signature-2",
            sponsorAddress: "0xsponsor",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            username: "Sam",
            message: "Sam says Hello Celeris!"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (path === "/api/v1/apps/app_123/actions/say_hello/complete") {
        return new Response(
          JSON.stringify({
            reservationId: "reservation-2",
            transactionId: null,
            digest: null,
            explorerUrl: null,
            status: "failed"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`unexpected browser SDK request: ${path}`);
    }
  });

  await assert.rejects(
    () => client.actions.execute("say_hello", { username: "Sam" }, { idempotencyKey: "say-hello-missing-zk" }),
    /zkLogin session material is missing or expired/
  );

  assert.equal(rpcCalled, false);
  assert.equal(requests.map((entry) => entry.url).join("|"), [
    "/api/v1/apps/app_123/catalog",
    "/api/v1/apps/app_123/actions/say_hello/execute",
    "/api/v1/apps/app_123/actions/say_hello/complete"
  ].join("|"));
  assert.deepEqual(requests[2].body, {
    reservationId: "reservation-2",
    outcome: "failed",
    idempotencyKey: "say-hello-missing-zk:complete"
  });
});

test("standalone frontend config only exposes public runtime values", () => {
  const config = buildRunConfig({
    appId: "app_123",
    appName: "Hello Celeris",
    apiOrigin: "/api",
    hostedAuthOrigin: "http://localhost:3000",
    suiRpcOrigin: "https://fullnode.testnet.sui.io:443",
    redirectUri: "http://localhost:3002/auth/callback"
  });

  assert.deepEqual(config, {
    appId: "app_123",
    appName: "Hello Celeris",
    apiOrigin: "/api",
    hostedAuthOrigin: "http://localhost:3000",
    suiRpcOrigin: "https://fullnode.testnet.sui.io:443",
    redirectUri: "http://localhost:3002/auth/callback"
  });
});

test("player catalog, credit balance, and transaction feed routes support the standalone browser SDK flow", async () => {
  const services = buildServices();
  const api = createApi(services);
  const walletAddress = "0xdemo123";
  const chainId = "sui:testnet";
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
    walletAddress,
    chainId
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
    walletAddress: session.player.walletAddress,
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

  const catalog = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/catalog`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  const balance = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/me/credits`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  const transactions = await api.handle({
    method: "GET",
    url: `/v1/apps/${appId}/transactions`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.name, "Browser SDK App");
  assert.equal(catalog.body.playerPolicy.allowedChainId, chainId);
  assert.equal(catalog.body.creditPackages[0].packageId, packageId);
  assert.equal(catalog.body.actions[0].actionType, "mint_item");

  assert.equal(balance.statusCode, 200);
  assert.equal(balance.body.walletAddress, session.player.walletAddress);
  assert.equal(balance.body.chainId, chainId);
  assert.equal(balance.body.balance, 500);

  assert.equal(transactions.statusCode, 200);
  assert.deepEqual(transactions.body, []);
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
