import { randomUUID } from "node:crypto";
import type { RelayerNetworkClient, TransactionStatus } from "../types.js";

export class MockRelayerNetwork implements RelayerNetworkClient {
  async sendTransaction(_signedTx: string): Promise<{ txHash: string }> {
    return { txHash: `mock_chain_${randomUUID()}` };
  }

  async getTransactionStatus(_txHash: string): Promise<Exclude<TransactionStatus, "submitted">> {
    return "success";
  }
}
