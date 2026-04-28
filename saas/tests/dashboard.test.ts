import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

function approvedDeveloperResponse() {
  return new Response(
    JSON.stringify({
      status: "approved",
      tx: "bW9ja190eA==",
      summary: {
        actionType: "mint_item",
        itemDefId: "iron_sword",
        debit: 50
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function buildCompletedCheckoutEvent({
  eventId,
  checkoutSessionId,
  userId,
  appId,
  credits,
  amountCents
}: {
  eventId: string;
  checkoutSessionId: string;
  userId: string;
  appId: string;
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
        metadata: { userId, appId, credits }
      }
    }
  };
}

test("dashboard endpoints expose app list and aggregated per-app metrics", async () => {
  const relayerNetworkClient: RelayerNetworkClient = {
    async sendTransaction() {
      return { txHash: "mock_chain_dashboard" };
    },
    async getTransactionStatus(): Promise<Exclude<TransactionStatus, "submitted">> {
      return "success";
    }
  };

  const services = buildServices({
    developerFetch: async () => approvedDeveloperResponse(),
    relayerNetworkClient
  });
  const api = createApi(services);

  const session = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "dashboard-session-1" },
    body: { provider: "dummy", email: "dashboard@example.com" }
  });

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "dashboard-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Dashboard App",
      priceCents: 499,
      credits: 500,
      webhookUrl: "http://localhost:3001"
    }
  });

  const appId = app.body.appId as string;
  const userId = session.body.userId as string;
  const token = session.body.token as string;
  const packageId = [...services.store.creditPackages.values()].find((pkg) => pkg.appId === appId)!.packageId;

  await api.handle({
    method: "POST",
    url: `/apps/${appId}/actions`,
    headers: { "idempotency-key": "dashboard-action-1" },
    body: { actionType: "mint_item", cost: 50 }
  });

  const checkout = await api.handle({
    method: "POST",
    url: "/checkout/session",
    headers: { "idempotency-key": "dashboard-checkout-1" },
    body: { appId, userId, packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_dashboard_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    userId,
    appId,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/webhooks/payment",
    headers: {
      "idempotency-key": "dashboard-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  await api.handle({
    method: "POST",
    url: "/actions/mint_item",
    headers: {
      "idempotency-key": "dashboard-mint-1",
      authorization: `Bearer ${token}`
    },
    body: { appId, payload: { itemDefId: "iron_sword" } }
  });

  const apps = await api.handle({
    method: "GET",
    url: "/apps"
  });
  const metrics = await api.handle({
    method: "GET",
    url: `/metrics?appId=${appId}`
  });
  const dashboardPage = await api.handle({
    method: "GET",
    url: "/dashboard"
  });

  assert.equal(apps.statusCode, 200);
  assert.equal(apps.body.length, 1);
  assert.equal(apps.body[0].name, "Dashboard App");

  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.body.totalUsers, 1);
  assert.equal(metrics.body.totalRevenueCents, 499);
  assert.equal(metrics.body.creditsPurchased, 500);
  assert.equal(metrics.body.creditsSpent, 50);
  assert.equal(metrics.body.mintItemCount, 1);
  assert.equal(metrics.body.successfulTransactions, 1);
  assert.equal(metrics.body.failedTransactions, 0);
  assert.equal(metrics.body.chartSeries.creditFlow.length, 2);
  assert.equal(metrics.body.chartSeries.transactionOutcomes.length, 2);
  assert.equal(metrics.body.users.length, 1);

  assert.equal(dashboardPage.statusCode, 200);
  assert.match(String(dashboardPage.body), /Celeris Dashboard/);
  assert.match(String(dashboardPage.body), /Username/);
  assert.match(String(dashboardPage.body), /Webhook URL/);
});

test("demo developer session can be created and app list can be filtered per developer", async () => {
  const services = buildServices();
  const api = createApi(services);

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
      webhookUrl: "http://localhost:3001"
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
      webhookUrl: "http://localhost:3001"
    }
  });

  const filteredApps = await api.handle({
    method: "GET",
    url: "/apps?developerId=dev-local-1"
  });

  assert.equal(developerSession.statusCode, 200);
  assert.equal(developerSession.body.developerId, "dev-local-1");
  assert.equal(filteredApps.statusCode, 200);
  assert.equal(filteredApps.body.length, 1);
  assert.equal(filteredApps.body[0].name, "Developer Owned App");
});
