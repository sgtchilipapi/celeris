import { randomUUID } from "node:crypto";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

export class MockRelayerNetwork implements RelayerNetworkClient {
  readonly balanceLamports: number;
  readonly feeLamports: number | null;
  readonly sendTransactionOverride?: (signedTx: string) => Promise<{ txHash: string }>;
  readonly confirmTransactionOverride?: (input: {
    txHash: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }) => Promise<Exclude<TransactionStatus, "submitted">>;

  constructor({
    balanceLamports = 1_000_000,
    feeLamports = 5_000,
    sendTransaction,
    confirmTransaction
  }: {
    balanceLamports?: number;
    feeLamports?: number | null;
    sendTransaction?: (signedTx: string) => Promise<{ txHash: string }>;
    confirmTransaction?: (input: {
      txHash: string;
      blockhash: string;
      lastValidBlockHeight: number;
    }) => Promise<Exclude<TransactionStatus, "submitted">>;
  } = {}) {
    this.balanceLamports = balanceLamports;
    this.feeLamports = feeLamports;
    this.sendTransactionOverride = sendTransaction;
    this.confirmTransactionOverride = confirmTransaction;
  }

  async getBalance(_walletAddress: string): Promise<number> {
    return this.balanceLamports;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return {
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 123
    };
  }

  async getFeeForTransaction(): Promise<number | null> {
    return this.feeLamports;
  }

  async sendTransaction(signedTx: string): Promise<{ txHash: string }> {
    if (this.sendTransactionOverride) {
      return await this.sendTransactionOverride(signedTx);
    }
    return { txHash: `mock_chain_${randomUUID()}` };
  }

  async confirmTransaction(input: {
    txHash: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }): Promise<Exclude<TransactionStatus, "submitted">> {
    if (this.confirmTransactionOverride) {
      return await this.confirmTransactionOverride(input);
    }
    return "success";
  }
}
