import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../db/memory-store.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";
import { PendingActionService } from "../services/pending-action-service.js";

test("createPendingAction validates balance by reserving credits before creating the pending action", () => {
  const store = new MemoryStore();
  const ledgerService = new CreditLedgerService({ store });
  const service = new PendingActionService({
    store,
    ledgerService,
    clock: () => new Date("2026-04-27T10:00:00.000Z")
  });
  const developer = store.createDeveloper({ email: "dev@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Pending App", apiKey: "key_1" });
  const user = store.createUser({ externalSubject: "dummy:pending@example.com", email: "pending@example.com" });

  ledgerService.grantCredits({ userId: user.userId, appId: app.appId, amount: 100, idempotencyKey: "grant-pending-1" });

  const pendingAction = service.createPendingAction({
    userId: user.userId,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    payloadHash: "payload-hash",
    idempotencyKey: "pending-create-1"
  });

  assert.equal(pendingAction.status, "reserved");
  assert.equal(pendingAction.actionType, "mint_item");
  assert.equal(store.getBalance(user.userId, app.appId).balance, 100);
  assert.equal(store.getBalance(user.userId, app.appId).reserved, 50);
  assert.equal(store.getPendingAction(pendingAction.id)?.id, pendingAction.id);
});

test("createPendingAction is idempotent and uses a 60 second ttl", () => {
  const store = new MemoryStore();
  const ledgerService = new CreditLedgerService({ store });
  const baseTime = new Date("2026-04-27T10:00:00.000Z");
  const service = new PendingActionService({
    store,
    ledgerService,
    clock: () => baseTime
  });
  const developer = store.createDeveloper({ email: "dev2@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Pending App", apiKey: "key_2" });
  const user = store.createUser({ externalSubject: "dummy:pending2@example.com", email: "pending2@example.com" });

  ledgerService.grantCredits({ userId: user.userId, appId: app.appId, amount: 100, idempotencyKey: "grant-pending-2" });

  const first = service.createPendingAction({
    userId: user.userId,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    payloadHash: "payload-hash",
    idempotencyKey: "pending-create-2"
  });
  const duplicate = service.createPendingAction({
    userId: user.userId,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    payloadHash: "payload-hash",
    idempotencyKey: "pending-create-2"
  });

  assert.equal(first.id, duplicate.id);
  assert.equal(store.pendingActions.size, 1);
  assert.equal(store.getBalance(user.userId, app.appId).reserved, 50);
  assert.equal(new Date(first.expiresAt).getTime() - baseTime.getTime(), 60_000);
});

test("expirePendingAction marks expired reserved actions and releases credits", () => {
  const store = new MemoryStore();
  const ledgerService = new CreditLedgerService({ store });
  let currentTime = new Date("2026-04-27T10:00:00.000Z");
  const service = new PendingActionService({
    store,
    ledgerService,
    clock: () => currentTime
  });
  const developer = store.createDeveloper({ email: "dev3@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Pending App", apiKey: "key_3" });
  const user = store.createUser({ externalSubject: "dummy:pending3@example.com", email: "pending3@example.com" });

  ledgerService.grantCredits({ userId: user.userId, appId: app.appId, amount: 100, idempotencyKey: "grant-pending-3" });

  const pendingAction = service.createPendingAction({
    userId: user.userId,
    appId: app.appId,
    actionType: "mint_item",
    cost: 50,
    payloadHash: "payload-hash",
    idempotencyKey: "pending-create-3"
  });

  currentTime = new Date("2026-04-27T10:01:01.000Z");
  const expired = service.expirePendingAction(pendingAction.id);

  assert.equal(expired.status, "expired");
  assert.equal(store.getBalance(user.userId, app.appId).reserved, 0);
  assert.equal(store.getBalance(user.userId, app.appId).balance, 100);
  assert.equal(store.creditLedger.filter((entry) => entry.type === "release").length, 1);
});
