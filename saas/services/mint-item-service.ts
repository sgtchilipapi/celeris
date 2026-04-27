import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  ActionType,
  ExecuteMintItemRequest,
  MemoryStore,
  MintItemApprovalResponse,
  MintItemExecutionResult,
  MintItemPayload,
  PendingAction,
  RejectedMintItemResult,
  UUID
} from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { MockDeveloperClient } from "./mock-developer-client.js";
import { MockTransactionExecutor } from "./mock-transaction-executor.js";

function hashPayload(payload: MintItemPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class MintItemService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly developerClient: MockDeveloperClient;
  readonly executor: MockTransactionExecutor;
  readonly clock: () => Date;

  constructor({
    store,
    ledgerService,
    developerClient,
    executor,
    clock = () => new Date()
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    developerClient: MockDeveloperClient;
    executor: MockTransactionExecutor;
    clock?: () => Date;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.developerClient = developerClient;
    this.executor = executor;
    this.clock = clock;
  }

  async execute({ appId, userId, payload, idempotencyKey }: ExecuteMintItemRequest): Promise<MintItemExecutionResult | RejectedMintItemResult> {
    const cached = this.store.getIdempotent<MintItemExecutionResult | RejectedMintItemResult>(`mint:${appId}:${userId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    const actionType = this.store.getActionType(appId, "mint_item");
    if (!actionType) {
      throw new AppError(404, "action type not configured");
    }

    const pendingAction = this.createPendingAction({ appId, userId, actionType, payload, idempotencyKey });

    try {
      this.ledgerService.reserveCredits({
        userId,
        appId,
        amount: actionType.cost,
        idempotencyKey: `pending:${pendingAction.id}:reserve`,
        pendingActionId: pendingAction.id
      });

      const approval = await this.developerClient.approveMintItem({
        pendingActionId: pendingAction.id,
        appId,
        userId,
        actionType: "mint_item",
        cost: actionType.cost,
        payload
      });

      if (approval.status !== "approved") {
        pendingAction.status = "released";
        this.store.savePendingAction(pendingAction);
        this.ledgerService.releaseCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release`,
          pendingActionId: pendingAction.id
        });
        const rejected: RejectedMintItemResult = {
          pendingActionId: pendingAction.id,
          status: "rejected",
          reason: approval.reason ?? "developer rejected action"
        };
        this.store.setIdempotent(`mint:${appId}:${userId}`, idempotencyKey, rejected);
        return rejected;
      }

      this.verifyApproval({ pendingAction, actionType, payload, approval });
      pendingAction.status = "approved";
      this.store.savePendingAction(pendingAction);

      const execution = await this.executor.submit();

      pendingAction.status = execution.status;
      this.store.savePendingAction(pendingAction);

      const transaction = this.store.createTransaction({
        txId: randomUUID(),
        pendingActionId: pendingAction.id,
        appId,
        userId,
        providerTxId: execution.providerTxId,
        rawTx: approval.tx,
        status: execution.status,
        summary: approval.summary,
        createdAt: new Date().toISOString()
      });

      this.ledgerService.captureCredits({
        userId,
        appId,
        amount: actionType.cost,
        idempotencyKey: `pending:${pendingAction.id}:capture`,
        pendingActionId: pendingAction.id
      });

      const asset = this.store.createAsset({
        assetId: randomUUID(),
        appId,
        userId,
        itemDefId: approval.summary.itemDefId,
        transactionId: transaction.txId,
        status: "held",
        createdAt: new Date().toISOString()
      });

      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        userId,
        eventType: "mint_item",
        value: actionType.cost,
        metadata: { pendingActionId: pendingAction.id, transactionId: transaction.txId },
        createdAt: new Date().toISOString()
      });

      const result: MintItemExecutionResult = {
        pendingActionId: pendingAction.id,
        transactionId: transaction.txId,
        assetId: asset.assetId,
        status: transaction.status
      };
      this.store.setIdempotent(`mint:${appId}:${userId}`, idempotencyKey, result);
      return result;
    } catch (error) {
      const latest = this.store.getPendingAction(pendingAction.id);
      if (latest?.status === "reserved" || latest?.status === "approved") {
        latest.status = "failed";
        this.store.savePendingAction(latest);
        this.ledgerService.releaseCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-error`,
          pendingActionId: pendingAction.id
        });
      }
      throw error;
    }
  }

  private createPendingAction({
    appId,
    userId,
    actionType,
    payload,
    idempotencyKey
  }: {
    appId: UUID;
    userId: UUID;
    actionType: ActionType;
    payload: MintItemPayload;
    idempotencyKey: string;
  }): PendingAction {
    const pendingAction: PendingAction = {
      id: randomUUID(),
      appId,
      userId,
      actionType: actionType.actionType,
      cost: actionType.cost,
      payloadHash: hashPayload(payload),
      status: "reserved",
      expiresAt: new Date(this.clock().getTime() + 10 * 60 * 1000).toISOString(),
      idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.store.createPendingAction(pendingAction);
    return pendingAction;
  }

  private verifyApproval({
    pendingAction,
    actionType,
    payload,
    approval
  }: {
    pendingAction: PendingAction;
    actionType: ActionType;
    payload: MintItemPayload;
    approval: Extract<MintItemApprovalResponse, { status: "approved" }>;
  }) {
    if (!approval.tx) {
      throw new AppError(422, "developer response missing tx");
    }
    if (approval.summary.actionType !== pendingAction.actionType) {
      throw new AppError(422, "developer summary action type mismatch");
    }
    if (approval.summary.debit !== actionType.cost) {
      throw new AppError(422, "developer summary debit mismatch");
    }
    if (approval.summary.itemDefId !== payload.itemDefId) {
      throw new AppError(422, "developer summary itemDefId mismatch");
    }
  }
}
