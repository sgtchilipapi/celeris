import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

export class AppService {
  constructor({ store }) {
    this.store = store;
  }

  createApp({ developerId, name, priceCents, credits, developerWebhookUrl = null, idempotencyKey }) {
    const cached = this.store.getIdempotent(`app:${developerId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (!this.store.developers.has(developerId)) {
      throw new AppError(404, "developer not found");
    }
    const app = this.store.createApp({
      developerId,
      name,
      developerWebhookUrl,
      apiKey: `app_${randomUUID()}`
    });
    const creditPackage = this.store.createCreditPackage({
      appId: app.appId,
      priceCents,
      credits
    });
    const result = { ...app, defaultCreditPackage: creditPackage };
    this.store.setIdempotent(`app:${developerId}`, idempotencyKey, result);
    return result;
  }

  configureAction({ appId, actionType, cost, idempotencyKey }) {
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
