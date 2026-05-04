import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../db/memory-store.js";
import { CreditLedgerService } from "../services/credit-ledger-service.js";

function walletPrincipal(index: number) {
  return {
    walletAddress: `0xwallet${index}`,
    chainId: "eip155:1"
  };
}

test("ledger keeps wallet balance and reserved non-negative through grant reserve capture release", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const developer = store.createDeveloper({ email: "dev@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_1" });
  const principal = walletPrincipal(1);

  ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });
  ledger.reserveCredits({ walletPrincipal: principal, appId: app.appId, amount: 50, idempotencyKey: "reserve-1" });
  ledger.captureCredits({ walletPrincipal: principal, appId: app.appId, amount: 50, pendingActionId: "pa_1", idempotencyKey: "capture-1" });
  ledger.reserveCredits({ walletPrincipal: principal, appId: app.appId, amount: 25, idempotencyKey: "reserve-2" });
  ledger.releaseCredits({ walletPrincipal: principal, appId: app.appId, amount: 25, pendingActionId: "pa_2", idempotencyKey: "release-1" });

  assert.deepEqual(store.getBalance(principal, app.appId), {
    appId: app.appId,
    walletAddress: principal.walletAddress,
    chainId: principal.chainId,
    balance: 450,
    reserved: 0,
    updatedAt: store.getBalance(principal, app.appId).updatedAt
  });
});

test("ledger writes are idempotent by wallet scope and key", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const developer = store.createDeveloper({ email: "dev2@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_2" });
  const principal = walletPrincipal(2);

  const first = ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });
  const second = ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 500, idempotencyKey: "grant-1" });

  assert.equal(first.entry.entryId, second.entry.entryId);
  assert.equal(store.creditLedger.length, 1);
  assert.equal(store.getBalance(principal, app.appId).balance, 500);
});

test("reserve requires available balance and failed attempts do not mutate wallet state", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const developer = store.createDeveloper({ email: "dev3@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_3" });
  const principal = walletPrincipal(3);

  ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 20, idempotencyKey: "grant-3" });

  assert.throws(
    () => ledger.reserveCredits({ walletPrincipal: principal, appId: app.appId, amount: 50, idempotencyKey: "reserve-too-much" }),
    /insufficient credits/
  );
  assert.equal(store.getBalance(principal, app.appId).balance, 20);
  assert.equal(store.getBalance(principal, app.appId).reserved, 0);
  assert.equal(store.creditLedger.filter((entry) => entry.type === "reserve").length, 0);
});

test("capture and release reject invalid wallet state transitions", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const developer = store.createDeveloper({ email: "dev4@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_4" });
  const principal = walletPrincipal(4);

  ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 30, idempotencyKey: "grant-4" });
  ledger.reserveCredits({ walletPrincipal: principal, appId: app.appId, amount: 10, idempotencyKey: "reserve-4" });

  assert.throws(
    () => ledger.captureCredits({ walletPrincipal: principal, appId: app.appId, amount: 20, pendingActionId: "pa-4", idempotencyKey: "capture-too-much" }),
    /capture would make balance negative/
  );
  assert.throws(
    () => ledger.releaseCredits({ walletPrincipal: principal, appId: app.appId, amount: 20, pendingActionId: "pa-4", idempotencyKey: "release-too-much" }),
    /release would make reserved negative/
  );
  assert.equal(store.getBalance(principal, app.appId).balance, 30);
  assert.equal(store.getBalance(principal, app.appId).reserved, 10);
});

test("ledger rejects non-positive amounts", () => {
  const store = new MemoryStore();
  const ledger = new CreditLedgerService({ store });
  const developer = store.createDeveloper({ email: "dev5@test.local" });
  const app = store.createApp({ developerId: developer.developerId, name: "Test App", apiKey: "key_5" });
  const principal = walletPrincipal(5);

  assert.throws(
    () => ledger.grantCredits({ walletPrincipal: principal, appId: app.appId, amount: 0, idempotencyKey: "grant-zero" }),
    /amount must be a positive integer/
  );
  assert.throws(
    () => ledger.reserveCredits({ walletPrincipal: principal, appId: app.appId, amount: -1, idempotencyKey: "reserve-negative" }),
    /amount must be a positive integer/
  );
});
