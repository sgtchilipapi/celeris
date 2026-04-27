import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  ExecuteMintItemRequest,
  MemoryStore,
  MintItemApprovalResponse,
  MintItemExecutionResult,
  MintItemPayload,
  PendingAction,
  UUID
} from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { DeveloperBackendClient } from "./developer-backend-client.js";
import { PendingActionService } from "./pending-action-service.js";
import { RelayerService } from "./relayer-service.js";

function hashPayload(payload: MintItemPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class MintItemService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly developerClient: DeveloperBackendClient;
  readonly relayerService: RelayerService;
  readonly pendingActionService: PendingActionService;

  constructor({
    store,
    ledgerService,
    developerClient,
    relayerService,
    pendingActionService
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    developerClient: DeveloperBackendClient;
    relayerService: RelayerService;
    pendingActionService: PendingActionService;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.developerClient = developerClient;
    this.relayerService = relayerService;
    this.pendingActionService = pendingActionService;
  }

  async execute({ appId, userId, payload, idempotencyKey }: ExecuteMintItemRequest): Promise<MintItemExecutionResult> {
    const cached = this.store.getIdempotent<MintItemExecutionResult | { status: "rejected"; pendingActionId: UUID; reason: string }>(
      `mint:${appId}:${userId}`,
      idempotencyKey
    );
    if (cached) {
      if ("status" in cached && cached.status === "rejected") {
        throw new AppError(422, cached.reason, {
          pendingActionId: cached.pendingActionId,
          status: "failed"
        });
      }
      return cached;
    }
    const actionType = this.store.getActionType(appId, "mint_item");
    if (!actionType) {
      throw new AppError(404, "action type not configured");
    }

    const pendingAction = this.pendingActionService.createPendingAction({
      appId,
      userId,
      actionType: actionType.actionType,
      cost: actionType.cost,
      payloadHash: hashPayload(payload),
      idempotencyKey
    });

    try {
      const approval = await this.developerClient.approveMintItem({
        pendingActionId: pendingAction.id,
        appId,
        userId,
        actionType: "mint_item",
        cost: actionType.cost,
        payload
      });

      if (approval.status !== "approved") {
        pendingAction.status = "failed";
        this.store.savePendingAction(pendingAction);
        this.ledgerService.releaseCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release`,
          pendingActionId: pendingAction.id
        });
        const rejected = {
          pendingActionId: pendingAction.id,
          status: "rejected",
          reason: approval.reason ?? "developer rejected action"
        } as const;
        this.store.setIdempotent(`mint:${appId}:${userId}`, idempotencyKey, rejected);
        throw new AppError(422, rejected.reason, {
          pendingActionId: pendingAction.id,
          status: "failed"
        });
      }

      this.verifyApproval({ pendingAction, payload, approval });
      pendingAction.status = "approved";
      this.store.savePendingAction(pendingAction);

      const transaction = this.store.createTransaction({
        txId: randomUUID(),
        pendingActionId: pendingAction.id,
        appId,
        userId,
        providerTxId: "",
        rawTx: approval.tx,
        status: "submitted",
        summary: approval.summary,
        createdAt: new Date().toISOString()
      });

      const submission = await this.relayerService.submitTransaction(approval.tx);
      transaction.providerTxId = submission.providerTxId;
      this.store.saveTransaction(transaction);

      pendingAction.status = "submitted";
      this.store.savePendingAction(pendingAction);

      const finalStatus = await this.relayerService.resolveTransactionStatus(submission.providerTxId);
      transaction.status = finalStatus;
      this.store.saveTransaction(transaction);

      if (finalStatus === "failed") {
        pendingAction.status = "failed";
        this.store.savePendingAction(pendingAction);
        this.ledgerService.releaseCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-failed`,
          pendingActionId: pendingAction.id
        });
        throw new AppError(502, "transaction failed after submission", {
          pendingActionId: pendingAction.id,
          transactionId: transaction.txId,
          providerTxId: submission.providerTxId,
          status: "failed"
        });
      }

      pendingAction.status = "success";
      this.store.savePendingAction(pendingAction);

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
      if (!latest) {
        this.ledgerService.releaseCredits({
          userId,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-missing`,
          pendingActionId: pendingAction.id
        });
      } else if (latest.status === "reserved" || latest.status === "approved" || latest.status === "submitted") {
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

  private verifyApproval({
    pendingAction,
    payload,
    approval
  }: {
    pendingAction: PendingAction;
    payload: MintItemPayload;
    approval: Extract<MintItemApprovalResponse, { status: "approved" }>;
  }) {
    const storedPendingAction = this.store.getPendingAction(pendingAction.id);
    if (!storedPendingAction) {
      throw new AppError(422, "pending action not found during verification");
    }
    if (storedPendingAction.status !== "reserved") {
      throw new AppError(422, "pending action is not active");
    }
    if (new Date(storedPendingAction.expiresAt).getTime() <= Date.now()) {
      throw new AppError(422, "pending action expired");
    }

    const allowedActionType = this.store.getActionType(storedPendingAction.appId, approval.summary.actionType);
    if (!allowedActionType) {
      throw new AppError(422, "developer summary action type not allowed");
    }

    const balance = this.store.getBalance(storedPendingAction.userId, storedPendingAction.appId);
    if (balance.reserved < storedPendingAction.cost) {
      throw new AppError(422, "reserved credits mismatch");
    }

    if (!approval.tx) {
      throw new AppError(422, "developer response missing tx");
    }
    if (!this.isSaneTransactionPayload(approval.tx)) {
      throw new AppError(422, "developer tx failed basic sanity checks");
    }
    if (approval.summary.actionType !== storedPendingAction.actionType) {
      throw new AppError(422, "developer summary action type mismatch");
    }
    if (approval.summary.debit !== storedPendingAction.cost) {
      throw new AppError(422, "developer summary debit mismatch");
    }
    if (approval.summary.itemDefId !== payload.itemDefId) {
      throw new AppError(422, "developer summary itemDefId mismatch");
    }
  }

  private isSaneTransactionPayload(tx: string): boolean {
    if (typeof tx !== "string" || tx.trim().length < 8) {
      return false;
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(tx) || tx.length % 4 !== 0) {
      return false;
    }
    try {
      const decoded = Buffer.from(tx, "base64").toString("utf8");
      return decoded.trim().length > 0;
    } catch {
      return false;
    }
  }
}
