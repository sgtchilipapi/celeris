import { randomUUID } from "node:crypto";
import type {
  ActionType,
  App,
  Asset,
  CreditBalance,
  CreditLedgerEntry,
  CreditPackage,
  Developer,
  DeveloperAccount,
  MemoryStore as MemoryStoreContract,
  Payment,
  PlayerAccount,
  PendingAction,
  TransactionRecord,
  UsageEvent,
  User,
  UserSession,
  UUID
} from "../types.js";

export class MemoryStore implements MemoryStoreContract {
  developers = new Map<UUID, Developer>();
  developerAccounts = new Map<string, DeveloperAccount>();
  playerAccounts = new Map<string, PlayerAccount>();
  users = new Map<UUID, User>();
  userSessions = new Map<UUID, UserSession>();
  apps = new Map<UUID, App>();
  creditPackages = new Map<UUID, CreditPackage>();
  creditBalances = new Map<string, CreditBalance>();
  creditLedger: CreditLedgerEntry[] = [];
  actionTypes = new Map<string, ActionType>();
  pendingActions = new Map<UUID, PendingAction>();
  transactions = new Map<UUID, TransactionRecord>();
  assets = new Map<UUID, Asset>();
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

  createPlayerAccount({ userId, username, password }: { userId: UUID; username: string; password: string }): PlayerAccount {
    const account: PlayerAccount = {
      userId,
      username,
      password,
      createdAt: new Date().toISOString()
    };
    this.playerAccounts.set(username.toLowerCase(), account);
    return account;
  }

  getPlayerAccountByUsername(username: string): PlayerAccount | null {
    return this.playerAccounts.get(username.toLowerCase()) ?? null;
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

  createUserSession({
    sessionId = randomUUID(),
    userId,
    provider,
    token,
    expiresAt
  }: {
    sessionId?: UUID;
    userId: UUID;
    provider: "dummy";
    token: string;
    expiresAt: string;
  }): UserSession {
    const session: UserSession = {
      sessionId,
      userId,
      provider,
      token,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    this.userSessions.set(sessionId, session);
    return session;
  }

  createApp({
    appId = randomUUID(),
    developerId,
    name,
    apiKey,
    developerWebhookUrl = null
  }: {
    appId?: UUID;
    developerId: UUID;
    name: string;
    apiKey: string;
    developerWebhookUrl?: string | null;
  }): App {
    const app: App = { appId, developerId, name, apiKey, developerWebhookUrl, createdAt: new Date().toISOString() };
    this.apps.set(appId, app);
    return app;
  }

  saveApp(record: App): App {
    this.apps.set(record.appId, record);
    return record;
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
    for (const [id, asset] of this.assets.entries()) {
      if (asset.appId === appId) {
        this.assets.delete(id);
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

  upsertActionType({ appId, actionType, cost }: { appId: UUID; actionType: string; cost: number }): ActionType {
    const key = `${appId}:${actionType}`;
    const record: ActionType = { appId, actionType, cost, createdAt: new Date().toISOString() };
    this.actionTypes.set(key, record);
    return record;
  }

  getActionType(appId: UUID, actionType: string): ActionType | null {
    return this.actionTypes.get(`${appId}:${actionType}`) ?? null;
  }

  deleteActionType(appId: UUID, actionType: string): boolean {
    return this.actionTypes.delete(`${appId}:${actionType}`);
  }

  getBalance(userId: UUID, appId: UUID): CreditBalance {
    const key = `${userId}:${appId}`;
    if (!this.creditBalances.has(key)) {
      this.creditBalances.set(key, { userId, appId, balance: 0, reserved: 0, updatedAt: new Date().toISOString() });
    }
    return this.creditBalances.get(key)!;
  }

  withLockedBalance<T>(userId: UUID, appId: UUID, callback: (balance: CreditBalance) => T): T {
    const balance = this.getBalance(userId, appId);
    const snapshot = { ...balance };
    try {
      return callback(balance);
    } catch (error) {
      this.creditBalances.set(`${userId}:${appId}`, snapshot);
      throw error;
    }
  }

  saveBalance(balance: CreditBalance): CreditBalance {
    balance.updatedAt = new Date().toISOString();
    this.creditBalances.set(`${balance.userId}:${balance.appId}`, balance);
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

  createAsset(record: Asset): Asset {
    this.assets.set(record.assetId, record);
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
