import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
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
