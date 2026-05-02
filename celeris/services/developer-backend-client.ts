import { AppError } from "./errors.js";
import type { MemoryStore, MintItemApprovalRequest, MintItemApprovalResponse } from "../types.js";

export class DeveloperBackendClient {
  readonly store: MemoryStore;
  readonly fetchImpl: typeof fetch;

  constructor({ store, fetchImpl = fetch }: { store: MemoryStore; fetchImpl?: typeof fetch }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
  }

  async approveMintItem(request: MintItemApprovalRequest): Promise<MintItemApprovalResponse> {
    const app = this.store.apps.get(request.appId);
    if (!app) {
      throw new AppError(404, "app not found");
    }
    void request;
    void app;
    void this.fetchImpl;
    throw new AppError(409, "developer webhook mode is no longer configured on apps");
  }
}
