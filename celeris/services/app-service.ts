import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { AppError } from "./errors.js";
import { normalizeAllowedOrigins, normalizeAllowedRedirectUris } from "./auth-gateway-service.js";
import { deriveHelloCelerisStatePda, parseSolanaProgramId } from "../solana/hello-celeris.js";
import type {
  AppListItem,
  AppSetupDetails,
  ConfigureActionRequest,
  CreateAppRequest,
  CreateAppResponse,
  DeveloperCredentialsRequest,
  DeveloperSessionResponse,
  MemoryStore,
  RegisteredProgram,
  SponsorWallet,
  StoredAppSetup,
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
    allowedChainId,
    allowedFrontendOrigins,
    allowedRedirectUris,
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
      apiKey: `app_${randomUUID()}`
    });
    this.store.saveAppPlayerPolicy({
      appId: app.appId,
      authProvider: "privy",
      allowedChainId,
      allowedFrontendOrigins: normalizeAllowedOrigins(allowedFrontendOrigins, "http://localhost:3002"),
      allowedRedirectUris: normalizeAllowedRedirectUris(allowedRedirectUris, "http://localhost:3002/auth/callback"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
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

  updateApp({
    appId,
    name,
    priceCents,
    credits,
    allowedChainId,
    allowedFrontendOrigins,
    allowedRedirectUris,
    idempotencyKey
  }: UpdateAppRequest): StoredAppSetup {
    const cached = this.store.getIdempotent<StoredAppSetup>(`app-update:${appId}`, idempotencyKey);
    if (cached) {
      return cached;
    }

    const app = this.requireApp(appId);

    app.name = name;
    this.store.saveApp(app);
    const existingPlayerPolicy = this.store.appPlayerPolicies.get(appId);
    this.store.saveAppPlayerPolicy({
      appId,
      authProvider: "privy",
      allowedChainId,
      allowedFrontendOrigins: normalizeAllowedOrigins(
        allowedFrontendOrigins,
        existingPlayerPolicy?.allowedFrontendOrigins[0] ?? "http://localhost:3002"
      ),
      allowedRedirectUris: normalizeAllowedRedirectUris(
        allowedRedirectUris,
        existingPlayerPolicy?.allowedRedirectUris[0] ?? "http://localhost:3002/auth/callback"
      ),
      createdAt: existingPlayerPolicy?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

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
    const app = this.requireApp(appId);
    const playerPolicy = this.store.appPlayerPolicies.get(appId);
    if (!playerPolicy) {
      throw new AppError(404, "app player policy not found");
    }
    return {
      appId: app.appId,
      apiKey: app.apiKey,
      playerPolicy,
      creditPackages: [...this.store.creditPackages.values()].filter((pkg) => pkg.appId === appId),
      actions: [...this.store.actionTypes.values()].filter((action) => action.appId === appId),
      registeredProgram: this.store.getRegisteredProgram(appId),
      sponsorWallet: this.store.getSponsorWallet(appId)
    };
  }

  getProgram(appId: string): RegisteredProgram {
    this.requireApp(appId);
    const registeredProgram = this.store.getRegisteredProgram(appId);
    if (!registeredProgram) {
      throw new AppError(404, "registered program not found");
    }
    return registeredProgram;
  }

  registerProgram({
    appId,
    programId,
    idempotencyKey
  }: {
    appId: string;
    programId: string;
    idempotencyKey: string;
  }): RegisteredProgram {
    const cached = this.store.getIdempotent<RegisteredProgram>(`program:${appId}`, idempotencyKey);
    if (cached) {
      return cached;
    }

    this.requireApp(appId);

    let parsedProgramId;
    try {
      parsedProgramId = parseSolanaProgramId(programId);
    } catch {
      throw new AppError(400, "invalid Solana program ID");
    }

    const existing = this.store.getRegisteredProgram(appId);
    const registration = this.store.saveRegisteredProgram({
      appId,
      chainFamily: "solana",
      cluster: "devnet",
      programId: parsedProgramId.toBase58(),
      statePda: deriveHelloCelerisStatePda({
        appId,
        programId: parsedProgramId
      }).statePda.toBase58(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    this.store.setIdempotent(`program:${appId}`, idempotencyKey, registration);
    return registration;
  }

  getSponsorWallet(appId: string): SponsorWallet {
    this.requireApp(appId);
    const sponsorWallet = this.store.getSponsorWallet(appId);
    if (!sponsorWallet) {
      throw new AppError(404, "sponsor wallet not found");
    }
    return sponsorWallet;
  }

  provisionSponsorWallet({
    appId,
    idempotencyKey
  }: {
    appId: string;
    idempotencyKey: string;
  }): { sponsorWallet: SponsorWallet; created: boolean } {
    const cached = this.store.getIdempotent<{ sponsorWallet: SponsorWallet; created: boolean }>(
      `sponsor-wallet:${appId}`,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

    this.requireApp(appId);

    const existing = this.store.getSponsorWallet(appId);
    if (existing) {
      const result = { sponsorWallet: existing, created: false };
      this.store.setIdempotent(`sponsor-wallet:${appId}`, idempotencyKey, result);
      return result;
    }

    const now = new Date().toISOString();
    const keypair = Keypair.generate();
    this.store.saveSponsorWalletSecret({
      appId,
      secretKey: Array.from(keypair.secretKey),
      createdAt: now,
      updatedAt: now
    });
    const sponsorWallet = this.store.saveSponsorWallet({
      appId,
      chainFamily: "solana",
      cluster: "devnet",
      publicKey: keypair.publicKey.toBase58(),
      createdAt: now,
      updatedAt: now
    });
    const result = { sponsorWallet, created: true };
    this.store.setIdempotent(`sponsor-wallet:${appId}`, idempotencyKey, result);
    return result;
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

  configureAction({ appId, actionType, cost, executionMode, idempotencyKey }: ConfigureActionRequest) {
    const cached = this.store.getIdempotent(`action:${appId}:${actionType}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    this.requireApp(appId);
    const action = this.store.upsertActionType({ appId, actionType, cost, executionMode });
    this.store.setIdempotent(`action:${appId}:${actionType}`, idempotencyKey, action);
    return action;
  }

  updateAction({ appId, currentActionType, nextActionType, cost, executionMode, idempotencyKey }: UpdateActionRequest) {
    const cached = this.store.getIdempotent(`action-update:${appId}:${currentActionType}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    this.requireApp(appId);
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
    const action = this.store.upsertActionType({ appId, actionType: nextActionType, cost, executionMode });
    this.store.setIdempotent(`action-update:${appId}:${currentActionType}`, idempotencyKey, action);
    return action;
  }

  deleteAction({ appId, actionType, idempotencyKey }: { appId: string; actionType: string; idempotencyKey: string }) {
    const cached = this.store.getIdempotent<boolean>(`action-delete:${appId}:${actionType}`, idempotencyKey);
    if (cached !== null) {
      return cached;
    }
    this.requireApp(appId);
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
    this.requireApp(appId);
    const deleted = this.store.deleteApp(appId);
    this.store.setIdempotent(`app-delete:${appId}`, idempotencyKey, deleted);
    return deleted;
  }

  requireDeveloperOwnsApp(developerId: string, appId: string) {
    const app = this.requireApp(appId);
    if (app.developerId !== developerId) {
      throw new AppError(403, "developer does not have access to this app");
    }
    return app;
  }

  private requireApp(appId: string) {
    const app = this.store.apps.get(appId);
    if (!app) {
      throw new AppError(404, "app not found");
    }
    return app;
  }
}
