import crypto from "node:crypto";
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

export class PrivyAuthService {
  readonly store: MemoryStore;
  readonly verifier: PrivyTokenVerifier;

  constructor({ store, verifier }: { store: MemoryStore; verifier: PrivyTokenVerifier }) {
    this.store = store;
    this.verifier = verifier;
  }

  authenticatePlayerToken(token: string, { allowedChainId }: { allowedChainId?: ChainId } = {}): AuthenticatedPlayer {
    if (!token) {
      throw new AppError(401, "authorization token required");
    }

    const claims = this.verifier.verifyToken(token);
    const walletPrincipal = this.resolveWalletPrincipal(claims);
    if (allowedChainId && walletPrincipal.chainId !== allowedChainId) {
      throw new AppError(403, "unsupported chain");
    }

    const user = this.store.findUserByExternalSubject(this.subjectForWallet(walletPrincipal)) ?? this.store.createUser({
      externalSubject: this.subjectForWallet(walletPrincipal),
      email: null
    });

    return {
      userId: user.userId,
      walletPrincipal
    };
  }

  private resolveWalletPrincipal(claims: PrivyClaims): WalletPrincipal {
    const walletAddress = this.normalizeWalletAddress(claims.walletAddress);
    const chainId = this.normalizeChainId(claims.chainId);

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

  private normalizeWalletAddress(walletAddress?: string | null): WalletAddress | null {
    if (typeof walletAddress !== "string") {
      return null;
    }
    const normalized = walletAddress.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  private normalizeChainId(chainId?: string | null): ChainId | null {
    if (typeof chainId !== "string") {
      return null;
    }
    const normalized = chainId.trim();
    return normalized ? normalized : null;
  }

  private subjectForWallet({ walletAddress, chainId }: WalletPrincipal) {
    return `privy-wallet:${chainId}:${walletAddress}`;
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

export function resolvePlatformPrivyConfig({
  appId,
  verifierSecret
}: {
  appId?: string | null;
  verifierSecret?: string | null;
}): PlatformPrivyConfig {
  const normalizedAppId = String(appId ?? "").trim();
  const normalizedVerifierSecret = String(verifierSecret ?? "").trim();

  if (!normalizedAppId) {
    throw new Error("platform Privy app ID is required");
  }
  if (!normalizedVerifierSecret) {
    throw new Error("platform Privy verifier secret is required");
  }

  return {
    authProvider: "privy",
    privyAppId: normalizedAppId,
    verifierSecret: normalizedVerifierSecret
  };
}

export function resolvePlatformPrivyConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return resolvePlatformPrivyConfig({
    appId: env.CELERIS_PRIVY_APP_ID ?? "cl-dev-privy-app",
    verifierSecret: env.PRIVY_VERIFIER_SECRET ?? "privy-dev-secret"
  });
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
