import { randomUUID } from "node:crypto";
import type { ExecutionResult } from "../types.js";

export class MockTransactionExecutor {
  async submit(): Promise<ExecutionResult> {
    return {
      providerTxId: `mock_tx_${randomUUID()}`,
      status: "success"
    };
  }
}
