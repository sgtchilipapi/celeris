import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import type { RelayerNetworkClient, RelayerSubmissionResult, TransactionStatus } from "../types.js";

export class RelayerService {
  readonly networkClient: RelayerNetworkClient;
  readonly signerKey: string;

  constructor({
    networkClient,
    signerKey = "relayer_dev_key"
  }: {
    networkClient: RelayerNetworkClient;
    signerKey?: string;
  }) {
    this.networkClient = networkClient;
    this.signerKey = signerKey;
  }

  async submitTransaction(unsignedTx: string): Promise<RelayerSubmissionResult> {
    const signedTx = this.signTransaction(unsignedTx);
    let attempts = 0;
    let lastError: unknown;

    while (attempts < 2) {
      attempts += 1;
      try {
        const submission = await this.networkClient.sendTransaction(signedTx);
        return {
          providerTxId: submission.txHash,
          status: "submitted",
          signedTx,
          attempts
        };
      } catch (error) {
        lastError = error;
        if (attempts >= 2 || !this.isRetryableNetworkError(error)) {
          throw new AppError(502, "transaction submission failed", {
            attempts,
            cause: error instanceof Error ? error.message : "unknown network error"
          });
        }
      }
    }

    throw new AppError(502, "transaction submission failed", {
      attempts,
      cause: lastError instanceof Error ? lastError.message : "unknown network error"
    });
  }

  async resolveTransactionStatus(providerTxId: string): Promise<Exclude<TransactionStatus, "submitted">> {
    try {
      return await this.networkClient.getTransactionStatus(providerTxId);
    } catch (error) {
      throw new AppError(502, "transaction status check failed", {
        cause: error instanceof Error ? error.message : "unknown network error"
      });
    }
  }

  private signTransaction(unsignedTx: string): string {
    const signature = createHash("sha256").update(`${unsignedTx}:${this.signerKey}`).digest("hex");
    return Buffer.from(JSON.stringify({ unsignedTx, signature })).toString("base64");
  }

  private isRetryableNetworkError(error: unknown): boolean {
    return !!error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true;
  }
}
