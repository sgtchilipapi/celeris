import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { deriveHelloCelerisStatePda } from "../solana/hello-celeris.js";
import { createDeveloperApp, configureDeveloperAction, signUpDeveloper } from "./helpers/developer.js";

test("POST /v1/developer/apps returns minimal setup data and stores player policy", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const response = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Developer Setup App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "eip155:1"
  });

  assert.deepEqual(Object.keys(response).sort(), ["apiKey", "appId"]);

  const playerPolicy = services.store.appPlayerPolicies.get(response.appId as string);
  assert.ok(playerPolicy);
  assert.equal(playerPolicy?.authProvider, "privy");
  assert.equal(playerPolicy?.allowedChainId, "eip155:1");
});

test("POST /v1/developer/apps/:appId/actions stores action cost and execution mode", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Action Setup App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "solana:103"
  });

  const response = await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    executionMode: "managed"
  });

  assert.equal(response.actionType, "mint_item");
  assert.equal(response.cost, 50);
  assert.equal(response.executionMode, "managed");
});

test("GET /v1/developer/apps/:appId exposes player policy, package, and action setup", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Setup Details App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "solana:101"
  });

  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    executionMode: "server"
  });

  const setup = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}`,
    headers: { authorization: `Bearer ${developer.accessToken}` }
  });

  assert.equal(setup.statusCode, 200);
  assert.equal(setup.body.playerPolicy.authProvider, "privy");
  assert.equal(setup.body.playerPolicy.allowedChainId, "solana:101");
  assert.equal(setup.body.creditPackages[0].credits, 500);
  assert.equal(setup.body.actions[0].executionMode, "server");
  assert.equal(setup.body.registeredProgram, null);
  assert.equal(setup.body.sponsorWallet, null);
});

test("developer can provision a sponsor wallet once and read its public summary without secret material", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Sponsor Wallet App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "solana:103"
  });

  const first = await api.handle({
    method: "POST",
    url: `/v1/developer/apps/${app.appId}/sponsor-wallet`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "sponsor-wallet-1"
    }
  });
  const second = await api.handle({
    method: "POST",
    url: `/v1/developer/apps/${app.appId}/sponsor-wallet`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "sponsor-wallet-2"
    }
  });
  const read = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}/sponsor-wallet`,
    headers: { authorization: `Bearer ${developer.accessToken}` }
  });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.publicKey, second.body.publicKey);
  assert.equal(read.body.publicKey, first.body.publicKey);
  assert.equal(first.body.chainFamily, "solana");
  assert.equal(first.body.cluster, "devnet");
  assert.equal("secretKey" in first.body, false);
  assert.deepEqual(Object.keys(first.body).sort(), ["appId", "chainFamily", "cluster", "createdAt", "publicKey", "updatedAt"]);

  const storedSecret = services.store.getSponsorWalletSecret(app.appId as string);
  assert.ok(storedSecret);
  assert.equal(Array.isArray(storedSecret?.secretKey), true);
  assert.equal(storedSecret?.secretKey.length, 64);
});

test("developer can register a Solana devnet program and app setup includes both SDH-02 resources", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Hello Program App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "solana:103"
  });

  const sponsorWallet = await api.handle({
    method: "POST",
    url: `/v1/developer/apps/${app.appId}/sponsor-wallet`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "setup-sponsor-wallet"
    }
  });

  const programId = Keypair.generate().publicKey.toBase58();
  const registration = await api.handle({
    method: "PUT",
    url: `/v1/developer/apps/${app.appId}/program`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "program-register-1"
    },
    body: {
      programId
    }
  });
  const read = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}/program`,
    headers: { authorization: `Bearer ${developer.accessToken}` }
  });
  const setup = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}`,
    headers: { authorization: `Bearer ${developer.accessToken}` }
  });

  assert.equal(registration.statusCode, 200);
  assert.equal(registration.body.programId, programId);
  assert.equal(registration.body.chainFamily, "solana");
  assert.equal(registration.body.cluster, "devnet");
  assert.equal(
    registration.body.statePda,
    deriveHelloCelerisStatePda({ appId: app.appId as string, programId }).statePda.toBase58()
  );
  assert.deepEqual(read.body, registration.body);
  assert.equal(setup.body.registeredProgram.programId, programId);
  assert.equal(setup.body.sponsorWallet.publicKey, sponsorWallet.body.publicKey);
});

test("invalid Solana program IDs are rejected", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Invalid Program App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "solana:103"
  });

  const response = await api.handle({
    method: "PUT",
    url: `/v1/developer/apps/${app.appId}/program`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "program-register-invalid"
    },
    body: {
      programId: "not-a-solana-address"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid Solana program ID");
});

test("PUT and DELETE /v1/developer/apps/:appId/actions/:actionType update and remove configured actions", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Editable Actions App",
    priceCents: 499,
    credits: 500,
    allowedChainId: "eip155:11155111"
  });

  await configureDeveloperAction({
    api,
    accessToken: developer.accessToken,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    executionMode: "managed"
  });

  const updated = await api.handle({
    method: "PUT",
    url: `/v1/developer/apps/${app.appId}/actions/mint_item`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "dev-setup-action-4"
    },
    body: {
      actionType: "claim_rewards",
      cost: 75,
      executionMode: "webhook"
    }
  });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.actionType, "claim_rewards");
  assert.equal(updated.body.executionMode, "webhook");

  const deleted = await api.handle({
    method: "DELETE",
    url: `/v1/developer/apps/${app.appId}/actions/claim_rewards`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "dev-setup-action-5"
    }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
});

test("PUT and DELETE /v1/developer/apps/:appId update player policy and remove app setup", async () => {
  const services = buildServices();
  const api = createApi(services);
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "App To Edit",
    priceCents: 100,
    credits: 500,
    allowedChainId: "eip155:1"
  });

  const updated = await api.handle({
    method: "PUT",
    url: `/v1/developer/apps/${app.appId}`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "dev-setup-app-6"
    },
    body: {
      name: "App Updated",
      priceCents: 100,
      credits: 750,
      allowedChainId: "solana:103"
    }
  });

  assert.equal(updated.statusCode, 200);

  const setup = await api.handle({
    method: "GET",
    url: `/v1/developer/apps/${app.appId}`,
    headers: { authorization: `Bearer ${developer.accessToken}` }
  });

  assert.equal(setup.body.playerPolicy.allowedChainId, "solana:103");
  assert.equal(setup.body.creditPackages[0].credits, 750);

  const deleted = await api.handle({
    method: "DELETE",
    url: `/v1/developer/apps/${app.appId}`,
    headers: {
      authorization: `Bearer ${developer.accessToken}`,
      "idempotency-key": "dev-setup-app-7"
    }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(services.store.apps.has(app.appId as string), false);
  assert.equal(services.store.appPlayerPolicies.has(app.appId as string), false);
});
