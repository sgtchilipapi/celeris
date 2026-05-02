import { randomUUID } from "node:crypto";
import type {
  ActionType,
  App,
  AppPlayerPolicy,
  AuthCode,
  AssetDeliveryRecord,
  CreditBalance,
  CreditLedgerEntry,
  CreditPackage,
  CelerisUser,
  Developer,
  DeveloperAccount,
  LoginRequest,
  MemoryStore as MemoryStoreContract,
  Payment,
  PendingAction,
  PlayerSession,
  ProjectUser,
  TransactionRecord,
  UsageEvent,
  User,
  WalletPrincipal,
  UUID
} from "../types.js";

export class MemoryStore implements MemoryStoreContract {
  developers = new Map<UUID, Developer>();
  developerAccounts = new Map<string, DeveloperAccount>();
  users = new Map<UUID, User>();
  celerisUsers = new Map<UUID, CelerisUser>();
  projectUsers = new Map<UUID, ProjectUser>();
  apps = new Map<UUID, App>();
  appPlayerPolicies = new Map<UUID, AppPlayerPolicy>();
  loginRequests = new Map<UUID, LoginRequest>();
  authCodes = new Map<UUID, AuthCode>();
  playerSessions = new Map<UUID, PlayerSession>();
  creditPackages = new Map<UUID, CreditPackage>();
  creditBalances = new Map<string, CreditBalance>();
  creditLedger: CreditLedgerEntry[] = [];
  actionTypes = new Map<string, ActionType>();
  pendingActions = new Map<UUID, PendingAction>();
  transactions = new Map<UUID, TransactionRecord>();
  assetDeliveries = new Map<UUID, AssetDeliveryRecord>();
  payments = new Map<UUID, Payment>();
  usageEvents: UsageEvent[] = [];
  idempotency = new Map<string, unknown>();

  createDeveloper({ developerId = randomUUID(), email }: { developerId?: UUID; email: string }): Developer {
    const developer: Developer = { developerId, email, createdAt: new Date().toISOString() };
    this.developers.set(developerId, developer);
    return developer;
  }

  createDeveloperAccount({
    developerId,
    username,
    password
  }: {
    developerId: UUID;
    username: string;
    password: string;
  }): DeveloperAccount {
    const account: DeveloperAccount = {
      developerId,
      username,
      password,
      createdAt: new Date().toISOString()
    };
    this.developerAccounts.set(username.toLowerCase(), account);
    return account;
  }

  getDeveloperAccountByUsername(username: string): DeveloperAccount | null {
    return this.developerAccounts.get(username.toLowerCase()) ?? null;
  }

  createUser({
    userId = randomUUID(),
    externalSubject = null,
    email = null
  }: {
    userId?: UUID;
    externalSubject?: string | null;
    email?: string | null;
  }): User {
    const user: User = { userId, externalSubject, email, createdAt: new Date().toISOString() };
    this.users.set(userId, user);
    return user;
  }

  findUserByExternalSubject(externalSubject: string): User | null {
    return [...this.users.values()].find((user) => user.externalSubject === externalSubject) ?? null;
  }

  findUserByEmail(email: string): User | null {
    const normalized = email.toLowerCase();
    return [...this.users.values()].find((user) => user.email?.toLowerCase() === normalized) ?? null;
  }

  upsertCelerisUser({
    externalSubject,
    walletAddress,
    chainId
  }: {
    externalSubject: string;
    walletAddress: string;
    chainId: string;
  }): CelerisUser {
    const existing = this.getCelerisUserByExternalSubject(externalSubject);
    if (existing) {
      existing.walletAddress = walletAddress;
      existing.chainId = chainId;
      this.celerisUsers.set(existing.celerisUserId, existing);
      return existing;
    }

    const created: CelerisUser = {
      celerisUserId: randomUUID(),
      externalSubject,
      walletAddress,
      chainId,
      createdAt: new Date().toISOString()
    };
    this.celerisUsers.set(created.celerisUserId, created);
    return created;
  }

  getCelerisUserByExternalSubject(externalSubject: string): CelerisUser | null {
    return [...this.celerisUsers.values()].find((user) => user.externalSubject === externalSubject) ?? null;
  }

  upsertProjectUser({
    projectId,
    celerisUserId,
    walletAddress,
    chainId
  }: {
    projectId: UUID;
    celerisUserId: UUID;
    walletAddress: string;
    chainId: string;
  }): ProjectUser {
    const existing = this.getProjectUser(projectId, celerisUserId);
    if (existing) {
      existing.walletAddress = walletAddress;
      existing.chainId = chainId;
      this.projectUsers.set(existing.projectUserId, existing);
      return existing;
    }

    const created: ProjectUser = {
      projectUserId: randomUUID(),
      projectId,
      celerisUserId,
      walletAddress,
      chainId,
      createdAt: new Date().toISOString()
    };
    this.projectUsers.set(created.projectUserId, created);
    return created;
  }

  getProjectUser(projectId: UUID, celerisUserId: UUID): ProjectUser | null {
    return [...this.projectUsers.values()].find(
      (projectUser) => projectUser.projectId === projectId && projectUser.celerisUserId === celerisUserId
    ) ?? null;
  }

  createApp({
    appId = randomUUID(),
    developerId,
    name,
    apiKey
  }: {
    appId?: UUID;
    developerId: UUID;
    name: string;
    apiKey: string;
  }): App {
    const app: App = { appId, developerId, name, apiKey, createdAt: new Date().toISOString() };
    this.apps.set(appId, app);
    return app;
  }

  saveApp(record: App): App {
    this.apps.set(record.appId, record);
    return record;
  }

  saveAppPlayerPolicy(record: AppPlayerPolicy): AppPlayerPolicy {
    const next: AppPlayerPolicy = {
      ...record,
      updatedAt: new Date().toISOString()
    };
    this.appPlayerPolicies.set(record.appId, next);
    return next;
  }

  createCreditPackage({
    packageId = randomUUID(),
    appId,
    priceCents,
    credits
  }: {
    packageId?: UUID;
    appId: UUID;
    priceCents: number;
    credits: number;
  }): CreditPackage {
    const pkg: CreditPackage = { packageId, appId, priceCents, credits, createdAt: new Date().toISOString() };
    this.creditPackages.set(packageId, pkg);
    return pkg;
  }

  saveCreditPackage(record: CreditPackage): CreditPackage {
    this.creditPackages.set(record.packageId, record);
    return record;
  }

  deleteApp(appId: UUID): boolean {
    const deleted = this.apps.delete(appId);
    if (!deleted) {
      return false;
    }

    for (const [packageId, pkg] of this.creditPackages.entries()) {
      if (pkg.appId === appId) {
        this.creditPackages.delete(packageId);
      }
    }
    this.appPlayerPolicies.delete(appId);
    for (const [id, projectUser] of this.projectUsers.entries()) {
      if (projectUser.projectId === appId) {
        this.projectUsers.delete(id);
      }
    }
    for (const [id, loginRequest] of this.loginRequests.entries()) {
      if (loginRequest.projectId === appId) {
        this.loginRequests.delete(id);
      }
    }
    for (const [id, authCode] of this.authCodes.entries()) {
      if (authCode.projectId === appId) {
        this.authCodes.delete(id);
      }
    }
    for (const [id, session] of this.playerSessions.entries()) {
      if (session.projectId === appId) {
        this.playerSessions.delete(id);
      }
    }
    for (const [key, action] of this.actionTypes.entries()) {
      if (action.appId === appId) {
        this.actionTypes.delete(key);
      }
    }
    for (const [key, balance] of this.creditBalances.entries()) {
      if (balance.appId === appId) {
        this.creditBalances.delete(key);
      }
    }
    for (const [id, pending] of this.pendingActions.entries()) {
      if (pending.appId === appId) {
        this.pendingActions.delete(id);
      }
    }
    for (const [id, tx] of this.transactions.entries()) {
      if (tx.appId === appId) {
        this.transactions.delete(id);
      }
    }
    for (const [id, delivery] of this.assetDeliveries.entries()) {
      if (delivery.appId === appId) {
        this.assetDeliveries.delete(id);
      }
    }
    for (const [id, payment] of this.payments.entries()) {
      if (payment.appId === appId) {
        this.payments.delete(id);
      }
    }
    this.creditLedger = this.creditLedger.filter((entry) => entry.appId !== appId);
    this.usageEvents = this.usageEvents.filter((event) => event.appId !== appId);

    return true;
  }

  upsertActionType({
    appId,
    actionType,
    cost,
    executionMode
  }: {
    appId: UUID;
    actionType: string;
    cost: number;
    executionMode: ActionType["executionMode"];
  }): ActionType {
    const key = `${appId}:${actionType}`;
    const record: ActionType = { appId, actionType, cost, executionMode, createdAt: new Date().toISOString() };
    this.actionTypes.set(key, record);
    return record;
  }

  getActionType(appId: UUID, actionType: string): ActionType | null {
    return this.actionTypes.get(`${appId}:${actionType}`) ?? null;
  }

  deleteActionType(appId: UUID, actionType: string): boolean {
    return this.actionTypes.delete(`${appId}:${actionType}`);
  }

  getBalance(walletPrincipal: WalletPrincipal, appId: UUID): CreditBalance {
    const key = `${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`;
    if (!this.creditBalances.has(key)) {
      this.creditBalances.set(key, {
        appId,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        balance: 0,
        reserved: 0,
        updatedAt: new Date().toISOString()
      });
    }
    return this.creditBalances.get(key)!;
  }

  withLockedBalance<T>(walletPrincipal: WalletPrincipal, appId: UUID, callback: (balance: CreditBalance) => T): T {
    const balance = this.getBalance(walletPrincipal, appId);
    const snapshot = { ...balance };
    try {
      return callback(balance);
    } catch (error) {
      this.creditBalances.set(`${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`, snapshot);
      throw error;
    }
  }

  saveBalance(balance: CreditBalance): CreditBalance {
    balance.updatedAt = new Date().toISOString();
    this.creditBalances.set(`${balance.appId}:${balance.chainId}:${balance.walletAddress}`, balance);
    return balance;
  }

  addLedgerEntry(entry: CreditLedgerEntry): CreditLedgerEntry {
    this.creditLedger.push(entry);
    return entry;
  }

  createPendingAction(record: PendingAction): PendingAction {
    this.pendingActions.set(record.id, record);
    return record;
  }

  getPendingAction(id: UUID): PendingAction | null {
    return this.pendingActions.get(id) ?? null;
  }

  savePendingAction(record: PendingAction): PendingAction {
    record.updatedAt = new Date().toISOString();
    this.pendingActions.set(record.id, record);
    return record;
  }

  createTransaction(record: TransactionRecord): TransactionRecord {
    this.transactions.set(record.txId, record);
    return record;
  }

  saveTransaction(record: TransactionRecord): TransactionRecord {
    this.transactions.set(record.txId, record);
    return record;
  }

  createAssetDelivery(record: AssetDeliveryRecord): AssetDeliveryRecord {
    this.assetDeliveries.set(record.deliveryId, record);
    return record;
  }

  createPayment(record: Payment): Payment {
    this.payments.set(record.paymentId, record);
    return record;
  }

  getPaymentByProviderSessionId(providerSessionId: string): Payment | null {
    return [...this.payments.values()].find((payment) => payment.providerSessionId === providerSessionId) ?? null;
  }

  getPaymentByProviderEventId(providerEventId: string): Payment | null {
    return [...this.payments.values()].find((payment) => payment.providerEventId === providerEventId) ?? null;
  }

  savePayment(record: Payment): Payment {
    this.payments.set(record.paymentId, record);
    return record;
  }

  createLoginRequest(record: LoginRequest): LoginRequest {
    this.loginRequests.set(record.loginRequestId, record);
    return record;
  }

  saveLoginRequest(record: LoginRequest): LoginRequest {
    this.loginRequests.set(record.loginRequestId, record);
    return record;
  }

  createAuthCode(record: AuthCode): AuthCode {
    this.authCodes.set(record.codeId, record);
    return record;
  }

  saveAuthCode(record: AuthCode): AuthCode {
    this.authCodes.set(record.codeId, record);
    return record;
  }

  createPlayerSession(record: PlayerSession): PlayerSession {
    this.playerSessions.set(record.sessionId, record);
    return record;
  }

  savePlayerSession(record: PlayerSession): PlayerSession {
    this.playerSessions.set(record.sessionId, record);
    return record;
  }

  recordUsageEvent(event: UsageEvent): UsageEvent {
    this.usageEvents.push(event);
    return event;
  }

  getIdempotent<T>(scope: string, key: string): T | null {
    return (this.idempotency.get(`${scope}:${key}`) as T | undefined) ?? null;
  }

  setIdempotent<T>(scope: string, key: string, value: T): T {
    this.idempotency.set(`${scope}:${key}`, value);
    return value;
  }
}
