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
  createHelloCelerisSayHelloInstruction,
  normalizeHelloCelerisUsername
} from "../solana/hello-celeris.js";

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
    appId,
    walletPrincipal,
    cost,
    payload,
    registeredProgram,
    sponsorWallet
  }: ManagedSayHelloRequest): ManagedSayHelloResult {
    const normalizedPayload = this.validateAndNormalizeSayHelloPayload(payload);
    const programId = registeredProgram.programId;
    const statePda = registeredProgram.statePda;
    const sponsorWalletPublicKey = sponsorWallet.publicKey;

    if (!programId || !statePda || !sponsorWalletPublicKey) {
      throw new AppError(422, "legacy Solana say_hello execution is unavailable for Sui app registration");
    }

    const { instruction, message, username } = createHelloCelerisSayHelloInstruction({
      appId,
      programId,
      sponsorWalletPublicKey,
      playerWallet: walletPrincipal.walletAddress,
      username: normalizedPayload.username
    });

    return {
      preparedTransaction: {
        appId,
        sponsorWalletPublicKey,
        transaction: new Transaction().add(instruction),
        debugMetadata: {
          programId,
          statePda,
          playerWalletAddress: walletPrincipal.walletAddress,
          username
        }
      },
      summary: {
        actionType: "say_hello",
        debit: cost,
        username,
        message,
        sponsorWalletPublicKey,
        playerWalletAddress: walletPrincipal.walletAddress,
        providerTxId: "",
        explorerUrl: "",
        status: "submitted",
        submittedAt: "",
        confirmedAt: null
      }
    };
  }

  validateAndNormalizeSayHelloPayload(payload: unknown): SayHelloPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AppError(400, "payload must be an object");
    }

    const parsedPayload = payload as Record<string, unknown>;
    const keys = Object.keys(parsedPayload);
    if (keys.length !== 1 || keys[0] !== "username") {
      if ("walletAddress" in parsedPayload || "playerWallet" in parsedPayload) {
        throw new AppError(400, "caller-supplied wallet identity is not allowed");
      }
      if ("message" in parsedPayload) {
        throw new AppError(400, "caller-supplied message text is not allowed");
      }
      throw new AppError(400, "payload must only contain username");
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
