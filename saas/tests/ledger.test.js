import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../db/memory-store.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";

test("ledger keeps balance and reserved non-negative through grant reserve capture release", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const { userId } = store.createUser({ externalSubject: "dummy:player-1@example.com", email: "player-1@example.com" });
  const developer = store.createDeveloper({ email: "dev@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_1" });

  ledger.grantCredits({ userId, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });
  ledger.reserveCredits({ userId, appId: app.appId, amount: 50, idempotencyKey: "reserve-1" });
  ledger.captureCredits({ userId, appId: app.appId, amount: 50, pendingActionId: "pa_1", idempotencyKey: "capture-1" });
  ledger.reserveCredits({ userId, appId: app.appId, amount: 25, idempotencyKey: "reserve-2" });
  ledger.releaseCredits({ userId, appId: app.appId, amount: 25, pendingActionId: "pa_2", idempotencyKey: "release-1" });

  assert.deepEqual(store.getBalance(userId, app.appId), {
    userId,
    appId: app.appId,
    balance: 450,
    reserved: 0,
    updatedAt: store.getBalance(userId, app.appId).updatedAt
  });
});

test("ledger writes are idempotent by operation scope and key", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const { userId } = store.createUser({ externalSubject: "dummy:player-2@example.com", email: "player-2@example.com" });
  const developer = store.createDeveloper({ email: "dev2@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_2" });

  const first = ledger.grantCredits({ userId, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });
  const second = ledger.grantCredits({ userId, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });

  assert.equal(first.entry.entryId, second.entry.entryId);
  assert.equal(store.creditLedger.length, 1);
  assert.equal(store.getBalance(userId, app.appId).balance, 500);
});
