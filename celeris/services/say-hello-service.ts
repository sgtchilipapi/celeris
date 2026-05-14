import { createHash, randomUUID } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { AppError } from "./errors.js";
import type {
  CompleteSayHelloRequest,
  ExecuteSayHelloRequest,
  MemoryStore,
  PendingAction,
  SayHelloCompletionResult,
  SayHelloExecutionResult,
  SayHelloTransactionSummary,
  SponsorGasReservation,
  TransactionRecord
} from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { ManagedActionService } from "./managed-action-service.js";
import { PendingActionService } from "./pending-action-service.js";
import type { SuiGateway } from "../types.js";
import {
  HELLO_CELERIS_CLOCK_OBJECT_ID,
  HELLO_CELERIS_MODULE_NAME,
  HELLO_CELERIS_SAY_HELLO_FUNCTION
} from "../sui/hello-celeris.js";

function hashPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class SayHelloService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly managedActionService: ManagedActionService;
  readonly pendingActionService: PendingActionService;
  readonly suiGateway: SuiGateway;
  readonly gasBudget = "5000000";

  constructor({
    store,
    ledgerService,
    managedActionService,
    pendingActionService,
    suiGateway
  }: {
    store: MemoryStore;
    ledgerService: CreditLedgerService;
    managedActionService: ManagedActionService;
    pendingActionService: PendingActionService;
    suiGateway: SuiGateway;
  }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.managedActionService = managedActionService;
    this.pendingActionService = pendingActionService;
    this.suiGateway = suiGateway;
  }

  async execute({ appId, walletPrincipal, payload, idempotencyKey }: ExecuteSayHelloRequest): Promise<SayHelloExecutionResult> {
    const cacheScope = `say-hello:prepare:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`;
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
    if (!("transactionKind" in payload)) {
      throw new AppError(400, "transactionKind is required");
    }

    const registeredProgram = this.store.getRegisteredProgram(appId);
    if (!registeredProgram) {
      throw new AppError(422, "registered program not found");
    }

    const sponsorWallet = this.store.getSponsorWallet(appId);
    if (!sponsorWallet) {
      throw new AppError(422, "sponsor wallet not provisioned");
    }

    const sponsorWalletSecret = this.store.getSponsorWalletSecret(appId);
    if (!sponsorWalletSecret || typeof sponsorWalletSecret.secretKey !== "string") {
      throw new AppError(422, "sponsor wallet secret not available");
    }

    this.managedActionService.assertCanonicalSayHelloTransactionKind({
      providedTransactionKind: payload.transactionKind,
      registeredProgram,
      username: normalizedPayload.username
    });

    const canonical = this.managedActionService.buildSayHelloTransaction({
      appId,
      payload: normalizedPayload,
      registeredProgram
    });

    const pendingAction = this.pendingActionService.createPendingAction({
      appId,
      walletPrincipal,
      actionType: actionType.actionType,
      cost: actionType.cost,
      payloadHash: hashPayload({
        username: canonical.normalizedUsername,
        transactionKind: payload.transactionKind
      }),
      idempotencyKey
    });

    try {
      const sponsorGasCoin = await this.selectSponsorGasCoin(appId);
      const authorityRef = await this.suiGateway.getObjectReference(registeredProgram.authorityCapObjectId);
      const appStateRef = await this.suiGateway.getObjectReference(registeredProgram.appStateObjectId);
      const clockRef = await this.suiGateway.getObjectReference(HELLO_CELERIS_CLOCK_OBJECT_ID);
      const transaction = new Transaction();
      transaction.moveCall({
        target: `${registeredProgram.packageId}::${HELLO_CELERIS_MODULE_NAME}::${HELLO_CELERIS_SAY_HELLO_FUNCTION}`,
        arguments: [
          authorityRef.initialSharedVersion
            ? transaction.sharedObjectRef({
                objectId: authorityRef.objectId,
                initialSharedVersion: authorityRef.initialSharedVersion,
                mutable: true
              })
            : transaction.objectRef(authorityRef),
          appStateRef.initialSharedVersion
            ? transaction.sharedObjectRef({
                objectId: appStateRef.objectId,
                initialSharedVersion: appStateRef.initialSharedVersion,
                mutable: true
              })
            : transaction.objectRef(appStateRef),
          clockRef.initialSharedVersion
            ? transaction.sharedObjectRef({
                objectId: clockRef.objectId,
                initialSharedVersion: clockRef.initialSharedVersion,
                mutable: false
              })
            : transaction.objectRef(clockRef),
          transaction.pure.string(canonical.normalizedUsername)
        ]
      });
      const currentEpoch = await this.suiGateway.getCurrentEpoch();
      transaction.setSender(walletPrincipal.walletAddress);
      transaction.setGasOwner(sponsorWallet.address);
      transaction.setGasPayment([sponsorGasCoin]);
      transaction.setGasPrice(await this.suiGateway.getReferenceGasPrice());
      transaction.setGasBudget(this.gasBudget);
      transaction.setExpiration({
        Epoch: String(BigInt(currentEpoch) + 1n)
      });
      const builtBytes = await transaction.build();

      const sponsorKeypair = Ed25519Keypair.fromSecretKey(sponsorWalletSecret.secretKey);
      const sponsorSigned = await sponsorKeypair.signTransaction(builtBytes);
      const reservation = this.store.saveSponsorGasReservation({
        reservationId: pendingAction.id,
        appId,
        pendingActionId: pendingAction.id,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        debit: actionType.cost,
        username: canonical.normalizedUsername,
        message: canonical.message,
        sponsorAddress: sponsorWallet.address,
        gasObjectId: sponsorGasCoin.objectId,
        gasObjectVersion: sponsorGasCoin.version,
        gasObjectDigest: sponsorGasCoin.digest,
        transactionBytes: sponsorSigned.bytes,
        sponsorSignature: sponsorSigned.signature,
        status: "reserved",
        expiresAt: pendingAction.expiresAt,
        submittedDigest: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      pendingAction.status = "approved";
      this.store.savePendingAction(pendingAction);

      const result: SayHelloExecutionResult = {
        reservationId: reservation.reservationId,
        transactionBytes: reservation.transactionBytes,
        sponsorSignature: reservation.sponsorSignature,
        sponsorAddress: reservation.sponsorAddress,
        expiresAt: reservation.expiresAt,
        username: reservation.username,
        message: reservation.message
      };
      this.store.setIdempotent(cacheScope, idempotencyKey, result);
      return result;
    } catch (error) {
      this.failPendingAction(pendingAction, "pending:release-prepare");
      throw error;
    }
  }

  async complete({
    appId,
    walletPrincipal,
    reservationId,
    outcome,
    digest,
    idempotencyKey
  }: CompleteSayHelloRequest): Promise<SayHelloCompletionResult> {
    const cacheScope = `say-hello:complete:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`;
    const cached = this.store.getIdempotent<SayHelloCompletionResult>(cacheScope, idempotencyKey);
    if (cached) {
      return cached;
    }

    const pendingAction = this.store.getPendingAction(reservationId);
    if (!pendingAction || pendingAction.appId !== appId) {
      throw new AppError(404, "reservation not found");
    }
    if (
      pendingAction.walletAddress !== walletPrincipal.walletAddress ||
      pendingAction.chainId !== walletPrincipal.chainId
    ) {
      throw new AppError(403, "reservation does not belong to the authenticated player");
    }

    const reservation = this.store.getSponsorGasReservation(reservationId);
    if (!reservation) {
      throw new AppError(404, "sponsor gas reservation not found");
    }
    if (outcome === "submitted" && (!digest || typeof digest !== "string")) {
      throw new AppError(400, "digest is required when outcome is submitted");
    }

    const result =
      outcome === "failed"
        ? this.completeFailedReservation(appId, pendingAction, reservation)
        : await this.completeSubmittedReservation(appId, pendingAction, reservation, digest!);
    this.store.setIdempotent(cacheScope, idempotencyKey, result);
    return result;
  }

  private async completeSubmittedReservation(
    appId: string,
    pendingAction: PendingAction,
    reservation: SponsorGasReservation,
    digest: string
  ): Promise<SayHelloCompletionResult> {
    const verification = await this.suiGateway.verifySubmittedDigest({
      digest,
      expectedSender: pendingAction.walletAddress,
      expectedSponsorAddress: reservation.sponsorAddress
    });

    reservation.status = verification.status === "submitted" ? "submitted" : "released";
    reservation.submittedDigest = verification.digest;
    this.store.saveSponsorGasReservation(reservation);

    const transaction = this.upsertTransaction({
      appId,
      pendingAction,
      reservation,
      digest: verification.digest,
      explorerUrl: verification.explorerUrl,
      status: verification.status,
      confirmedAt: verification.confirmedAt
    });

    if (verification.status === "success") {
      pendingAction.status = "success";
      this.store.savePendingAction(pendingAction);
      this.ledgerService.captureCredits({
        walletPrincipal: {
          walletAddress: pendingAction.walletAddress,
          chainId: pendingAction.chainId
        },
        appId,
        amount: reservation.debit,
        idempotencyKey: `pending:${pendingAction.id}:capture`,
        pendingActionId: pendingAction.id,
        metadata: { actionType: "say_hello", username: reservation.username }
      });
      this.store.recordUsageEvent({
        eventId: randomUUID(),
        appId,
        walletAddress: pendingAction.walletAddress,
        chainId: pendingAction.chainId,
        eventType: "say_hello",
        value: reservation.debit,
        metadata: {
          pendingActionId: pendingAction.id,
          transactionId: transaction.txId,
          username: reservation.username,
          digest: verification.digest
        },
        createdAt: new Date().toISOString()
      });
    } else if (verification.status === "failed") {
      pendingAction.status = "failed";
      this.store.savePendingAction(pendingAction);
      this.ledgerService.releaseCredits({
        walletPrincipal: {
          walletAddress: pendingAction.walletAddress,
          chainId: pendingAction.chainId
        },
        appId,
        amount: reservation.debit,
        idempotencyKey: `pending:${pendingAction.id}:release-onchain-failed`,
        pendingActionId: pendingAction.id,
        metadata: { actionType: "say_hello", username: reservation.username, digest: verification.digest }
      });
    } else {
      pendingAction.status = "submitted";
      this.store.savePendingAction(pendingAction);
    }

    return {
      reservationId: reservation.reservationId,
      transactionId: transaction.txId,
      digest: verification.digest,
      explorerUrl: verification.explorerUrl,
      status: verification.status
    };
  }

  private completeFailedReservation(
    appId: string,
    pendingAction: PendingAction,
    reservation: SponsorGasReservation
  ): SayHelloCompletionResult {
    reservation.status = "released";
    this.store.saveSponsorGasReservation(reservation);
    pendingAction.status = "failed";
    this.store.savePendingAction(pendingAction);
    this.ledgerService.releaseCredits({
      walletPrincipal: {
        walletAddress: pendingAction.walletAddress,
        chainId: pendingAction.chainId
      },
      appId,
      amount: reservation.debit,
      idempotencyKey: `pending:${pendingAction.id}:release-client-failed`,
      pendingActionId: pendingAction.id,
      metadata: { actionType: "say_hello", username: reservation.username }
    });

    const transaction = this.upsertTransaction({
      appId,
      pendingAction,
      reservation,
      digest: null,
      explorerUrl: null,
      status: "failed",
      confirmedAt: null
    });

    return {
      reservationId: reservation.reservationId,
      transactionId: transaction.txId,
      digest: null,
      explorerUrl: null,
      status: "failed"
    };
  }

  private upsertTransaction({
    appId,
    pendingAction,
    reservation,
    digest,
    explorerUrl,
    status,
    confirmedAt
  }: {
    appId: string;
    pendingAction: PendingAction;
    reservation: SponsorGasReservation;
    digest: string | null;
    explorerUrl: string | null;
    status: "submitted" | "success" | "failed";
    confirmedAt: string | null;
  }): TransactionRecord {
    const existing = [...this.store.transactions.values()].find((candidate) => candidate.pendingActionId === pendingAction.id);
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    const summary: SayHelloTransactionSummary = {
      actionType: "say_hello",
      debit: reservation.debit,
      username: reservation.username,
      message: reservation.message,
      sponsorAddress: reservation.sponsorAddress,
      playerWalletAddress: pendingAction.walletAddress,
      digest,
      explorerUrl: explorerUrl ?? "",
      reservationId: reservation.reservationId,
      status,
      submittedAt: createdAt,
      confirmedAt
    };

    const record: TransactionRecord = {
      txId: existing?.txId ?? randomUUID(),
      pendingActionId: pendingAction.id,
      appId,
      walletAddress: pendingAction.walletAddress,
      chainId: pendingAction.chainId,
      providerTxId: digest ?? "",
      rawTx: reservation.transactionBytes,
      explorerUrl: explorerUrl ?? undefined,
      status,
      summary,
      createdAt,
      confirmedAt
    };

    return existing ? this.store.saveTransaction(record) : this.store.createTransaction(record);
  }

  private failPendingAction(pendingAction: PendingAction, reasonSuffix: string) {
    const latest = this.store.getPendingAction(pendingAction.id);
    if (!latest) {
      return;
    }
    if (!["reserved", "approved", "submitted"].includes(latest.status)) {
      return;
    }
    latest.status = "failed";
    this.store.savePendingAction(latest);
    this.ledgerService.releaseCredits({
      walletPrincipal: {
        walletAddress: latest.walletAddress,
        chainId: latest.chainId
      },
      appId: latest.appId,
      amount: latest.cost,
      idempotencyKey: `${reasonSuffix}:${latest.id}`,
      pendingActionId: latest.id
    });
  }

  private async selectSponsorGasCoin(appId: string) {
    const sponsorWallet = this.store.getSponsorWallet(appId);
    if (!sponsorWallet) {
      throw new AppError(422, "sponsor wallet not provisioned");
    }
    const allCoins = await this.suiGateway.listSponsorGasCoins(sponsorWallet.address);
    const locked = new Set(
      [...this.store.sponsorGasReservations.values()]
        .filter((reservation) => reservation.appId === appId && reservation.status !== "released")
        .map((reservation) => reservation.gasObjectId)
    );
    const available = allCoins.find((coin) => !locked.has(coin.objectId));
    if (!available) {
      throw new AppError(409, "no sponsor gas object available");
    }
    return available;
  }
}
