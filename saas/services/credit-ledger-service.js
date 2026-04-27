import { randomUUID } from "node:crypto";
import { AppError, InsufficientCreditsError } from "./errors.js";

export class CreditLedgerService {
  constructor({ store }) {
    this.store = store;
  }

  grantCredits({ userId, appId, amount, idempotencyKey, paymentId = null, metadata = {} }) {
    this.#assertPositiveAmount(amount);
    return this.#runIdempotent(`grant:${appId}:${userId}`, idempotencyKey, () => {
      return this.store.withLockedBalance(userId, appId, (balance) => {
        balance.balance += amount;
        this.store.saveBalance(balance);
        const entry = this.#ledgerEntry({ userId, appId, type: "grant", amount, idempotencyKey, paymentId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      });
    });
  }

  reserveCredits({ userId, appId, amount, idempotencyKey, pendingActionId = null, metadata = {} }) {
    this.#assertPositiveAmount(amount);
    return this.#runIdempotent(`reserve:${appId}:${userId}`, idempotencyKey, () => {
      return this.store.withLockedBalance(userId, appId, (balance) => {
        if (balance.balance - balance.reserved < amount) {
          throw new InsufficientCreditsError();
        }
        balance.reserved += amount;
        this.store.saveBalance(balance);
        const entry = this.#ledgerEntry({ userId, appId, type: "reserve", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      });
    });
  }

  captureCredits({ userId, appId, amount, idempotencyKey, pendingActionId, metadata = {} }) {
    this.#assertPositiveAmount(amount);
    return this.#runIdempotent(`capture:${appId}:${userId}`, idempotencyKey, () => {
      return this.store.withLockedBalance(userId, appId, (balance) => {
        if (balance.balance < amount || balance.reserved < amount) {
          throw new AppError(409, "capture would make balance negative");
        }
        balance.balance -= amount;
        balance.reserved -= amount;
        this.store.saveBalance(balance);
        const entry = this.#ledgerEntry({ userId, appId, type: "capture", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      });
    });
  }

  releaseCredits({ userId, appId, amount, idempotencyKey, pendingActionId, metadata = {} }) {
    this.#assertPositiveAmount(amount);
    return this.#runIdempotent(`release:${appId}:${userId}`, idempotencyKey, () => {
      return this.store.withLockedBalance(userId, appId, (balance) => {
        if (balance.reserved < amount) {
          throw new AppError(409, "release would make reserved negative");
        }
        balance.reserved -= amount;
        this.store.saveBalance(balance);
        const entry = this.#ledgerEntry({ userId, appId, type: "release", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      });
    });
  }

  #runIdempotent(scope, idempotencyKey, callback) {
    const cached = this.store.getIdempotent(scope, idempotencyKey);
    if (cached) {
      return cached;
    }
    const result = callback();
    this.store.setIdempotent(scope, idempotencyKey, result);
    return result;
  }

  #ledgerEntry({ userId, appId, type, amount, idempotencyKey, pendingActionId = null, paymentId = null, metadata }) {
    return {
      entryId: randomUUID(),
      userId,
      appId,
      pendingActionId,
      paymentId,
      type,
      amount,
      idempotencyKey,
      metadata,
      createdAt: new Date().toISOString()
    };
  }

  #assertPositiveAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(400, "amount must be a positive integer");
    }
  }
}
