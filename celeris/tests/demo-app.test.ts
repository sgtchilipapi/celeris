import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createPrivyTestToken } from "../services/privy-auth-service.js";

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

test("demo app assets and demo checkout completion endpoint are served for the frontend flow", async () => {
  const services = buildServices();
  const api = createApi(services);
  const walletAddress = "0xdemo123";
  const chainId = "eip155:1";
  const token = createPrivyTestToken({ walletAddress, chainId });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "demo-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Demo UI App",
      priceCents: 499,
      credits: 500,
      privyAppId: "demo-privy-app",
      allowedChainId: chainId
    }
  });

  const appId = app.body.appId as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "demo-checkout-1", authorization: `Bearer ${token}` },
    body: { packageId }
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
  assert.equal(services.store.getBalance({ walletAddress, chainId }, appId).balance, 500);
  assert.equal(demoPage.statusCode, 200);
  assert.equal(demoJs.statusCode, 200);
  assert.equal(demoCss.statusCode, 200);
  assert.match(String(demoPage.body), /Celeris Demo App/);
  assert.match(String(demoJs.body), /checkout\/complete/);
});
