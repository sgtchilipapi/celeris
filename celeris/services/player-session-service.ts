import crypto from "node:crypto";
import { AppError } from "./errors.js";
import type { HostedAuthConfig, MemoryStore, PlayerSession, WalletPrincipal } from "../types.js";

export interface AuthenticatedPlayerSession {
  sessionId: string;
  projectId: string;
  celerisUserId: string;
  projectUserId: string;
  walletPrincipal: WalletPrincipal;
  expiresAt: string;
}

type SessionTokenPayload = {
  sessionId: string;
  projectId: string;
  exp: number;
};

export class PlayerSessionService {
  readonly store: MemoryStore;
  readonly config: HostedAuthConfig;

  constructor({ store, config }: { store: MemoryStore; config: HostedAuthConfig }) {
    this.store = store;
    this.config = config;
  }

  createPlayerSession({
    projectId,
    celerisUserId,
    projectUserId,
    walletPrincipal,
    expiresInSeconds = 60 * 60 * 8
  }: {
    projectId: string;
    celerisUserId: string;
    projectUserId: string;
    walletPrincipal: WalletPrincipal;
    expiresInSeconds?: number;
  }): { accessToken: string; session: PlayerSession } {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const session: PlayerSession = {
      sessionId: crypto.randomUUID(),
      projectId,
      celerisUserId,
      projectUserId,
      walletAddress: walletPrincipal.walletAddress,
      chainId: walletPrincipal.chainId,
      expiresAt,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.store.createPlayerSession(session);
    return {
      accessToken: this.signToken(session),
      session
    };
  }

  authenticatePlayerSessionToken(token: string, { projectId, allowedChainId }: { projectId?: string; allowedChainId?: string } = {}) {
    if (!token) {
      throw new AppError(401, "authorization token required");
    }

    const claims = this.verifyToken(token);
    const session = this.store.playerSessions.get(claims.sessionId);
    if (!session || session.revokedAt) {
      throw new AppError(401, "invalid authorization token");
    }
    if (session.expiresAt <= new Date().toISOString()) {
      throw new AppError(401, "session expired");
    }
    if (projectId && session.projectId !== projectId) {
      throw new AppError(403, "session not valid for project");
    }
    if (allowedChainId && session.chainId !== allowedChainId) {
      throw new AppError(403, "unsupported chain");
    }

    return {
      sessionId: session.sessionId,
      projectId: session.projectId,
      celerisUserId: session.celerisUserId,
      projectUserId: session.projectUserId,
      walletPrincipal: {
        walletAddress: session.walletAddress,
        chainId: session.chainId
      },
      expiresAt: session.expiresAt
    } satisfies AuthenticatedPlayerSession;
  }

  revokeSession(sessionId: string) {
    const session = this.store.playerSessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.revokedAt = new Date().toISOString();
    this.store.savePlayerSession(session);
    return true;
  }

  private signToken(session: PlayerSession) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sessionId: session.sessionId,
        projectId: session.projectId,
        exp: Math.floor(new Date(session.expiresAt).getTime() / 1000)
      } satisfies SessionTokenPayload)
    ).toString("base64url");
    const signature = crypto.createHmac("sha256", this.config.sessionSecret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  private verifyToken(token: string): SessionTokenPayload {
    const [encodedHeader, encodedPayload, providedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !providedSignature) {
      throw new AppError(401, "invalid authorization token");
    }

    const expectedSignature = crypto
      .createHmac("sha256", this.config.sessionSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    if (providedSignature !== expectedSignature) {
      throw new AppError(401, "invalid authorization token");
    }

    let payload: SessionTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionTokenPayload;
    } catch {
      throw new AppError(401, "invalid authorization token");
    }

    if (!payload.sessionId || !payload.projectId || typeof payload.exp !== "number") {
      throw new AppError(401, "invalid authorization token");
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new AppError(401, "session expired");
    }
    return payload;
  }
}
