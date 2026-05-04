import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

test("dashboard page removes webhook and sponsor-wallet copy", async () => {
  const services = buildServices();
  const api = createApi(services);

  const dashboardPage = await api.handle({
    method: "GET",
    url: "/"
  });

  assert.equal(dashboardPage.statusCode, 200);
  const html = String(dashboardPage.body);
  assert.match(html, /Celeris Dashboard/);
  assert.doesNotMatch(html, /Webhook URL/);
  assert.doesNotMatch(html, /Sponsor wallet/i);
  assert.doesNotMatch(html, /Auth provider/);
  assert.match(html, /Browser auth policy/);
  assert.match(html, /Allowed frontend origins/);
  assert.match(html, /Redirect URIs/);
  assert.match(html, /Execution mode/);
});

test("dashboard endpoints create apps with player policy and execution-mode actions", async () => {
  const services = buildServices();
  const api = createApi(services);

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dashboard-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Dashboard App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:11155111"
    }
  });

  await api.handle({
    method: "POST",
    url: `/apps/${app.body.appId as string}/actions`,
    headers: { "idempotency-key": "dashboard-action-1" },
    body: {
      actionType: "mint_item",
      cost: 50,
      executionMode: "managed"
    }
  });

  const apps = await api.handle({
    method: "GET",
    url: `/apps?developerId=${services.defaultDeveloper.developerId}`
  });
  const setup = await api.handle({
    method: "GET",
    url: `/apps/${app.body.appId as string}/setup`
  });

  assert.equal(apps.statusCode, 200);
  assert.equal(apps.body.length, 1);
  assert.equal(apps.body[0].name, "Dashboard App");

  assert.equal(setup.statusCode, 200);
  assert.equal(setup.body.playerPolicy.allowedChainId, "eip155:11155111");
  assert.equal(setup.body.actions[0].executionMode, "managed");
});

test("demo developer session can be created and app list can be filtered per developer", async () => {
  const services = buildServices();
  const api = createApi(services);

  const signedUp = await api.handle({
    method: "POST",
    url: "/developer/sign-up",
    headers: { "idempotency-key": "dashboard-sign-up-1" },
    body: {
      username: "dashboard-dev",
      password: "dashboard-pass",
      developerId: "dev-local-1"
    }
  });

  const signedIn = await api.handle({
    method: "POST",
    url: "/developer/sign-in",
    body: {
      username: "dashboard-dev",
      password: "dashboard-pass"
    }
  });

  const developerSession = await api.handle({
    method: "POST",
    url: "/demo/developer/session",
    body: { developerId: "dev-local-1" }
  });

  await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dashboard-dev-app-1" },
    body: {
      developerId: "dev-local-1",
      name: "Developer Owned App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "solana:101"
    }
  });

  services.store.createDeveloper({ developerId: "another-dev", email: "another@demo.celeris.local" });
  await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dashboard-dev-app-2" },
    body: {
      developerId: "another-dev",
      name: "Another Dev App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const filteredApps = await api.handle({
    method: "GET",
    url: "/apps?developerId=dev-local-1"
  });

  assert.equal(signedUp.statusCode, 201);
  assert.equal(signedUp.body.developerId, "dev-local-1");
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.body.developerId, "dev-local-1");
  assert.equal(developerSession.statusCode, 200);
  assert.equal(developerSession.body.developerId, "dev-local-1");
  assert.equal(filteredApps.statusCode, 200);
  assert.equal(filteredApps.body.length, 1);
  assert.equal(filteredApps.body[0].name, "Developer Owned App");
});
