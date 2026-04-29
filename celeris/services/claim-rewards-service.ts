import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { ClaimRewardsExecutionResult, ExecuteClaimRewardsRequest, MemoryStore } from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";

export class ClaimRewardsService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;

  constructor({ store, ledgerService }: { store: MemoryStore; ledgerService: CreditLedgerService }) {
    this.store = store;
    this.ledgerService = ledgerService;
  }

  execute({ appId, userId, actionId, idempotencyKey }: ExecuteClaimRewardsRequest): ClaimRewardsExecutionResult {
    const cached = this.store.getIdempotent<ClaimRewardsExecutionResult>(
      `claim-rewards:${appId}:${userId}:${actionId}`,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

    const actionType = this.store.getActionType(appId, actionId);
    if (!actionType) {
      throw new AppError(404, `${actionId} action not configured`);
    }

    const pendingActionId = randomUUID();
    let reserved = false;

    try {
      if (actionType.cost > 0) {
        this.ledgerService.reserveCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `${idempotencyKey}:reserve`,
          pendingActionId,
          metadata: { actionType: actionId }
        });
        reserved = true;

        this.ledgerService.captureCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `${idempotencyKey}:capture`,
          pendingActionId,
          metadata: { actionType: actionId }
        });
      }

      const balance = this.store.getBalance(userId, appId);
      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        userId,
        eventType: actionId,
        value: actionType.cost,
        metadata: { pendingActionId },
        createdAt: new Date().toISOString()
      });

      const result: ClaimRewardsExecutionResult = {
        actionType: actionId,
        debitedCredits: actionType.cost,
        remainingCredits: balance.balance,
        status: "success"
      };
      this.store.setIdempotent(`claim-rewards:${appId}:${userId}:${actionId}`, idempotencyKey, result);
      return result;
    } catch (error) {
      if (reserved) {
        try {
          this.ledgerService.releaseCredits({
            userId,
            appId,
            amount: actionType.cost,
            idempotencyKey: `${idempotencyKey}:release`,
            pendingActionId,
            metadata: { actionType: actionId }
          });
        } catch {
          // keep original error
        }
      }
      throw error;
    }
  }
}
