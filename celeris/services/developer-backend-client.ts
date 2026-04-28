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
    if (!app.developerWebhookUrl) {
      throw new AppError(409, "developer webhook not configured");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(app.developerWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${app.apiKey}`
        },
        body: JSON.stringify(request)
      });
    } catch (error) {
      throw new AppError(502, "developer webhook request failed", {
        cause: error instanceof Error ? error.message : "unknown error"
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(502, "developer webhook returned invalid json");
    }

    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `developer webhook returned ${response.status}`;
      throw new AppError(502, message);
    }

    return payload as MintItemApprovalResponse;
  }
}
