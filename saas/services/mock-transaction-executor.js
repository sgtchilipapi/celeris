import { randomUUID } from "node:crypto";

export class MockTransactionExecutor {
  async submit() {
    return {
      providerTxId: `mock_tx_${randomUUID()}`,
      status: "success"
    };
  }
}
