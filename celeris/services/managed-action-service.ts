import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type {
  ExecuteClaimRewardsRequest,
  ManagedSayHelloRequest,
  ManagedSayHelloResult,
  ManagedMintItemRequest,
  ManagedMintItemResult,
  MintItemPayload,
  SayHelloPayload
} from "../types.js";
import { AppError } from "./errors.js";
import {
  assertHelloCelerisSayHelloTransactionKindMatches,
  buildHelloCelerisSayHelloTransaction,
  normalizeHelloCelerisUsername
} from "../sui/hello-celeris.js";

export class ManagedActionService {
  buildMintItemTransaction({
    pendingActionId,
    appId,
    walletPrincipal,
    cost,
    payload
  }: ManagedMintItemRequest): ManagedMintItemResult {
    this.validateMintItemPayload(payload);

    return {
      preparedTransaction: {
        appId,
        transaction: new Transaction().add(
          new TransactionInstruction({
            programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            keys: [],
            data: Buffer.from(
              JSON.stringify({
                kind: "managed_mint_item",
                pendingActionId,
                appId,
                walletAddress: walletPrincipal.walletAddress,
                chainId: walletPrincipal.chainId,
                itemDefId: payload.itemDefId,
                debit: cost
              }),
              "utf8"
            )
          })
        ),
        debugMetadata: {
          pendingActionId,
          walletAddress: walletPrincipal.walletAddress,
          chainId: walletPrincipal.chainId,
          itemDefId: payload.itemDefId
        }
      },
      summary: {
        actionType: "mint_item",
        itemDefId: payload.itemDefId,
        debit: cost
      }
    };
  }

  validateClaimRewardsRequest({ actionId }: Pick<ExecuteClaimRewardsRequest, "actionId">) {
    if (actionId !== "claim_rewards" && actionId !== "first_time_claim") {
      throw new AppError(400, "unsupported claim rewards action id");
    }
  }

  buildSayHelloTransaction({
    payload,
    registeredProgram
  }: ManagedSayHelloRequest): ManagedSayHelloResult {
    const normalizedPayload = this.validateAndNormalizeSayHelloPayload(payload);
    const { transactionKind, message, normalizedUsername } = buildHelloCelerisSayHelloTransaction({
      packageId: registeredProgram.packageId,
      appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
      appStateObjectId: registeredProgram.appStateObjectId,
      username: normalizedPayload.username
    });

    return {
      canonicalTransaction: transactionKind,
      message,
      normalizedUsername
    };
  }

  assertCanonicalSayHelloTransactionKind({
    providedTransactionKind,
    registeredProgram,
    username
  }: {
    providedTransactionKind: unknown;
    registeredProgram: ManagedSayHelloRequest["registeredProgram"];
    username: string;
  }) {
    try {
      assertHelloCelerisSayHelloTransactionKindMatches(
        {
          getData: () => providedTransactionKind
        } as { getData(): unknown } as never,
        {
          packageId: registeredProgram.packageId,
          appAuthorityCapObjectId: registeredProgram.authorityCapObjectId,
          appStateObjectId: registeredProgram.appStateObjectId,
          username
        }
      );
    } catch (error) {
      throw new AppError(
        422,
        error instanceof Error ? error.message : "provided TransactionKind does not match canonical say_hello shape"
      );
    }
  }

  validateAndNormalizeSayHelloPayload(payload: unknown): SayHelloPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AppError(400, "payload must be an object");
    }

    const parsedPayload = payload as Record<string, unknown>;
    const keys = Object.keys(parsedPayload);
    const allowedKeys = new Set(["username", "transactionKind"]);
    if (keys.some((key) => !allowedKeys.has(key)) || !("username" in parsedPayload)) {
      if ("walletAddress" in parsedPayload || "playerWallet" in parsedPayload) {
        throw new AppError(400, "caller-supplied wallet identity is not allowed");
      }
      if ("message" in parsedPayload) {
        throw new AppError(400, "caller-supplied message text is not allowed");
      }
      throw new AppError(400, "payload must only contain username and transactionKind");
    }

    if (typeof parsedPayload.username !== "string") {
      throw new AppError(400, "username is required");
    }

    try {
      return {
        username: normalizeHelloCelerisUsername(parsedPayload.username)
      };
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : "invalid username");
    }
  }

  private validateMintItemPayload(payload: MintItemPayload) {
    if (!payload || typeof payload.itemDefId !== "string" || !payload.itemDefId.trim()) {
      throw new AppError(400, "itemDefId is required");
    }
  }
}
