import crypto from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { AppError } from "./errors.js";
import type {
  ChainId,
  MemoryStore,
  PlatformPrivyConfig,
  PrivyClaims,
  PrivyTokenVerifier,
  WalletAddress,
  WalletPrincipal
} from "../types.js";

export interface AuthenticatedPlayer {
  userId: string;
  walletPrincipal: WalletPrincipal;
}

export interface VerifiedPrivyIdentity {
  externalSubject: string;
  walletPrincipal: WalletPrincipal;
}

export class PrivyAuthService {
  readonly store: MemoryStore;
  readonly verifier: PrivyTokenVerifier;

  constructor({ store, verifier }: { store: MemoryStore; verifier: PrivyTokenVerifier }) {
    this.store = store;
    this.verifier = verifier;
  }

  async authenticatePlayerToken(token: string, { allowedChainId }: { allowedChainId?: ChainId } = {}): Promise<AuthenticatedPlayer> {
    if (!token) {
      throw new AppError(401, "authorization token required");
    }

    const claims = await this.verifier.verifyToken(token, { allowedChainId });
    const walletPrincipal = this.resolveWalletPrincipal(claims);
    const externalSubject = this.resolveExternalSubject(claims);
    if (allowedChainId && walletPrincipal.chainId !== allowedChainId) {
      throw new AppError(403, "unsupported chain");
    }

    const user = this.store.findUserByExternalSubject(externalSubject) ?? this.store.createUser({
      externalSubject,
      email: null
    });

    return {
      userId: user.userId,
      walletPrincipal
    };
  }

  async resolveVerifiedToken(token: string, { allowedChainId }: { allowedChainId?: ChainId } = {}): Promise<VerifiedPrivyIdentity> {
    if (!token) {
      throw new AppError(401, "authorization token required");
    }
    const claims = await this.verifier.verifyToken(token, { allowedChainId });
    const walletPrincipal = this.resolveWalletPrincipal(claims);
    const externalSubject = this.resolveExternalSubject(claims);
    if (allowedChainId && walletPrincipal.chainId !== allowedChainId) {
      throw new AppError(403, "unsupported chain");
    }
    return {
      externalSubject,
      walletPrincipal
    };
  }

  private resolveWalletPrincipal(claims: PrivyClaims): WalletPrincipal {
    const chainId = this.normalizeChainId(claims.chainId);
    const walletAddress = this.normalizeWalletAddress(claims.walletAddress, chainId);

    if (!walletAddress) {
      throw new AppError(401, "privy token missing wallet address");
    }
    if (!chainId) {
      throw new AppError(401, "privy token missing chain id");
    }

    return {
      walletAddress,
      chainId
    };
  }

  private normalizeWalletAddress(walletAddress?: string | null, chainId?: ChainId | null): WalletAddress | null {
    if (typeof walletAddress !== "string") {
      return null;
    }
    const normalized = normalizeWalletAddressForChain(walletAddress, chainId);
    return normalized ? normalized : null;
  }

  private normalizeChainId(chainId?: string | null): ChainId | null {
    if (typeof chainId !== "string") {
      return null;
    }
    const normalized = chainId.trim();
    return normalized ? normalized : null;
  }

  private resolveExternalSubject(claims: PrivyClaims) {
    const normalized = String(claims.sub ?? "").trim();
    if (!normalized) {
      throw new AppError(401, "privy token missing subject");
    }
    return normalized;
  }
}

export class LocalPrivyTokenVerifier implements PrivyTokenVerifier {
  readonly secret: string;

  constructor({ secret = "privy-dev-secret" }: { secret?: string } = {}) {
    this.secret = secret;
  }

  verifyToken(token: string): PrivyClaims {
    const [encodedHeader, encodedPayload, providedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !providedSignature) {
      throw new AppError(401, "invalid authorization token");
    }

    const expectedSignature = crypto
      .createHmac("sha256", this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    if (providedSignature !== expectedSignature) {
      throw new AppError(401, "invalid authorization token");
    }

    let payload: PrivyClaims;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as PrivyClaims;
    } catch {
      throw new AppError(401, "invalid authorization token");
    }

    if (!payload.sub) {
      throw new AppError(401, "invalid authorization token");
    }
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new AppError(401, "session expired");
    }

    return payload;
  }
}

export class HostedPrivyTokenVerifier implements PrivyTokenVerifier {
  readonly client: PrivyClient;

  constructor({
    appId,
    appSecret
  }: {
    appId: string;
    appSecret: string;
  }) {
    this.client = new PrivyClient({
      appId,
      appSecret
    });
  }

  async verifyToken(token: string, { allowedChainId }: { allowedChainId?: ChainId } = {}): Promise<PrivyClaims> {
    try {
      const verified = await this.client.utils().auth().verifyAccessToken(token);
      const user = await this.client.users()._get(verified.user_id);
      const walletPrincipal = this.resolveWalletPrincipal(user.linked_accounts, allowedChainId);

      return {
        sub: verified.user_id,
        walletAddress: walletPrincipal.walletAddress,
        chainId: walletPrincipal.chainId,
        iat: verified.issued_at,
        exp: verified.expiration
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(401, "invalid authorization token", {
        detail: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  private resolveWalletPrincipal(
    linkedAccounts: Array<{
      type?: string;
      address?: string;
      chain_id?: string;
      chain_type?: string;
      wallet_client_type?: string;
    }>,
    allowedChainId?: ChainId
  ): WalletPrincipal {
    return resolveHostedWalletPrincipalFromLinkedAccounts(linkedAccounts, allowedChainId);
  }
}

export function resolveHostedWalletPrincipalFromLinkedAccounts(
  linkedAccounts: Array<{
    type?: string;
    address?: string;
    chain_id?: string;
    chain_type?: string;
    wallet_client_type?: string;
  }>,
  allowedChainId?: ChainId
): WalletPrincipal {
  const walletAccounts = linkedAccounts
    .map((account) => {
      if ((account.type !== "wallet" && account.type !== "smart_wallet") || !account.address || !account.chain_id || !account.chain_type) {
        return null;
      }

      const chainId = toCaipChainId(account.chain_type, account.chain_id);
      if (!chainId) {
        return null;
      }

      return {
        walletAddress: normalizeWalletAddressForChain(account.address, chainId),
        chainId,
        chainFamily: account.chain_type,
        walletClientType: account.wallet_client_type
      };
    })
    .filter((account) => account !== null);

  const preferred = (accounts: typeof walletAccounts) =>
    accounts.find((account) => account?.walletClientType === "privy") ?? accounts[0] ?? null;

  const exactMatch = allowedChainId ? preferred(walletAccounts.filter((account) => account?.chainId === allowedChainId)) : null;
  if (exactMatch) {
    return {
      walletAddress: exactMatch.walletAddress,
      chainId: exactMatch.chainId
    };
  }

  if (allowedChainId) {
    const allowedChainFamily = chainFamilyForCaipChainId(allowedChainId);
    const familyMatch = allowedChainFamily
      ? preferred(walletAccounts.filter((account) => account?.chainFamily === allowedChainFamily))
      : null;

    if (familyMatch) {
      return {
        walletAddress: familyMatch.walletAddress,
        chainId: allowedChainId
      };
    }

    throw new AppError(403, "privy user missing wallet on required chain");
  }

  const selected = preferred(walletAccounts);
  if (!selected) {
    throw new AppError(401, "privy user missing linked wallet");
  }

  return {
    walletAddress: selected.walletAddress,
    chainId: selected.chainId
  };
}

export function resolvePlatformPrivyConfig({
  appId,
  appSecret,
  googleOAuthEnabled,
  clientId
}: {
  appId?: string | null;
  appSecret?: string | null;
  googleOAuthEnabled?: boolean | null;
  clientId?: string | null;
}): PlatformPrivyConfig {
  const normalizedAppId = String(appId ?? "").trim();
  const normalizedAppSecret = String(appSecret ?? "").trim();
  const normalizedClientId = String(clientId ?? "").trim();

  if (!normalizedAppId) {
    throw new Error("platform Privy app ID is required");
  }
  if (!normalizedAppSecret) {
    throw new Error("platform Privy app secret is required");
  }
  if (googleOAuthEnabled !== true) {
    throw new Error("platform Privy Google login must be enabled");
  }

  return {
    authProvider: "privy",
    privyAppId: normalizedAppId,
    appSecret: normalizedAppSecret,
    googleOAuthEnabled: true,
    ...(normalizedClientId ? { clientId: normalizedClientId } : {})
  };
}

export function resolvePlatformPrivyConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { allowDevelopmentDefaults = false }: { allowDevelopmentDefaults?: boolean } = {}
) {
  return resolvePlatformPrivyConfig({
    appId: env.CELERIS_PRIVY_APP_ID ?? (allowDevelopmentDefaults ? "cl-dev-privy-app" : undefined),
    appSecret:
      env.PRIVY_APP_SECRET ??
      env.PRIVY_VERIFIER_SECRET ??
      (allowDevelopmentDefaults ? "privy-dev-secret" : undefined),
    googleOAuthEnabled: resolveGoogleOAuthEnabledFromEnv(env, { allowDevelopmentDefaults }),
    clientId: env.CELERIS_PRIVY_CLIENT_ID
  });
}

function resolveGoogleOAuthEnabledFromEnv(
  env: NodeJS.ProcessEnv,
  { allowDevelopmentDefaults }: { allowDevelopmentDefaults: boolean }
) {
  const raw = env.CELERIS_PRIVY_GOOGLE_LOGIN_ENABLED;
  if (raw === undefined) {
    return allowDevelopmentDefaults ? true : undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error("CELERIS_PRIVY_GOOGLE_LOGIN_ENABLED must be 'true' or 'false'");
}

export function createPrivyTestToken(
  {
    subject = "did:privy:test-user",
    walletAddress,
    chainId,
    expiresInSeconds = 60 * 60
  }: {
    subject?: string;
    walletAddress?: WalletAddress;
    chainId?: ChainId;
    expiresInSeconds?: number;
  },
  { secret = "privy-dev-secret" }: { secret?: string } = {}
) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      walletAddress,
      chainId,
      iat: now,
      exp: now + expiresInSeconds
    })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function normalizeWalletAddressForChain(walletAddress: string, chainId?: ChainId | null) {
  const trimmed = walletAddress.trim();
  if (!trimmed) {
    return "";
  }
  if (typeof chainId === "string" && chainId.startsWith("solana:")) {
    return trimmed;
  }
  return trimmed.toLowerCase();
}

function toCaipChainId(chainType: string, chainId: string): ChainId | null {
  if (chainType === "ethereum") {
    return `eip155:${chainId}`;
  }
  if (chainType === "solana") {
    return `solana:${chainId}`;
  }
  return null;
}

function chainFamilyForCaipChainId(chainId: ChainId) {
  if (chainId.startsWith("eip155:")) {
    return "ethereum";
  }
  if (chainId.startsWith("solana:")) {
    return "solana";
  }
  return null;
}
