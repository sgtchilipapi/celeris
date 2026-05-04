import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { ClaimRewardsExecutionResult, ExecuteClaimRewardsRequest, MemoryStore } from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { ManagedActionService } from "./managed-action-service.js";

export class ClaimRewardsService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly managedActionService: ManagedActionService;

  constructor({
    store,
    ledgerService,
    managedActionService
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    managedActionService: ManagedActionService;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.managedActionService = managedActionService;
  }

  execute({ appId, walletPrincipal, actionId, idempotencyKey }: ExecuteClaimRewardsRequest): ClaimRewardsExecutionResult {
    this.managedActionService.validateClaimRewardsRequest({ actionId });
    const cached = this.store.getIdempotent<ClaimRewardsExecutionResult>(
      `claim-rewards:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}:${actionId}`,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

    const actionType = this.store.getActionType(appId, actionId);
    if (!actionType) {
      throw new AppError(404, `${actionId} action not configured`);
    }
    if (actionType.executionMode !== "managed") {
      throw new AppError(422, `${actionId} is not configured as a managed action`);
    }

    const pendingActionId = randomUUID();
    let reserved = false;

    try {
      if (actionType.cost > 0) {
        this.ledgerService.reserveCredits({
          walletPrincipal,
          appId,
          amount: actionType.cost,
          idempotencyKey: `${idempotencyKey}:reserve`,
          pendingActionId,
          metadata: { actionType: actionId }
        });
        reserved = true;

        this.ledgerService.captureCredits({
          walletPrincipal,
          appId,
          amount: actionType.cost,
          idempotencyKey: `${idempotencyKey}:capture`,
          pendingActionId,
          metadata: { actionType: actionId }
        });
      }

      const balance = this.store.getBalance(walletPrincipal, appId);
      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
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
      this.store.setIdempotent(
        `claim-rewards:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}:${actionId}`,
        idempotencyKey,
        result
      );
      return result;
    } catch (error) {
      if (reserved) {
        try {
          this.ledgerService.releaseCredits({
            walletPrincipal,
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
