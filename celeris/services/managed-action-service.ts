import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type {
  ExecuteClaimRewardsRequest,
  ManagedMintItemRequest,
  ManagedMintItemResult,
  MintItemPayload
} from "../types.js";
import { AppError } from "./errors.js";

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

  private validateMintItemPayload(payload: MintItemPayload) {
    if (!payload || typeof payload.itemDefId !== "string" || !payload.itemDefId.trim()) {
      throw new AppError(400, "itemDefId is required");
    }
  }
}
