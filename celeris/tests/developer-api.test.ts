import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createServerClient } from "../sdk/server-client.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, configureDeveloperAction, signUpDeveloper } from "./helpers/developer.js";
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";

function createFetchBridge(api: ReturnType<typeof createApi>): typeof fetch {
  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const resolvedUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await api.handle({
      method: init?.method ?? "GET",
      url: new URL(resolvedUrl, "http://localhost").pathname,
      headers,
      body
    });
    return new Response(JSON.stringify(response.body), {
      status: response.statusCode,
      headers: response.headers
    });
  };
}

test("developer routes require bearer auth and are namespaced under /v1/developer", async () => {
  const services = buildServices();
  const api = createApi(services);

  const unauthenticated = await api.handle({
    method: "GET",
    url: "/v1/developer/apps"
  });
  const legacy = await api.handle({
    method: "GET",
    url: "/apps"
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.body.error, "authorization token required");
  assert.equal(legacy.statusCode, 404);
});

test("developer sign-up and sign-in return bearer tokens that protect developer-owned app access", async () => {
  const services = buildServices();
  const api = createApi(services);

  const firstDeveloper = await signUpDeveloper({ api, developerId: "dev-auth-1", username: "dev-auth-1" });
  const secondDeveloper = await signUpDeveloper({ api, developerId: "dev-auth-2", username: "dev-auth-2" });
  const secondSignIn = await api.handle({
    method: "POST",
    url: "/v1/developer/sign-in",
    body: {
      username: "dev-auth-2",
      password: "test-password"
    }
  });

  const app = await createDeveloperApp({
    api,
    accessToken: firstDeveloper.accessToken,
    name: "Protected App",
    allowedChainId: "eip155:1"
  });

  const ownerRead = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}`,
    headers: { authorization: `Bearer ${firstDeveloper.accessToken}` }
  });
  const otherDeveloperRead = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}`,
    headers: { authorization: `Bearer ${secondDeveloper.accessToken}` }
  });

  assert.match(firstDeveloper.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.match(secondSignIn.body.accessToken as string, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ownerRead.statusCode, 200);
  assert.equal(ownerRead.body.appId, app.appId);
  assert.equal(otherDeveloperRead.statusCode, 403);
  assert.equal(otherDeveloperRead.body.error, "developer does not have access to this app");
});

test("server SDK composes developer routes and can act on behalf of a player session", async () => {
  const services = buildServices();
  const api = createApi(services);
  const fetchImpl = createFetchBridge(api);
  const authClient = createServerClient({
    apiBaseUrl: "http://localhost",
    fetchImpl
  });

  const developer = await authClient.auth.signUp({
    username: "sdk-dev",
    password: "sdk-pass",
    developerId: services.defaultDeveloper.developerId,
    idempotencyKey: "sdk-dev-sign-up"
  });

  const client = createServerClient({
    apiBaseUrl: "http://localhost",
    accessToken: developer.accessToken,
    fetchImpl
  });

  const app = await client.apps.create({
    name: "SDK App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "sui:testnet",
    idempotencyKey: "sdk-app-create"
  });

  await client.apps.configureAction(app.appId, {
    actionType: "mint_item",
    cost: 50,
    executionMode: "managed",
    idempotencyKey: "sdk-action-create"
  });
  const sponsorWallet = await client.apps.createSponsorWallet(app.appId, {
    idempotencyKey: "sdk-sponsor-wallet"
  });
  const packageId = normalizeSuiObjectId("0x123");
  const appStateObjectId = normalizeSuiObjectId("0x456");
  const authorityCapObjectId = normalizeSuiObjectId("0x789");
  const registeredProgram = await client.apps.registerProgram(app.appId, {
    packageId,
    appStateObjectId,
    authorityCapObjectId,
    idempotencyKey: "sdk-program-register"
  });

  const playerSession = await createHostedPlayerSession({
    api,
    appId: app.appId,
    walletAddress: Ed25519Keypair.generate().toSuiAddress()
  });

  const playerView = client.asUser(playerSession.accessToken);
  const me = await playerView.me.get();
  const catalog = await playerView.catalog.get(app.appId);
  const apps = await client.apps.list();
  const appDetails = await client.apps.get(app.appId);
  const fetchedSponsorWallet = await client.apps.getSponsorWallet(app.appId);
  const fetchedProgram = await client.apps.getProgram(app.appId);
  const players = await client.players.list(app.appId);
  const metrics = await client.metrics.getAppMetrics(app.appId);
  const transactions = await client.transactions.list(app.appId);

  assert.equal(me.walletAddress, playerSession.player.walletAddress);
  assert.equal(me.chainId, "sui:testnet");
  assert.equal(catalog.appId, app.appId);
  assert.equal(apps.length, 1);
  assert.equal(appDetails.appId, app.appId);
  assert.equal(appDetails.sponsorWallet.address, sponsorWallet.address);
  assert.equal(appDetails.sponsorWallet.chainFamily, "sui");
  assert.equal(appDetails.sponsorWallet.network, "testnet");
  assert.equal(appDetails.registeredProgram.packageId, packageId);
  assert.equal(appDetails.registeredProgram.appStateObjectId, appStateObjectId);
  assert.equal(appDetails.registeredProgram.authorityCapObjectId, authorityCapObjectId);
  assert.equal(fetchedSponsorWallet.address, sponsorWallet.address);
  assert.equal(fetchedProgram.packageId, packageId);
  assert.equal(registeredProgram.packageId, packageId);
  assert.equal(registeredProgram.appStateObjectId, appStateObjectId);
  assert.equal(registeredProgram.authorityCapObjectId, authorityCapObjectId);
  assert.equal(normalizeSuiAddress(sponsorWallet.address), sponsorWallet.address);
  assert.equal(players.length, 0);
  assert.equal(metrics.appId, app.appId);
  assert.deepEqual(transactions, []);
});
