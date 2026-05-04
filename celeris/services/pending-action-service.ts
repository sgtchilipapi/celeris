import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { CreatePendingActionRequest, MemoryStore, PendingAction } from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";

export class PendingActionService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly ttlSeconds: number;
  readonly clock: () => Date;

  constructor({
    store,
    ledgerService,
    ttlSeconds = 60,
    clock = () => new Date()
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    ttlSeconds?: number;
    clock?: () => Date;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.ttlSeconds = ttlSeconds;
    this.clock = clock;
  }

  createPendingAction({
    walletPrincipal,
    appId,
    actionType,
    cost,
    payloadHash,
    idempotencyKey
  }: CreatePendingActionRequest): PendingAction {
    const cached = this.store.getIdempotent<PendingAction>(
      `pending-action:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

    const pendingAction: PendingAction = {
      id: randomUUID(),
      appId,
      walletAddress: walletPrincipal.walletAddress,
      chainId: walletPrincipal.chainId,
      actionType,
      cost,
      payloadHash,
      status: "reserved",
      expiresAt: new Date(this.clock().getTime() + this.ttlSeconds * 1000).toISOString(),
      idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.ledgerService.reserveCredits({
      walletPrincipal,
      appId,
      amount: cost,
      idempotencyKey: `pending:${pendingAction.id}:reserve`,
      pendingActionId: pendingAction.id
    });

    this.store.createPendingAction(pendingAction);
    this.store.setIdempotent(
      `pending-action:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`,
      idempotencyKey,
      pendingAction
    );
    return pendingAction;
  }

  expirePendingAction(pendingActionId: string): PendingAction {
    const pendingAction = this.store.getPendingAction(pendingActionId);
    if (!pendingAction) {
      throw new AppError(404, "pending action not found");
    }
    if (pendingAction.status !== "reserved") {
      return pendingAction;
    }
    if (!this.isExpiredAt(pendingAction.expiresAt)) {
      return pendingAction;
    }

    pendingAction.status = "expired";
    this.store.savePendingAction(pendingAction);
    this.ledgerService.releaseCredits({
      walletPrincipal: {
        walletAddress: pendingAction.walletAddress,
        chainId: pendingAction.chainId
      },
      appId: pendingAction.appId,
      amount: pendingAction.cost,
      idempotencyKey: `pending:${pendingAction.id}:expire-release`,
      pendingActionId: pendingAction.id
    });
    return pendingAction;
  }

  private isExpiredAt(value: string | Date): boolean {
    const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return instant <= this.clock().getTime();
  }
}
