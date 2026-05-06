import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  ExecuteSayHelloRequest,
  ManagedSayHelloResult,
  MemoryStore,
  PendingAction,
  SayHelloTransactionSummary,
  SayHelloExecutionResult
} from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { ManagedActionService } from "./managed-action-service.js";
import { PendingActionService } from "./pending-action-service.js";
import { RelayerService } from "./relayer-service.js";
import { parseSolanaProgramId } from "../solana/hello-celeris.js";

function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class SayHelloService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly managedActionService: ManagedActionService;
  readonly relayerService: RelayerService;
  readonly pendingActionService: PendingActionService;

  constructor({
    store,
    ledgerService,
    managedActionService,
    relayerService,
    pendingActionService
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    managedActionService: ManagedActionService;
    relayerService: RelayerService;
    pendingActionService: PendingActionService;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.managedActionService = managedActionService;
    this.relayerService = relayerService;
    this.pendingActionService = pendingActionService;
  }

  async execute({ appId, walletPrincipal, payload, idempotencyKey }: ExecuteSayHelloRequest): Promise<SayHelloExecutionResult> {
    const cacheScope = `say-hello:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`;
    const cached = this.store.getIdempotent<SayHelloExecutionResult>(cacheScope, idempotencyKey);
    if (cached) {
      return cached;
    }

    const actionType = this.store.getActionType(appId, "say_hello");
    if (!actionType) {
      throw new AppError(404, "say_hello action not configured");
    }
    if (actionType.executionMode !== "managed") {
      throw new AppError(422, "say_hello is not configured as a managed action");
    }
    const normalizedPayload = this.managedActionService.validateAndNormalizeSayHelloPayload(payload);

    const registeredProgram = this.store.getRegisteredProgram(appId);
    if (!registeredProgram) {
      throw new AppError(422, "registered program not found");
    }

    const sponsorWallet = this.store.getSponsorWallet(appId);
    if (!sponsorWallet) {
      throw new AppError(422, "sponsor wallet not provisioned");
    }

    try {
      parseSolanaProgramId(walletPrincipal.walletAddress);
    } catch {
      throw new AppError(422, "player wallet is not a valid Solana address");
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
      const managedAction = this.managedActionService.buildSayHelloTransaction({
        pendingActionId: pendingAction.id,
        appId,
        walletPrincipal,
        cost: actionType.cost,
        payload: normalizedPayload,
        registeredProgram,
        sponsorWallet
      });
      this.verifyManagedAction({ pendingAction, managedAction });
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
        explorerUrl: "",
        status: "submitted",
        summary: managedAction.summary,
        createdAt: new Date().toISOString(),
        confirmedAt: null
      });
      const summary = transaction.summary as SayHelloTransactionSummary;

      const submission = await this.relayerService.submitTransaction(managedAction.preparedTransaction);
      transaction.providerTxId = submission.providerTxId;
      transaction.rawTx = submission.signedTx;
      transaction.explorerUrl = submission.explorerUrl;
      transaction.status = submission.status;
      transaction.confirmedAt = new Date().toISOString();
      summary.providerTxId = submission.providerTxId;
      summary.explorerUrl = submission.explorerUrl;
      summary.status = submission.status;
      summary.submittedAt = transaction.createdAt;
      summary.confirmedAt = transaction.confirmedAt;
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
          pendingActionId: pendingAction.id,
          metadata: { actionType: "say_hello", username: summary.username }
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
        pendingActionId: pendingAction.id,
        metadata: { actionType: "say_hello", username: summary.username }
      });

      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        eventType: "say_hello",
        value: actionType.cost,
        metadata: {
          pendingActionId: pendingAction.id,
          transactionId: transaction.txId,
          username: summary.username
        },
        createdAt: new Date().toISOString()
      });

      const result: SayHelloExecutionResult = {
        pendingActionId: pendingAction.id,
        transactionId: transaction.txId,
        providerTxId: transaction.providerTxId,
        explorerUrl: transaction.explorerUrl ?? "",
        username: summary.username,
        message: summary.message,
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
    managedAction
  }: {
    pendingAction: PendingAction;
    managedAction: ManagedSayHelloResult;
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
    if (managedAction.summary.actionType !== "say_hello") {
      throw new AppError(422, "managed action summary action type mismatch");
    }
    if (managedAction.summary.debit !== storedPendingAction.cost) {
      throw new AppError(422, "managed action summary debit mismatch");
    }
    if (managedAction.summary.playerWalletAddress !== storedPendingAction.walletAddress) {
      throw new AppError(422, "managed action summary player wallet mismatch");
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
    if (!managedAction.preparedTransaction || managedAction.preparedTransaction.appId !== storedPendingAction.appId) {
      throw new AppError(422, "managed action prepared transaction failed basic sanity checks");
    }
    if (managedAction.preparedTransaction.transaction.instructions.length === 0) {
      throw new AppError(422, "managed action prepared transaction failed basic sanity checks");
    }
  }
}
