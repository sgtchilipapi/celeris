import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

test("POST /apps returns minimal setup data and stores Privy auth config", async () => {
  const services = buildServices();
  const api = createApi(services);

  const response = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-setup-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Developer Setup App",
      priceCents: 499,
      credits: 500,
      privyAppId: "privy-app-123",
      allowedChainId: "eip155:1"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(Object.keys(response.body).sort(), ["apiKey", "appId"]);

  const authConfig = services.store.appAuthConfigs.get(response.body.appId as string);
  assert.ok(authConfig);
  assert.equal(authConfig?.authProvider, "privy");
  assert.equal(authConfig?.privyAppId, "privy-app-123");
  assert.equal(authConfig?.allowedChainId, "eip155:1");
});

test("POST /apps/:appId/actions stores action cost and execution mode", async () => {
  const services = buildServices();
  const api = createApi(services);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-setup-app-2" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Action Setup App",
      priceCents: 499,
      credits: 500,
      privyAppId: "privy-app-456",
      allowedChainId: "solana:103"
    }
  });

  const response = await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-1" },
    body: {
      actionType: "mint_item",
      cost: 50,
      executionMode: "managed"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.actionType, "mint_item");
  assert.equal(response.body.cost, 50);
  assert.equal(response.body.executionMode, "managed");
});

test("GET /apps/:appId/setup exposes auth config, package, and action setup", async () => {
  const services = buildServices();
  const api = createApi(services);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-setup-app-3" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Setup Details App",
      priceCents: 499,
      credits: 500,
      privyAppId: "privy-app-789",
      allowedChainId: "solana:101"
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-2" },
    body: {
      actionType: "mint_item",
      cost: 50,
      executionMode: "server"
    }
  });

  const setup = await api.handle({
    method: "GET",
    url: `/apps/${app.body.appId as string}/setup`
  });

  assert.equal(setup.statusCode, 200);
  assert.equal(setup.body.authConfig.authProvider, "privy");
  assert.equal(setup.body.authConfig.privyAppId, "privy-app-789");
  assert.equal(setup.body.authConfig.allowedChainId, "solana:101");
  assert.equal(setup.body.creditPackages[0].credits, 500);
  assert.equal(setup.body.actions[0].executionMode, "server");
});

test("PUT and DELETE /apps/:appId/actions/:actionType update and remove configured actions", async () => {
  const services = buildServices();
  const api = createApi(services);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-setup-app-4" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Editable Actions App",
      priceCents: 499,
      credits: 500,
      privyAppId: "privy-app-edit",
      allowedChainId: "eip155:11155111"
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-3" },
    body: {
      actionType: "mint_item",
      cost: 50,
      executionMode: "managed"
    }
  });

  const updated = await api.handle({
    method: "PUT",
    url: `/apps/${app.body.appId as string}/actions/mint_item`,
    headers: { "idempotency-key": "dev-setup-action-4" },
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
    url: `/apps/${app.body.appId as string}/actions/claim_rewards`,
    headers: { "idempotency-key": "dev-setup-action-5" }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
});

test("PUT and DELETE /apps/:appId update auth config and remove app setup", async () => {
  const services = buildServices();
  const api = createApi(services);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dev-setup-app-5" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "App To Edit",
      priceCents: 100,
      credits: 500,
      privyAppId: "privy-initial",
      allowedChainId: "eip155:1"
    }
  });

  const updated = await api.handle({
    method: "PUT",
    url: `/apps/${app.body.appId as string}`,
    headers: { "idempotency-key": "dev-setup-app-6" },
    body: {
      name: "App Updated",
      priceCents: 100,
      credits: 750,
      privyAppId: "privy-updated",
      allowedChainId: "solana:103"
    }
  });

  assert.equal(updated.statusCode, 200);

  const setup = await api.handle({
    method: "GET",
    url: `/apps/${app.body.appId as string}/setup`
  });

  assert.equal(setup.body.authConfig.privyAppId, "privy-updated");
  assert.equal(setup.body.authConfig.allowedChainId, "solana:103");
  assert.equal(setup.body.creditPackages[0].credits, 750);

  const deleted = await api.handle({
    method: "DELETE",
    url: `/apps/${app.body.appId as string}`,
    headers: { "idempotency-key": "dev-setup-app-7" }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(services.store.apps.has(app.body.appId as string), false);
  assert.equal(services.store.appAuthConfigs.has(app.body.appId as string), false);
});
