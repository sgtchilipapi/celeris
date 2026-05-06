import test from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "@solana/web3.js";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { ManagedActionService } from "../services/managed-action-service.js";
import type { ManagedMintItemRequest, ManagedMintItemResult, WalletPrincipal } from "../types.js";
import { createHostedPlayerSession } from "./helpers/auth.js";
import { createDeveloperApp, configureDeveloperAction, provisionSponsorWallet, signUpDeveloper } from "./helpers/developer.js";

class TestManagedActionService extends ManagedActionService {
  readonly buildResult: (request: ManagedMintItemRequest) => ManagedMintItemResult;

  constructor(buildResult: (request: ManagedMintItemRequest) => ManagedMintItemResult) {
    super();
    this.buildResult = buildResult;
  }

  override buildMintItemTransaction(request: ManagedMintItemRequest): ManagedMintItemResult {
    return this.buildResult(request);
  }
}

function buildCompletedCheckoutEvent({
  eventId,
  checkoutSessionId,
  appId,
  walletPrincipal,
  credits,
  amountCents
}: {
  eventId: string;
  checkoutSessionId: string;
  appId: string;
  walletPrincipal: WalletPrincipal;
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
          walletAddress: walletPrincipal.walletAddress,
          chainId: walletPrincipal.chainId,
          credits
        }
      }
    }
  };
}

async function setupMintFlow(managedActionService: ManagedActionService) {
  const services = buildServices({ managedActionService });
  const api = createApi(services);
  const walletPrincipal = {
    walletAddress: "0xtxv123",
    chainId: "eip155:1"
  } satisfies WalletPrincipal;
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });

  const app = await createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name: "Transaction Verification App",
    priceCents: 499,
    credits: 500,
    allowedChainId: walletPrincipal.chainId
  });

  const appId = app.appId as string;
  const session = await createHostedPlayerSession({
    api,
    appId,
    walletAddress: walletPrincipal.walletAddress
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
  await provisionSponsorWallet({
    api,
    accessToken: developer.accessToken,
    appId
  });

  const checkout = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/checkout-sessions`,
    headers: { "idempotency-key": "txv-checkout-1", authorization: `Bearer ${session.accessToken}` },
    body: { packageId }
  });

  const paymentEvent = buildCompletedCheckoutEvent({
    eventId: "evt_txv_1",
    checkoutSessionId: checkout.body.checkoutSessionId as string,
    appId,
    walletPrincipal,
    credits: 500,
    amountCents: 499
  });

  await api.handle({
    method: "POST",
    url: "/v1/webhooks/stripe",
    headers: {
      "idempotency-key": "txv-webhook-1",
      "stripe-signature": services.stripeGateway.signWebhookPayload(paymentEvent)
    },
    body: paymentEvent
  });

  return { services, api, appId, token: session.accessToken, walletPrincipal };
}

test("verification rejects mismatched debit and releases reserved credits", async () => {
  const managedActionService = new TestManagedActionService((request) => ({
    preparedTransaction: new ManagedActionService().buildMintItemTransaction(request).preparedTransaction,
    summary: {
      actionType: "mint_item",
      itemDefId: request.payload.itemDefId,
      debit: 75
    }
  }));
  const { services, api, appId, token, walletPrincipal } = await setupMintFlow(managedActionService);

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "txv-mint-debit-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "managed action summary debit mismatch");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
  const pendingAction = [...services.store.pendingActions.values()].find((candidate) => candidate.appId === appId)!;
  assert.equal(pendingAction.status, "failed");
});

test("verification rejects invalid prepared transaction structure and releases reserved credits", async () => {
  const managedActionService = new TestManagedActionService(({ payload }) => ({
    preparedTransaction: {
      appId: "wrong-app-id",
      transaction: new Transaction()
    },
    summary: {
      actionType: "mint_item",
      itemDefId: payload.itemDefId,
      debit: 50
    }
  }));
  const { services, api, appId, token, walletPrincipal } = await setupMintFlow(managedActionService);

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "txv-mint-tx-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "managed action prepared transaction failed basic sanity checks");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("verification rejects disallowed action types and releases reserved credits", async () => {
  const managedActionService = new TestManagedActionService((request) => ({
    preparedTransaction: new ManagedActionService().buildMintItemTransaction(request).preparedTransaction,
    summary: {
      actionType: "burn_item" as "mint_item",
      itemDefId: request.payload.itemDefId,
      debit: 50
    }
  }));
  const { services, api, appId, token, walletPrincipal } = await setupMintFlow(managedActionService);

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "txv-mint-action-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "managed action summary action type not allowed");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});

test("verification rejects when pending action disappears before execution", async () => {
  let capturedPendingActionId = "";
  const managedActionService = new TestManagedActionService((request) => {
    capturedPendingActionId = request.pendingActionId;
    return {
      preparedTransaction: {
        appId: request.appId,
        transaction: new Transaction().add(...new ManagedActionService().buildMintItemTransaction(request).preparedTransaction.transaction.instructions)
      },
      summary: {
        actionType: "mint_item",
        itemDefId: request.payload.itemDefId,
        debit: 50
      }
    };
  });
  const { services, api, appId, token, walletPrincipal } = await setupMintFlow(managedActionService);

  const original = services.managedActionService.buildMintItemTransaction.bind(services.managedActionService);
  services.managedActionService.buildMintItemTransaction = ((request: ManagedMintItemRequest) => {
    const result = original(request);
    services.store.pendingActions.delete(capturedPendingActionId || request.pendingActionId);
    return result;
  }) as typeof services.managedActionService.buildMintItemTransaction;

  const mint = await api.handle({
    method: "POST",
    url: `/v1/apps/${appId}/actions/mint_item/execute`,
    headers: { "idempotency-key": "txv-mint-pa-1", authorization: `Bearer ${token}` },
    body: { payload: { itemDefId: "iron_sword" } }
  });

  assert.equal(mint.statusCode, 422);
  assert.equal(mint.body.error, "pending action not found during verification");
  assert.equal(services.store.getBalance(walletPrincipal, appId).balance, 500);
  assert.equal(services.store.getBalance(walletPrincipal, appId).reserved, 0);
});
