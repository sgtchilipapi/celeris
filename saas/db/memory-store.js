import { randomUUID } from "node:crypto";

export class MemoryStore {
  constructor() {
    this.developers = new Map();
    this.users = new Map();
    this.apps = new Map();
    this.creditPackages = new Map();
    this.creditBalances = new Map();
    this.creditLedger = [];
    this.actionTypes = new Map();
    this.pendingActions = new Map();
    this.transactions = new Map();
    this.assets = new Map();
    this.payments = new Map();
    this.usageEvents = [];
    this.idempotency = new Map();
  }

  createDeveloper({ developerId = randomUUID(), email }) {
    const developer = { developerId, email, createdAt: new Date().toISOString() };
    this.developers.set(developerId, developer);
    return developer;
  }

  createUser({ userId = randomUUID(), externalSubject = null }) {
    const user = { userId, externalSubject, createdAt: new Date().toISOString() };
    this.users.set(userId, user);
    return user;
  }

  findUserByExternalSubject(externalSubject) {
    return [...this.users.values()].find((user) => user.externalSubject === externalSubject) ?? null;
  }

  createApp({ appId = randomUUID(), developerId, name, apiKey, developerWebhookUrl = null }) {
    const app = { appId, developerId, name, apiKey, developerWebhookUrl, createdAt: new Date().toISOString() };
    this.apps.set(appId, app);
    return app;
  }

  createCreditPackage({ packageId = randomUUID(), appId, priceCents, credits }) {
    const pkg = { packageId, appId, priceCents, credits, createdAt: new Date().toISOString() };
    this.creditPackages.set(packageId, pkg);
    return pkg;
  }

  upsertActionType({ appId, actionType, cost }) {
    const key = `${appId}:${actionType}`;
    const record = { appId, actionType, cost, createdAt: new Date().toISOString() };
    this.actionTypes.set(key, record);
    return record;
  }

  getActionType(appId, actionType) {
    return this.actionTypes.get(`${appId}:${actionType}`) ?? null;
  }

  getBalance(userId, appId) {
    const key = `${userId}:${appId}`;
    if (!this.creditBalances.has(key)) {
      this.creditBalances.set(key, { userId, appId, balance: 0, reserved: 0, updatedAt: new Date().toISOString() });
    }
    return this.creditBalances.get(key);
  }

  saveBalance(balance) {
    balance.updatedAt = new Date().toISOString();
    this.creditBalances.set(`${balance.userId}:${balance.appId}`, balance);
    return balance;
  }

  addLedgerEntry(entry) {
    this.creditLedger.push(entry);
    return entry;
  }

  createPendingAction(record) {
    this.pendingActions.set(record.id, record);
    return record;
  }

  getPendingAction(id) {
    return this.pendingActions.get(id) ?? null;
  }

  savePendingAction(record) {
    record.updatedAt = new Date().toISOString();
    this.pendingActions.set(record.id, record);
    return record;
  }

  createTransaction(record) {
    this.transactions.set(record.txId, record);
    return record;
  }

  createAsset(record) {
    this.assets.set(record.assetId, record);
    return record;
  }

  createPayment(record) {
    this.payments.set(record.paymentId, record);
    return record;
  }

  getPaymentByProviderSessionId(providerSessionId) {
    return [...this.payments.values()].find((payment) => payment.providerSessionId === providerSessionId) ?? null;
  }

  savePayment(record) {
    this.payments.set(record.paymentId, record);
    return record;
  }

  recordUsageEvent(event) {
    this.usageEvents.push(event);
    return event;
  }

  getIdempotent(scope, key) {
    return this.idempotency.get(`${scope}:${key}`) ?? null;
  }

  setIdempotent(scope, key, value) {
    this.idempotency.set(`${scope}:${key}`, value);
    return value;
  }
}
