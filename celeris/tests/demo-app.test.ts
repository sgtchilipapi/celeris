import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

test("demo app assets and demo checkout completion endpoint are served for the frontend flow", async () => {
  const services = buildServices();
  const api = createApi(services);

  const signedUp = await api.handle({
    method: "POST",
    url: "/player/sign-up",
    headers: { "idempotency-key": "demo-player-sign-up-1" },
    body: { username: "demo-player", password: "demo-pass" }
  });

  const session = await api.handle({
    method: "POST",
    url: "/player/sign-in",
    body: { username: "demo-player", password: "demo-pass" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "demo-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Demo UI App",
      priceCents: 499,
      credits: 500,
      webhookUrl: "http://localhost:3001"
    }
  });

  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "demo-checkout-1" },
    body: { appId, userId, packageId }
  });

  const completed = await api.handle({
    method: "POST",
    url: "/demo/checkout/complete",
    headers: { "idempotency-key": "demo-complete-1" },
    body: { checkoutSessionId: checkout.body.checkoutSessionId as string }
  });

  const demoPage = await api.handle({
    method: "GET",
    url: "/demo"
  });
  const demoJs = await api.handle({
    method: "GET",
    url: "/demo/app.js"
  });
  const demoCss = await api.handle({
    method: "GET",
    url: "/demo/styles.css"
  });

  assert.equal(completed.statusCode, 200);
  assert.equal(completed.body.grantedCredits, 500);
  assert.equal(session.body.userId, signedUp.body.userId);
  assert.equal(services.store.getBalance(userId, appId).balance, 500);
  assert.equal(demoPage.statusCode, 200);
  assert.equal(demoJs.statusCode, 200);
  assert.equal(demoCss.statusCode, 200);
  assert.match(String(demoPage.body), /Celeris Demo App/);
  assert.match(String(demoJs.body), /checkout\/complete/);
});
