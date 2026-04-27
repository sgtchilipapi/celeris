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

test("reserve requires available balance and failed attempts do not mutate state", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const { userId } = store.createUser({ externalSubject: "dummy:player-3@example.com", email: "player-3@example.com" });
  const developer = store.createDeveloper({ email: "dev3@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_3" });

  ledger.grantCredits({ userId, appId: app.appId, amount: 20, idempotencyKey: "grant-3" });

  assert.throws(
    () => ledger.reserveCredits({ userId, appId: app.appId, amount: 50, idempotencyKey: "reserve-too-much" }),
    /insufficient credits/
  );
  assert.equal(store.getBalance(userId, app.appId).balance, 20);
  assert.equal(store.getBalance(userId, app.appId).reserved, 0);
  assert.equal(store.creditLedger.filter((entry) => entry.type === "reserve").length, 0);
});

test("capture and release reject invalid state transitions", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const { userId } = store.createUser({ externalSubject: "dummy:player-4@example.com", email: "player-4@example.com" });
  const developer = store.createDeveloper({ email: "dev4@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_4" });

  ledger.grantCredits({ userId, appId: app.appId, amount: 30, idempotencyKey: "grant-4" });
  ledger.reserveCredits({ userId, appId: app.appId, amount: 10, idempotencyKey: "reserve-4" });

  assert.throws(
    () => ledger.captureCredits({ userId, appId: app.appId, amount: 20, pendingActionId: "pa-4", idempotencyKey: "capture-too-much" }),
    /capture would make balance negative/
  );
  assert.throws(
    () => ledger.releaseCredits({ userId, appId: app.appId, amount: 20, pendingActionId: "pa-4", idempotencyKey: "release-too-much" }),
    /release would make reserved negative/
  );
  assert.equal(store.getBalance(userId, app.appId).balance, 30);
  assert.equal(store.getBalance(userId, app.appId).reserved, 10);
});

test("ledger rejects non-positive amounts", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const { userId } = store.createUser({ externalSubject: "dummy:player-5@example.com", email: "player-5@example.com" });
  const developer = store.createDeveloper({ email: "dev5@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_5" });

  assert.throws(
    () => ledger.grantCredits({ userId, appId: app.appId, amount: 0, idempotencyKey: "grant-zero" }),
    /amount must be a positive integer/
  );
  assert.throws(
    () => ledger.reserveCredits({ userId, appId: app.appId, amount: -1, idempotencyKey: "reserve-negative" }),
    /amount must be a positive integer/
  );
});
