import { randomUUID } from "node:crypto";
import { AppError, InsufficientCreditsError } from "./errors.js";
import type { CreditLedgerEntry, JsonObject, MemoryStore, UUID, WalletPrincipal } from "../types.js";

interface LedgerMutationInput {
  appId: UUID;
  walletPrincipal: WalletPrincipal;
  amount: number;
  idempotencyKey: string;
  pendingActionId?: UUID | null;
  paymentId?: UUID | null;
  metadata?: JsonObject;
}

export class CreditLedgerService {
  readonly store: MemoryStore;

  constructor({ store }: { store: MemoryStore }) {
    this.store = store;
  }

  grantCredits({ walletPrincipal, appId, amount, idempotencyKey, paymentId = null, metadata = {} }: LedgerMutationInput) {
    this.assertPositiveAmount(amount);
    return this.runIdempotent(`grant:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`, idempotencyKey, () =>
      this.store.withLockedBalance(walletPrincipal, appId, (balance) => {
        balance.balance += amount;
        this.store.saveBalance(balance);
        const entry = this.ledgerEntry({ walletPrincipal, appId, type: "grant", amount, idempotencyKey, paymentId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      })
    );
  }

  reserveCredits({ walletPrincipal, appId, amount, idempotencyKey, pendingActionId = null, metadata = {} }: LedgerMutationInput) {
    this.assertPositiveAmount(amount);
    return this.runIdempotent(`reserve:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`, idempotencyKey, () =>
      this.store.withLockedBalance(walletPrincipal, appId, (balance) => {
        if (balance.balance - balance.reserved < amount) {
          throw new InsufficientCreditsError();
        }
        balance.reserved += amount;
        this.store.saveBalance(balance);
        const entry = this.ledgerEntry({ walletPrincipal, appId, type: "reserve", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      })
    );
  }

  captureCredits({ walletPrincipal, appId, amount, idempotencyKey, pendingActionId = null, metadata = {} }: LedgerMutationInput) {
    this.assertPositiveAmount(amount);
    return this.runIdempotent(`capture:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`, idempotencyKey, () =>
      this.store.withLockedBalance(walletPrincipal, appId, (balance) => {
        if (balance.balance < amount || balance.reserved < amount) {
          throw new AppError(409, "capture would make balance negative");
        }
        balance.balance -= amount;
        balance.reserved -= amount;
        this.store.saveBalance(balance);
        const entry = this.ledgerEntry({ walletPrincipal, appId, type: "capture", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      })
    );
  }

  releaseCredits({ walletPrincipal, appId, amount, idempotencyKey, pendingActionId = null, metadata = {} }: LedgerMutationInput) {
    this.assertPositiveAmount(amount);
    return this.runIdempotent(`release:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`, idempotencyKey, () =>
      this.store.withLockedBalance(walletPrincipal, appId, (balance) => {
        if (balance.reserved < amount) {
          throw new AppError(409, "release would make reserved negative");
        }
        balance.reserved -= amount;
        this.store.saveBalance(balance);
        const entry = this.ledgerEntry({ walletPrincipal, appId, type: "release", amount, idempotencyKey, pendingActionId, metadata });
        this.store.addLedgerEntry(entry);
        return { balance: { ...balance }, entry };
      })
    );
  }

  private runIdempotent<T>(scope: string, idempotencyKey: string, callback: () => T): T {
    const cached = this.store.getIdempotent<T>(scope, idempotencyKey);
    if (cached) {
      return cached;
    }
    const result = callback();
    this.store.setIdempotent(scope, idempotencyKey, result);
    return result;
  }

  private ledgerEntry({
    walletPrincipal,
    appId,
    type,
    amount,
    idempotencyKey,
    pendingActionId = null,
    paymentId = null,
    metadata = {}
  }: {
    walletPrincipal: WalletPrincipal;
    appId: UUID;
    type: CreditLedgerEntry["type"];
    amount: number;
    idempotencyKey: string;
    pendingActionId?: UUID | null;
    paymentId?: UUID | null;
    metadata?: JsonObject;
  }): CreditLedgerEntry {
    return {
      entryId: randomUUID(),
      appId,
      walletAddress: walletPrincipal.walletAddress,
      chainId: walletPrincipal.chainId,
      pendingActionId,
      paymentId,
      type,
      amount,
      idempotencyKey,
      metadata,
      createdAt: new Date().toISOString()
    };
  }

  private assertPositiveAmount(amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(400, "amount must be a positive integer");
    }
  }
}
