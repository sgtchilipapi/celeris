import crypto from "node:crypto";
import { AppError } from "./errors.js";
import type { HostedAuthConfig, MemoryStore } from "../types.js";

type DeveloperSessionTokenPayload = {
  sessionType: "developer";
  developerId: string;
  exp: number;
};

export interface AuthenticatedDeveloperSession {
  developerId: string;
  expiresAt: string;
}

export class DeveloperSessionService {
  readonly store: MemoryStore;
  readonly config: HostedAuthConfig;

  constructor({ store, config }: { store: MemoryStore; config: HostedAuthConfig }) {
    this.store = store;
    this.config = config;
  }

  createDeveloperSession({ developerId, expiresInSeconds = 60 * 60 * 8 }: { developerId: string; expiresInSeconds?: number }) {
    const developer = this.store.developers.get(developerId);
    if (!developer) {
      throw new AppError(404, "developer not found");
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const accessToken = this.signToken({
      sessionType: "developer",
      developerId,
      exp: Math.floor(new Date(expiresAt).getTime() / 1000)
    });

    return {
      accessToken,
      expiresAt
    };
  }

  authenticateDeveloperSessionToken(token: string): AuthenticatedDeveloperSession {
    if (!token) {
      throw new AppError(401, "authorization token required");
    }

    const payload = this.verifyToken(token);
    if (!this.store.developers.has(payload.developerId)) {
      throw new AppError(401, "invalid authorization token");
    }

    return {
      developerId: payload.developerId,
      expiresAt: new Date(payload.exp * 1000).toISOString()
    };
  }

  private signToken(payload: DeveloperSessionTokenPayload) {
    const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.config.sessionSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): DeveloperSessionTokenPayload {
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

    let payload: DeveloperSessionTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DeveloperSessionTokenPayload;
    } catch {
      throw new AppError(401, "invalid authorization token");
    }

    if (payload.sessionType !== "developer" || !payload.developerId || typeof payload.exp !== "number") {
      throw new AppError(401, "invalid authorization token");
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new AppError(401, "session expired");
    }

    return payload;
  }
}
