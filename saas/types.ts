export type UUID = string;
export type JsonObject = Record<string, unknown>;

export type LedgerEntryType = "grant" | "reserve" | "capture" | "release";
export type PendingActionStatus =
  | "reserved"
  | "approved"
  | "submitted"
  | "success"
  | "failed"
  | "released"
  | "expired";
export type TransactionStatus = "submitted" | "success" | "failed";
export type PaymentStatus = "pending" | "paid";
export type AuthProvider = "dummy";

export interface Developer {
  developerId: UUID;
  email: string;
  createdAt: string;
}

export interface User {
  userId: UUID;
  externalSubject: string | null;
  email: string | null;
  createdAt: string;
}

export interface UserSession {
  sessionId: UUID;
  userId: UUID;
  provider: AuthProvider;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface App {
  appId: UUID;
  developerId: UUID;
  name: string;
  apiKey: string;
  developerWebhookUrl: string | null;
  createdAt: string;
}

export interface CreditPackage {
  packageId: UUID;
  appId: UUID;
  priceCents: number;
  credits: number;
  createdAt: string;
}

export interface CreditBalance {
  userId: UUID;
  appId: UUID;
  balance: number;
  reserved: number;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  entryId: UUID;
  userId: UUID;
  appId: UUID;
  pendingActionId: UUID | null;
  paymentId: UUID | null;
  type: LedgerEntryType;
  amount: number;
  idempotencyKey: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface ActionType {
  appId: UUID;
  actionType: string;
  cost: number;
  createdAt: string;
}

export interface PendingAction {
  id: UUID;
  appId: UUID;
  userId: UUID;
  actionType: string;
  cost: number;
  payloadHash: string;
  status: PendingActionStatus;
  expiresAt: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePendingActionRequest {
  userId: UUID;
  appId: UUID;
  actionType: string;
  cost: number;
  payloadHash: string;
  idempotencyKey: string;
}

export interface MintItemApprovalSummary {
  actionType: "mint_item";
  itemDefId: string;
  debit: number;
}

export interface TransactionRecord {
  txId: UUID;
  pendingActionId: UUID;
  appId: UUID;
  userId: UUID;
  providerTxId: string;
  rawTx: string;
  status: TransactionStatus;
  summary: MintItemApprovalSummary;
  createdAt: string;
}

export interface Asset {
  assetId: UUID;
  appId: UUID;
  userId: UUID;
  itemDefId: string;
  transactionId: UUID;
  status: "held";
  createdAt: string;
}

export interface Payment {
  paymentId: UUID;
  userId: UUID;
  appId: UUID;
  packageId: UUID;
  provider: string;
  providerSessionId: string;
  providerEventId?: string;
  amountCents: number;
  credits: number;
  status: PaymentStatus;
  idempotencyKey: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface UsageEvent {
  eventId: UUID;
  appId: UUID;
  userId?: UUID;
  eventType: string;
  value?: number;
  metadata: JsonObject;
  createdAt: string;
}

export interface CreateSessionRequest {
  provider?: string;
  email?: string;
  idempotencyKey: string;
}

export interface SessionResponse {
  userId: UUID;
  token: string;
}

export interface AuthenticatedSession {
  userId: UUID;
  sessionId: UUID;
  provider: AuthProvider;
}

export interface CreateAppRequest {
  developerId: UUID;
  name: string;
  priceCents: number;
  credits: number;
  webhookUrl?: string | null;
  idempotencyKey: string;
}

export interface StoredAppSetup extends App {
  defaultCreditPackage: CreditPackage;
}

export interface CreateAppResponse {
  appId: UUID;
  apiKey: string;
}

export interface AppSetupDetails {
  appId: UUID;
  apiKey: string;
  webhookUrl: string | null;
  creditPackages: CreditPackage[];
  actions: ActionType[];
}

export interface ConfigureActionRequest {
  appId: UUID;
  actionType: string;
  cost: number;
  idempotencyKey: string;
}

export interface CreateCheckoutSessionRequest {
  appId: UUID;
  userId: UUID;
  packageId: UUID;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey: string;
}

export interface CheckoutSessionMetadata extends JsonObject {
  userId: UUID;
  appId: UUID;
  credits: number;
}

export interface CheckoutSessionResponse {
  paymentId: UUID;
  checkoutSessionId: string;
  checkoutUrl: string;
  amountCents: number;
  credits: number;
  provider: string;
  metadata: CheckoutSessionMetadata;
}

export interface StripeCheckoutSessionCompletedEvent {
  id: string;
  type: string;
  data?: {
    object?: {
      id: string;
      amount_total: number;
      metadata: CheckoutSessionMetadata;
    };
  };
}

export interface PaymentWebhookResponse {
  paymentId: UUID;
  userId: UUID;
  appId: UUID;
  grantedCredits: number;
  status: PaymentStatus;
  providerEventId: string;
}

export interface MintItemPayload {
  itemDefId: string;
}

export interface ExecuteMintItemRequest {
  appId: UUID;
  userId: UUID;
  payload: MintItemPayload;
  idempotencyKey: string;
}

export interface MintItemApprovalRequest {
  pendingActionId: UUID;
  appId: UUID;
  userId: UUID;
  actionType: "mint_item";
  cost: number;
  payload: MintItemPayload;
}

export type MintItemApprovalResponse =
  | {
      status: "approved";
      tx: string;
      summary: MintItemApprovalSummary;
    }
  | {
      status: "rejected";
      reason?: string;
    };

export interface MintItemExecutionResult {
  pendingActionId: UUID;
  transactionId: UUID;
  assetId: UUID;
  status: TransactionStatus;
}

export interface RejectedMintItemResult {
  pendingActionId: UUID;
  status: "rejected";
  reason: string;
}

export interface ExecutionResult {
  providerTxId: string;
  status: TransactionStatus;
}

export interface RelayerSubmissionResult {
  providerTxId: string;
  status: "submitted";
  signedTx: string;
  attempts: number;
}

export interface RelayerNetworkClient {
  sendTransaction(signedTx: string): Promise<{ txHash: string }>;
  getTransactionStatus(txHash: string): Promise<Exclude<TransactionStatus, "submitted">>;
}

export interface AppMetricsUser {
  userId: UUID;
  balance: number;
  reserved: number;
  activityEvents: number;
}

export interface AppMetrics {
  appId: UUID;
  totalUsers: number;
  totalRevenueCents: number;
  creditsPurchased: number;
  creditsSpent: number;
  mintItemCount: number;
  successfulTransactions: number;
  failedTransactions: number;
  users: AppMetricsUser[];
}

export interface MemoryStore {
  developers: Map<UUID, Developer>;
  users: Map<UUID, User>;
  userSessions: Map<UUID, UserSession>;
  apps: Map<UUID, App>;
  creditPackages: Map<UUID, CreditPackage>;
  creditBalances: Map<string, CreditBalance>;
  creditLedger: CreditLedgerEntry[];
  actionTypes: Map<string, ActionType>;
  pendingActions: Map<UUID, PendingAction>;
  transactions: Map<UUID, TransactionRecord>;
  assets: Map<UUID, Asset>;
  payments: Map<UUID, Payment>;
  usageEvents: UsageEvent[];
  idempotency: Map<string, unknown>;
  createDeveloper(input: { developerId?: UUID; email: string }): Developer;
  createUser(input: { userId?: UUID; externalSubject?: string | null; email?: string | null }): User;
  findUserByExternalSubject(externalSubject: string): User | null;
  findUserByEmail(email: string): User | null;
  createUserSession(input: {
    sessionId?: UUID;
    userId: UUID;
    provider: AuthProvider;
    token: string;
    expiresAt: string;
  }): UserSession;
  createApp(input: {
    appId?: UUID;
    developerId: UUID;
    name: string;
    apiKey: string;
    developerWebhookUrl?: string | null;
  }): App;
  createCreditPackage(input: {
    packageId?: UUID;
    appId: UUID;
    priceCents: number;
    credits: number;
  }): CreditPackage;
  upsertActionType(input: { appId: UUID; actionType: string; cost: number }): ActionType;
  getActionType(appId: UUID, actionType: string): ActionType | null;
  getBalance(userId: UUID, appId: UUID): CreditBalance;
  withLockedBalance<T>(userId: UUID, appId: UUID, callback: (balance: CreditBalance) => T): T;
  saveBalance(balance: CreditBalance): CreditBalance;
  addLedgerEntry(entry: CreditLedgerEntry): CreditLedgerEntry;
  createPendingAction(record: PendingAction): PendingAction;
  getPendingAction(id: UUID): PendingAction | null;
  savePendingAction(record: PendingAction): PendingAction;
  createTransaction(record: TransactionRecord): TransactionRecord;
  saveTransaction(record: TransactionRecord): TransactionRecord;
  createAsset(record: Asset): Asset;
  createPayment(record: Payment): Payment;
  getPaymentByProviderSessionId(providerSessionId: string): Payment | null;
  getPaymentByProviderEventId(providerEventId: string): Payment | null;
  savePayment(record: Payment): Payment;
  recordUsageEvent(event: UsageEvent): UsageEvent;
  getIdempotent<T>(scope: string, key: string): T | null;
  setIdempotent<T>(scope: string, key: string, value: T): T;
}
