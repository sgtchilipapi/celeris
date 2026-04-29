import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  AppListItem,
  AppSetupDetails,
  ConfigureActionRequest,
  CreateAppRequest,
  CreateAppResponse,
  DeveloperCredentialsRequest,
  DeveloperSessionResponse,
  MemoryStore,
  StoredAppSetup
  ,
  UpdateActionRequest,
  UpdateAppRequest
} from "../types.js";

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

  updateApp({ appId, name, priceCents, credits, webhookUrl = null, idempotencyKey }: UpdateAppRequest): StoredAppSetup {
    const cached = this.store.getIdempotent<StoredAppSetup>(`app-update:${appId}`, idempotencyKey);
    if (cached) {
      return cached;
    }

    const app = this.store.apps.get(appId);
    if (!app) {
      throw new AppError(404, "app not found");
    }

    app.name = name;
    app.developerWebhookUrl = webhookUrl;
    this.store.saveApp(app);

    const creditPackage = [...this.store.creditPackages.values()].find((pkg) => pkg.appId === appId);
    if (!creditPackage) {
      throw new AppError(404, "credit package not found");
    }
    creditPackage.priceCents = priceCents;
    creditPackage.credits = credits;
    this.store.saveCreditPackage(creditPackage);

    const result: StoredAppSetup = { ...app, defaultCreditPackage: creditPackage };
    this.store.setIdempotent(`app-update:${appId}`, idempotencyKey, result);
    return result;
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

  listApps(developerId?: string): AppListItem[] {
    return [...this.store.apps.values()]
      .filter((app) => !developerId || app.developerId === developerId)
      .map((app) => ({
        appId: app.appId,
        developerId: app.developerId,
        name: app.name,
        createdAt: app.createdAt
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  signUpDeveloper({ username, password, developerId, idempotencyKey }: DeveloperCredentialsRequest): DeveloperSessionResponse {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      throw new AppError(400, "username and password are required");
    }

    const cached = this.store.getIdempotent<DeveloperSessionResponse>(`developer-sign-up:${normalizedUsername.toLowerCase()}`, idempotencyKey);
    if (cached) {
      return cached;
    }

    if (this.store.getDeveloperAccountByUsername(normalizedUsername)) {
      throw new AppError(409, "username already exists");
    }

    const session = this.createDemoDeveloperSession(developerId);
    this.store.createDeveloperAccount({
      developerId: session.developerId,
      username: normalizedUsername,
      password
    });
    this.store.setIdempotent(`developer-sign-up:${normalizedUsername.toLowerCase()}`, idempotencyKey, session);
    return session;
  }

  signInDeveloper({ username, password }: { username: string; password: string }): DeveloperSessionResponse {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      throw new AppError(400, "username and password are required");
    }

    const account = this.store.getDeveloperAccountByUsername(normalizedUsername);
    if (!account || account.password !== password) {
      throw new AppError(401, "invalid username or password");
    }

    const developer = this.store.developers.get(account.developerId);
    if (!developer) {
      throw new AppError(404, "developer not found");
    }

    return {
      developerId: developer.developerId,
      email: developer.email
    };
  }

  createDemoDeveloperSession(developerId?: string): DeveloperSessionResponse {
    const existing = developerId ? this.store.developers.get(developerId) : null;
    if (existing) {
      return {
        developerId: existing.developerId,
        email: existing.email
      };
    }

    const created = this.store.createDeveloper({
      developerId,
      email: `developer+${developerId ?? randomUUID()}@demo.celeris.local`
    });

    return {
      developerId: created.developerId,
      email: created.email
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

  updateAction({ appId, currentActionType, nextActionType, cost, idempotencyKey }: UpdateActionRequest) {
    const cached = this.store.getIdempotent(`action-update:${appId}:${currentActionType}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (!this.store.apps.has(appId)) {
      throw new AppError(404, "app not found");
    }
    const existing = this.store.getActionType(appId, currentActionType);
    if (!existing) {
      throw new AppError(404, "action type not found");
    }
    if (currentActionType !== nextActionType && this.store.getActionType(appId, nextActionType)) {
      throw new AppError(409, "action type already exists");
    }

    if (currentActionType !== nextActionType) {
      this.store.deleteActionType(appId, currentActionType);
    }
    const action = this.store.upsertActionType({ appId, actionType: nextActionType, cost });
    this.store.setIdempotent(`action-update:${appId}:${currentActionType}`, idempotencyKey, action);
    return action;
  }

  deleteAction({ appId, actionType, idempotencyKey }: { appId: string; actionType: string; idempotencyKey: string }) {
    const cached = this.store.getIdempotent<boolean>(`action-delete:${appId}:${actionType}`, idempotencyKey);
    if (cached !== null) {
      return cached;
    }
    if (!this.store.apps.has(appId)) {
      throw new AppError(404, "app not found");
    }
    if (!this.store.getActionType(appId, actionType)) {
      throw new AppError(404, "action type not found");
    }
    const deleted = this.store.deleteActionType(appId, actionType);
    this.store.setIdempotent(`action-delete:${appId}:${actionType}`, idempotencyKey, deleted);
    return deleted;
  }

  deleteApp({ appId, idempotencyKey }: { appId: string; idempotencyKey: string }) {
    const cached = this.store.getIdempotent<boolean>(`app-delete:${appId}`, idempotencyKey);
    if (cached !== null) {
      return cached;
    }
    if (!this.store.apps.has(appId)) {
      throw new AppError(404, "app not found");
    }
    const deleted = this.store.deleteApp(appId);
    this.store.setIdempotent(`app-delete:${appId}`, idempotencyKey, deleted);
    return deleted;
  }
}
