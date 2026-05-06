import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  ExecuteMintItemRequest,
  MintItemExecutionResult,
  MintItemPayload,
  PendingAction,
  ManagedMintItemResult,
  MemoryStore,
  UUID
} from "../types.js";
import { AssetDeliveryService } from "./asset-delivery-service.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { ManagedActionService } from "./managed-action-service.js";
import { PendingActionService } from "./pending-action-service.js";
import { RelayerService } from "./relayer-service.js";

function hashPayload(payload: MintItemPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class MintItemService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly managedActionService: ManagedActionService;
  readonly relayerService: RelayerService;
  readonly pendingActionService: PendingActionService;
  readonly assetDeliveryService: AssetDeliveryService;

  constructor({
    store,
    ledgerService,
    managedActionService,
    relayerService,
    pendingActionService,
    assetDeliveryService
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    managedActionService: ManagedActionService;
    relayerService: RelayerService;
    pendingActionService: PendingActionService;
    assetDeliveryService: AssetDeliveryService;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.managedActionService = managedActionService;
    this.relayerService = relayerService;
    this.pendingActionService = pendingActionService;
    this.assetDeliveryService = assetDeliveryService;
  }

  async execute({ appId, walletPrincipal, payload, idempotencyKey }: ExecuteMintItemRequest): Promise<MintItemExecutionResult> {
    const cacheScope = `mint:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`;
    const cached = this.store.getIdempotent<MintItemExecutionResult>(
      cacheScope,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }
    const actionType = this.store.getActionType(appId, "mint_item");
    if (!actionType) {
      throw new AppError(404, "action type not configured");
    }
    if (actionType.executionMode !== "managed") {
      throw new AppError(422, "mint_item is not configured as a managed action");
    }

    const pendingAction = this.pendingActionService.createPendingAction({
      appId,
      walletPrincipal,
      actionType: actionType.actionType,
      cost: actionType.cost,
      payloadHash: hashPayload(payload),
      idempotencyKey
    });

    try {
      const managedAction = this.managedActionService.buildMintItemTransaction({
        pendingActionId: pendingAction.id,
        appId,
        walletPrincipal,
        cost: actionType.cost,
        payload
      });
      this.verifyManagedAction({ pendingAction, payload, managedAction });
      pendingAction.status = "approved";
      this.store.savePendingAction(pendingAction);

      const transaction = this.store.createTransaction({
        txId: randomUUID(),
        pendingActionId: pendingAction.id,
        appId,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        providerTxId: "",
        rawTx: "",
        status: "submitted",
        summary: managedAction.summary,
        createdAt: new Date().toISOString()
      });

      const submission = await this.relayerService.submitTransaction(managedAction.preparedTransaction);
      transaction.providerTxId = submission.providerTxId;
      transaction.rawTx = submission.signedTx;
      transaction.explorerUrl = submission.explorerUrl;
      transaction.status = submission.status;
      this.store.saveTransaction(transaction);

      pendingAction.status = "submitted";
      this.store.savePendingAction(pendingAction);

      if (submission.status === "failed") {
        pendingAction.status = "failed";
        this.store.savePendingAction(pendingAction);
        this.ledgerService.releaseCredits({
          walletPrincipal,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-failed`,
          pendingActionId: pendingAction.id
        });
        throw new AppError(502, "transaction failed after submission", {
          pendingActionId: pendingAction.id,
          transactionId: transaction.txId,
          providerTxId: submission.providerTxId,
          status: "failed",
          explorerUrl: submission.explorerUrl
        });
      }

      pendingAction.status = "success";
      this.store.savePendingAction(pendingAction);

      this.ledgerService.captureCredits({
        walletPrincipal,
        appId,
        amount: actionType.cost,
        idempotencyKey: `pending:${pendingAction.id}:capture`,
        pendingActionId: pendingAction.id
      });

      const delivery = this.assetDeliveryService.createDeliveryRecord({
        appId,
        walletPrincipal,
        itemDefId: managedAction.summary.itemDefId,
        transactionId: transaction.txId,
        idempotencyKey: `pending:${pendingAction.id}:delivery`
      });

      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        eventType: "mint_item",
        value: actionType.cost,
        metadata: { pendingActionId: pendingAction.id, transactionId: transaction.txId },
        createdAt: new Date().toISOString()
      });

      const result: MintItemExecutionResult = {
        pendingActionId: pendingAction.id,
        transactionId: transaction.txId,
        deliveryId: delivery.deliveryId,
        status: transaction.status
      };
      this.store.setIdempotent(cacheScope, idempotencyKey, result);
      return result;
    } catch (error) {
      const latest = this.store.getPendingAction(pendingAction.id);
      if (!latest) {
        this.ledgerService.releaseCredits({
          walletPrincipal,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-missing`,
          pendingActionId: pendingAction.id
        });
      } else if (latest.status === "reserved" || latest.status === "approved" || latest.status === "submitted") {
        latest.status = "failed";
        this.store.savePendingAction(latest);
        this.ledgerService.releaseCredits({
          walletPrincipal,
          appId,
          amount: actionType.cost,
          idempotencyKey: `pending:${pendingAction.id}:release-error`,
          pendingActionId: pendingAction.id
        });
      }
      throw error;
    }
  }

  private verifyManagedAction({
    pendingAction,
    payload,
    managedAction
  }: {
    pendingAction: PendingAction;
    payload: MintItemPayload;
    managedAction: ManagedMintItemResult;
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

    const allowedActionType = this.store.getActionType(storedPendingAction.appId, managedAction.summary.actionType);
    if (!allowedActionType) {
      throw new AppError(422, "managed action summary action type not allowed");
    }

    const balance = this.store.getBalance(
      {
        walletAddress: storedPendingAction.walletAddress,
        chainId: storedPendingAction.chainId
      },
      storedPendingAction.appId
    );
    if (balance.reserved < storedPendingAction.cost) {
      throw new AppError(422, "reserved credits mismatch");
    }

    if (!managedAction.preparedTransaction) {
      throw new AppError(422, "managed action response missing prepared transaction");
    }
    if (!this.isSanePreparedTransaction(managedAction.preparedTransaction, storedPendingAction.appId)) {
      throw new AppError(422, "managed action prepared transaction failed basic sanity checks");
    }
    if (managedAction.summary.actionType !== storedPendingAction.actionType) {
      throw new AppError(422, "managed action summary action type mismatch");
    }
    if (managedAction.summary.debit !== storedPendingAction.cost) {
      throw new AppError(422, "managed action summary debit mismatch");
    }
    if (managedAction.summary.itemDefId !== payload.itemDefId) {
      throw new AppError(422, "managed action summary itemDefId mismatch");
    }
  }

  private isSanePreparedTransaction(
    preparedTransaction: ManagedMintItemResult["preparedTransaction"],
    appId: string
  ): boolean {
    if (!preparedTransaction || preparedTransaction.appId !== appId) {
      return false;
    }
    try {
      return preparedTransaction.transaction.instructions.length > 0;
    } catch {
      return false;
    }
  }
}
