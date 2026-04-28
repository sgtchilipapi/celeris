import type { MintItemApprovalRequest, MintItemApprovalResponse } from "../types.js";

export class MockDeveloperClient {
  async approveMintItem(request: MintItemApprovalRequest): Promise<MintItemApprovalResponse> {
    return {
      status: "approved",
      tx: Buffer.from(
        JSON.stringify({
          pendingActionId: request.pendingActionId,
          appId: request.appId,
          userId: request.userId,
          itemDefId: request.payload.itemDefId
        })
      ).toString("base64"),
      summary: {
        actionType: "mint_item",
        itemDefId: request.payload.itemDefId,
        debit: request.cost
      }
    };
  }
}
