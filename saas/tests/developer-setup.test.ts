import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

test("POST /apps returns minimal setup data and stores webhook url", async () => {
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
      webhookUrl: "http://localhost:3001"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(Object.keys(response.body).sort(), ["apiKey", "appId"]);
  assert.match(response.body.appId as string, /^[0-9a-f-]{36}$/);
  assert.match(response.body.apiKey as string, /^app_/);

  const storedApp = services.store.apps.get(response.body.appId as string)!;
  assert.equal(storedApp.developerWebhookUrl, "http://localhost:3001");
  assert.equal(
    [...services.store.creditPackages.values()].filter((pkg) => pkg.appId === storedApp.appId).length,
    1
  );
});

test("POST /apps/:appId/actions stores mint_item cost for later execution", async () => {
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
      credits: 500
    }
  });

  const response = await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-1" },
    body: {
      actionType: "mint_item",
      cost: 50
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.actionType, "mint_item");
  assert.equal(response.body.cost, 50);
  assert.equal(services.store.getActionType(app.body.appId as string, "mint_item")?.cost, 50);
});

test("GET /apps/:appId/setup exposes webhook url, package, and action setup needed for manual testing", async () => {
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
      webhookUrl: "http://localhost:3001"
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-2" },
    body: {
      actionType: "mint_item",
      cost: 50
    }
  });

  const setup = await api.handle({
    method: "GET",
    url: `/apps/${app.body.appId as string}/setup`
  });

  assert.equal(setup.statusCode, 200);
  assert.equal(setup.body.appId, app.body.appId);
  assert.match(setup.body.apiKey as string, /^app_/);
  assert.equal(setup.body.webhookUrl, "http://localhost:3001");
  assert.equal(setup.body.creditPackages.length, 1);
  assert.equal(setup.body.creditPackages[0].credits, 500);
  assert.equal(setup.body.actions.length, 1);
  assert.equal(setup.body.actions[0].actionType, "mint_item");
  assert.equal(setup.body.actions[0].cost, 50);
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
      credits: 500
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dev-setup-action-3" },
    body: {
      actionType: "mint_item",
      cost: 50
    }
  });

  const updated = await api.handle({
    method: "PUT",
    url: `/apps/${app.body.appId as string}/actions/mint_item`,
    headers: { "idempotency-key": "dev-setup-action-4" },
    body: {
      actionType: "claim_rewards",
      cost: 75
    }
  });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.actionType, "claim_rewards");
  assert.equal(updated.body.cost, 75);
  assert.equal(services.store.getActionType(app.body.appId as string, "mint_item"), null);
  assert.equal(services.store.getActionType(app.body.appId as string, "claim_rewards")?.cost, 75);

  const deleted = await api.handle({
    method: "DELETE",
    url: `/apps/${app.body.appId as string}/actions/claim_rewards`,
    headers: { "idempotency-key": "dev-setup-action-5" }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(services.store.getActionType(app.body.appId as string, "claim_rewards"), null);
});

test("PUT and DELETE /apps/:appId update and remove app setup", async () => {
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
      webhookUrl: "http://localhost:3001"
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
      webhookUrl: "http://localhost:3002"
    }
  });

  assert.equal(updated.statusCode, 200);
  const setup = await api.handle({
    method: "GET",
    url: `/apps/${app.body.appId as string}/setup`
  });
  assert.equal(setup.body.webhookUrl, "http://localhost:3002");
  assert.equal(setup.body.creditPackages[0].credits, 750);
  assert.equal(services.store.apps.get(app.body.appId as string)?.name, "App Updated");

  const deleted = await api.handle({
    method: "DELETE",
    url: `/apps/${app.body.appId as string}`,
    headers: { "idempotency-key": "dev-setup-app-7" }
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(services.store.apps.has(app.body.appId as string), false);
});
