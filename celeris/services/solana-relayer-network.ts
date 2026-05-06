import { Connection, PublicKey } from "@solana/web3.js";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

export class SolanaRelayerNetwork implements RelayerNetworkClient {
  readonly connection: Connection;

  constructor({
    rpcOrigin
  }: {
    rpcOrigin: string;
  }) {
    this.connection = new Connection(rpcOrigin, "confirmed");
  }

  async getBalance(walletAddress: string): Promise<number> {
    return await this.connection.getBalance(new PublicKey(walletAddress), "confirmed");
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return await this.connection.getLatestBlockhash("confirmed");
  }

  async getFeeForTransaction(transaction: import("@solana/web3.js").Transaction): Promise<number | null> {
    return (await this.connection.getFeeForMessage(transaction.compileMessage(), "confirmed")).value;
  }

  async sendTransaction(signedTx: string): Promise<{ txHash: string }> {
    const txHash = await this.connection.sendRawTransaction(Buffer.from(signedTx, "base64"), {
      preflightCommitment: "confirmed"
    });
    return { txHash };
  }

  async confirmTransaction({
    txHash,
    blockhash,
    lastValidBlockHeight
  }: {
    txHash: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }): Promise<Exclude<TransactionStatus, "submitted">> {
    const confirmation = await this.connection.confirmTransaction(
      {
        signature: txHash,
        blockhash,
        lastValidBlockHeight
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      return "failed";
    }

    return "success";
  }
}
