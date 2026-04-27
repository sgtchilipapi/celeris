import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { AppSetupDetails, ConfigureActionRequest, CreateAppRequest, CreateAppResponse, MemoryStore, StoredAppSetup } from "../types.js";

export class AppService {
  readonly store: MemoryStore;

  constructor({ store }: { store: MemoryStore }) {
    this.store = store;
  }

  createApp({
    developerId,
    name,
    priceCents,
    credits,
    webhookUrl = null,
    idempotencyKey
  }: CreateAppRequest): StoredAppSetup {
    const cached = this.store.getIdempotent<StoredAppSetup>(`app:${developerId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (!this.store.developers.has(developerId)) {
      throw new AppError(404, "developer not found");
    }
    const app = this.store.createApp({
      developerId,
      name,
      developerWebhookUrl: webhookUrl,
      apiKey: `app_${randomUUID()}`
    });
    const creditPackage = this.store.createCreditPackage({
      appId: app.appId,
      priceCents,
      credits
    });
    const result: StoredAppSetup = { ...app, defaultCreditPackage: creditPackage };
    this.store.setIdempotent(`app:${developerId}`, idempotencyKey, result);
    return result;
  }

  toCreateAppResponse(app: StoredAppSetup): CreateAppResponse {
    return {
      appId: app.appId,
      apiKey: app.apiKey
    };
  }

  getAppSetupDetails(appId: string): AppSetupDetails {
    const app = this.store.apps.get(appId);
    if (!app) {
      throw new AppError(404, "app not found");
    }
    return {
      appId: app.appId,
      apiKey: app.apiKey,
      webhookUrl: app.developerWebhookUrl,
      creditPackages: [...this.store.creditPackages.values()].filter((pkg) => pkg.appId === appId),
      actions: [...this.store.actionTypes.values()].filter((action) => action.appId === appId)
    };
  }

  configureAction({ appId, actionType, cost, idempotencyKey }: ConfigureActionRequest) {
    const cached = this.store.getIdempotent(`action:${appId}:${actionType}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (!this.store.apps.has(appId)) {
      throw new AppError(404, "app not found");
    }
    const action = this.store.upsertActionType({ appId, actionType, cost });
    this.store.setIdempotent(`action:${appId}:${actionType}`, idempotencyKey, action);
    return action;
  }
}
