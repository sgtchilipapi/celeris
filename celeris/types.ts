export type UUID = string;
export type JsonObject = Record<string, unknown>;
export type WalletAddress = string;
export type ChainId = string;

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
export type ActionExecutionMode = "managed" | "server" | "webhook";
export type AssetDeliveryStatus = "submitted" | "confirmed" | "failed";

export interface WalletPrincipal {
  walletAddress: WalletAddress;
  chainId: ChainId;
}

export interface Developer {
  developerId: UUID;
  email: string;
  createdAt: string;
}

export interface DeveloperAccount {
  developerId: UUID;
  username: string;
  password: string;
  createdAt: string;
}

export interface User {
  userId: UUID;
  externalSubject: string | null;
  email: string | null;
  createdAt: string;
}

export interface CelerisUser {
  celerisUserId: UUID;
  externalSubject: string;
  walletAddress: WalletAddress;
  chainId: ChainId;
  createdAt: string;
}

export interface ProjectUser {
  projectUserId: UUID;
  projectId: UUID;
  celerisUserId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  createdAt: string;
}

export interface App {
  appId: UUID;
  developerId: UUID;
  name: string;
  apiKey: string;
  createdAt: string;
}

export interface AppPlayerPolicy {
  appId: UUID;
  authProvider: "privy";
  allowedChainId: ChainId;
  allowedFrontendOrigins: string[];
  allowedRedirectUris: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformPrivyConfig {
  authProvider: "privy";
  privyAppId: string;
  appSecret: string;
  clientId?: string;
}

export interface HostedAuthConfig {
  hostedAuthOrigin: string;
  sessionSecret: string;
}

export interface LoginRequest {
  loginRequestId: UUID;
  projectId: UUID;
  origin: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface AuthCode {
  codeId: UUID;
  loginRequestId: UUID;
  projectId: UUID;
  celerisUserId: UUID;
  projectUserId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  codeChallenge: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface PlayerSession {
  sessionId: UUID;
  projectId: UUID;
  celerisUserId: UUID;
  projectUserId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  expiresAt: string;
  revokedAt: string | null;
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
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  balance: number;
  reserved: number;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  entryId: UUID;
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
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
  executionMode: ActionExecutionMode;
  createdAt: string;
}

export interface PendingAction {
  id: UUID;
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
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
  walletPrincipal: WalletPrincipal;
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
  walletAddress: WalletAddress;
  chainId: ChainId;
  providerTxId: string;
  rawTx: string;
  status: TransactionStatus;
  summary: MintItemApprovalSummary;
  createdAt: string;
}

export interface AssetDeliveryRecord {
  deliveryId: UUID;
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  itemDefId: string;
  transactionId: UUID;
  destinationWalletAddress: WalletAddress;
  status: AssetDeliveryStatus;
  createdAt: string;
}

export interface Payment {
  paymentId: UUID;
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
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
  walletAddress?: WalletAddress;
  chainId?: ChainId;
  eventType: string;
  value?: number;
  metadata: JsonObject;
  createdAt: string;
}

export interface PrivyClaims {
  sub: string;
  walletAddress?: WalletAddress;
  chainId?: ChainId;
  iat?: number;
  exp?: number;
}

export interface CompleteHostedLoginWithPrivyTokenRequest {
  loginRequestId: UUID;
  privyAccessToken: string;
}

export interface PrivyTokenVerifier {
  verifyToken(token: string, options?: { allowedChainId?: ChainId }): PrivyClaims | Promise<PrivyClaims>;
}

export interface CreateAppRequest {
  developerId: UUID;
  name: string;
  priceCents: number;
  credits: number;
  allowedChainId: ChainId;
  allowedFrontendOrigins?: string[];
  allowedRedirectUris?: string[];
  idempotencyKey: string;
}

export interface UpdateAppRequest {
  appId: UUID;
  name: string;
  priceCents: number;
  credits: number;
  allowedChainId: ChainId;
  allowedFrontendOrigins?: string[];
  allowedRedirectUris?: string[];
  idempotencyKey: string;
}

export interface StoredAppSetup extends App {
  defaultCreditPackage: CreditPackage;
}

export interface CreateAppResponse {
  appId: UUID;
  apiKey: string;
}

export interface DeveloperSessionResponse {
  developerId: UUID;
  email: string;
}

export interface DeveloperCredentialsRequest {
  username: string;
  password: string;
  developerId?: UUID;
  idempotencyKey: string;
}

export interface AppListItem {
  appId: UUID;
  developerId: UUID;
  name: string;
  createdAt: string;
}

export interface AppSetupDetails {
  appId: UUID;
  apiKey: string;
  playerPolicy: AppPlayerPolicy;
  creditPackages: CreditPackage[];
  actions: ActionType[];
}

export interface AuthLoginRequestResponse {
  loginRequestId: UUID;
  hostedLoginUrl: string;
  expiresAt: string;
}

export interface AuthCodeExchangeResponse {
  accessToken: string;
  expiresAt: string;
  player: WalletPrincipal;
  projectId: UUID;
  celerisUserId: UUID;
  projectUserId: UUID;
}

export interface ConfigureActionRequest {
  appId: UUID;
  actionType: string;
  cost: number;
  executionMode: ActionExecutionMode;
  idempotencyKey: string;
}

export interface UpdateActionRequest {
  appId: UUID;
  currentActionType: string;
  nextActionType: string;
  cost: number;
  executionMode: ActionExecutionMode;
  idempotencyKey: string;
}

export interface CreateCheckoutSessionRequest {
  appId: UUID;
  walletPrincipal: WalletPrincipal;
  packageId: UUID;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey: string;
}

export interface CheckoutSessionMetadata extends JsonObject {
  appId: UUID;
  walletAddress?: WalletAddress;
  chainId?: ChainId;
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
  appId: UUID;
  walletAddress: WalletAddress;
  chainId: ChainId;
  grantedCredits: number;
  status: PaymentStatus;
  providerEventId: string;
}

export interface MintItemPayload {
  itemDefId: string;
}

export interface ExecuteMintItemRequest {
  appId: UUID;
  walletPrincipal: WalletPrincipal;
  payload: MintItemPayload;
  idempotencyKey: string;
}

export interface ExecuteClaimRewardsRequest {
  appId: UUID;
  walletPrincipal: WalletPrincipal;
  actionId: "claim_rewards" | "first_time_claim";
  idempotencyKey: string;
}

export interface ManagedMintItemRequest {
  pendingActionId: UUID;
  appId: UUID;
  walletPrincipal: WalletPrincipal;
  cost: number;
  payload: MintItemPayload;
}

export interface ManagedMintItemResult {
  tx: string;
  summary: MintItemApprovalSummary;
}

export interface MintItemExecutionResult {
  pendingActionId: UUID;
  transactionId: UUID;
  deliveryId: UUID;
  status: TransactionStatus;
}

export interface ClaimRewardsExecutionResult {
  actionType: "claim_rewards" | "first_time_claim";
  debitedCredits: number;
  remainingCredits: number;
  status: "success";
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
  walletAddress: WalletAddress;
  chainId: ChainId;
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
  chartSeries: {
    creditFlow: Array<{ label: string; value: number }>;
    transactionOutcomes: Array<{ label: string; value: number }>;
    userActivity: Array<{ walletAddress: WalletAddress; chainId: ChainId; value: number }>;
  };
  users: AppMetricsUser[];
}

export interface MemoryStore {
  developers: Map<UUID, Developer>;
  developerAccounts: Map<string, DeveloperAccount>;
  users: Map<UUID, User>;
  celerisUsers: Map<UUID, CelerisUser>;
  projectUsers: Map<UUID, ProjectUser>;
  apps: Map<UUID, App>;
  appPlayerPolicies: Map<UUID, AppPlayerPolicy>;
  loginRequests: Map<UUID, LoginRequest>;
  authCodes: Map<UUID, AuthCode>;
  playerSessions: Map<UUID, PlayerSession>;
  creditPackages: Map<UUID, CreditPackage>;
  creditBalances: Map<string, CreditBalance>;
  creditLedger: CreditLedgerEntry[];
  actionTypes: Map<string, ActionType>;
  pendingActions: Map<UUID, PendingAction>;
  transactions: Map<UUID, TransactionRecord>;
  assetDeliveries: Map<UUID, AssetDeliveryRecord>;
  payments: Map<UUID, Payment>;
  usageEvents: UsageEvent[];
  idempotency: Map<string, unknown>;
  createDeveloper(input: { developerId?: UUID; email: string }): Developer;
  createDeveloperAccount(input: { developerId: UUID; username: string; password: string }): DeveloperAccount;
  getDeveloperAccountByUsername(username: string): DeveloperAccount | null;
  createUser(input: { userId?: UUID; externalSubject?: string | null; email?: string | null }): User;
  findUserByExternalSubject(externalSubject: string): User | null;
  findUserByEmail(email: string): User | null;
  upsertCelerisUser(input: { externalSubject: string; walletAddress: WalletAddress; chainId: ChainId }): CelerisUser;
  getCelerisUserByExternalSubject(externalSubject: string): CelerisUser | null;
  upsertProjectUser(input: {
    projectId: UUID;
    celerisUserId: UUID;
    walletAddress: WalletAddress;
    chainId: ChainId;
  }): ProjectUser;
  getProjectUser(projectId: UUID, celerisUserId: UUID): ProjectUser | null;
  createApp(input: {
    appId?: UUID;
    developerId: UUID;
    name: string;
    apiKey: string;
  }): App;
  saveAppPlayerPolicy(record: AppPlayerPolicy): AppPlayerPolicy;
  createCreditPackage(input: {
    packageId?: UUID;
    appId: UUID;
    priceCents: number;
    credits: number;
  }): CreditPackage;
  saveApp(record: App): App;
  saveCreditPackage(record: CreditPackage): CreditPackage;
  deleteApp(appId: UUID): boolean;
  upsertActionType(input: { appId: UUID; actionType: string; cost: number; executionMode: ActionExecutionMode }): ActionType;
  getActionType(appId: UUID, actionType: string): ActionType | null;
  deleteActionType(appId: UUID, actionType: string): boolean;
  getBalance(walletPrincipal: WalletPrincipal, appId: UUID): CreditBalance;
  withLockedBalance<T>(walletPrincipal: WalletPrincipal, appId: UUID, callback: (balance: CreditBalance) => T): T;
  saveBalance(balance: CreditBalance): CreditBalance;
  addLedgerEntry(entry: CreditLedgerEntry): CreditLedgerEntry;
  createPendingAction(record: PendingAction): PendingAction;
  getPendingAction(id: UUID): PendingAction | null;
  savePendingAction(record: PendingAction): PendingAction;
  createTransaction(record: TransactionRecord): TransactionRecord;
  saveTransaction(record: TransactionRecord): TransactionRecord;
  createAssetDelivery(record: AssetDeliveryRecord): AssetDeliveryRecord;
  createPayment(record: Payment): Payment;
  getPaymentByProviderSessionId(providerSessionId: string): Payment | null;
  getPaymentByProviderEventId(providerEventId: string): Payment | null;
  savePayment(record: Payment): Payment;
  createLoginRequest(record: LoginRequest): LoginRequest;
  saveLoginRequest(record: LoginRequest): LoginRequest;
  createAuthCode(record: AuthCode): AuthCode;
  saveAuthCode(record: AuthCode): AuthCode;
  createPlayerSession(record: PlayerSession): PlayerSession;
  savePlayerSession(record: PlayerSession): PlayerSession;
  recordUsageEvent(event: UsageEvent): UsageEvent;
  getIdempotent<T>(scope: string, key: string): T | null;
  setIdempotent<T>(scope: string, key: string, value: T): T;
}
