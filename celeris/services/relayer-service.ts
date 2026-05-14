import { Transaction } from "@solana/web3.js";
import { AppError } from "./errors.js";
import { getSolanaExplorerTransactionUrl } from "../solana/explorer.js";
import { resolveAppSponsorWallet } from "../solana/sponsor-wallet.js";
import type { MemoryStore, PreparedSolanaTransaction, RelayerNetworkClient, RelayerSubmissionResult } from "../types.js";

export class RelayerService {
  readonly store: MemoryStore;
  readonly networkClient: RelayerNetworkClient;
  readonly safetyBufferLamports: number;

  constructor({
    networkClient,
    store,
    safetyBufferLamports = 100_000
  }: {
    networkClient: RelayerNetworkClient;
    store: MemoryStore;
    safetyBufferLamports?: number;
  }) {
    this.store = store;
    this.networkClient = networkClient;
    this.safetyBufferLamports = safetyBufferLamports;
  }

  async submitTransaction(preparedTransaction: PreparedSolanaTransaction): Promise<RelayerSubmissionResult> {
    let attempts = 0;
    let lastError: unknown;

    while (attempts < 2) {
      attempts += 1;
      try {
        const { sponsorWallet, keypair } = resolveAppSponsorWallet({
          store: this.store,
          appId: preparedTransaction.appId
        });
        const sponsorWalletPublicKey = sponsorWallet.publicKey;

        if (!sponsorWalletPublicKey) {
          throw new AppError(422, "legacy Solana relayer is unavailable for Sui sponsor wallets");
        }

        if (
          preparedTransaction.sponsorWalletPublicKey &&
          preparedTransaction.sponsorWalletPublicKey !== sponsorWalletPublicKey
        ) {
          throw new AppError(422, "prepared transaction sponsor wallet mismatch");
        }

        const tx = this.cloneTransaction(preparedTransaction.transaction);
        tx.feePayer = keypair.publicKey;

        const { blockhash, lastValidBlockHeight } = await this.networkClient.getLatestBlockhash();
        tx.recentBlockhash = blockhash;

        const estimatedFeeLamports = await this.networkClient.getFeeForTransaction(tx);
        if (estimatedFeeLamports === null) {
          throw new AppError(502, "unable to estimate Solana transaction fee");
        }

        const sponsorBalanceLamports = await this.networkClient.getBalance(sponsorWalletPublicKey);
        const requiredLamports = estimatedFeeLamports + this.safetyBufferLamports;
        if (sponsorBalanceLamports < requiredLamports) {
          throw new AppError(422, "sponsor wallet has insufficient SOL", {
            sponsorWalletPublicKey,
            balanceLamports: sponsorBalanceLamports,
            estimatedFeeLamports,
            safetyBufferLamports: this.safetyBufferLamports,
            requiredLamports
          });
        }

        tx.sign(keypair);
        const signedTx = tx.serialize().toString("base64");
        const submission = await this.networkClient.sendTransaction(signedTx);
        const status = await this.networkClient.confirmTransaction({
          txHash: submission.txHash,
          blockhash,
          lastValidBlockHeight
        });

        return {
          providerTxId: submission.txHash,
          status,
          signedTx,
          explorerUrl: getSolanaExplorerTransactionUrl(submission.txHash),
          attempts
        };
      } catch (error) {
        lastError = error;
        if (error instanceof AppError) {
          throw error;
        }
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

  private cloneTransaction(transaction: Transaction): Transaction {
    const next = new Transaction();
    for (const instruction of transaction.instructions) {
      next.add(instruction);
    }
    return next;
  }

  private isRetryableNetworkError(error: unknown): boolean {
    return !!error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true;
  }
}
