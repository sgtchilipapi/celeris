import crypto from "node:crypto";
import { AppError } from "./errors.js";

export class AuthService {
  constructor({ store, jwtSecret = "dev-secret", sessionTtlSeconds = 60 * 60 * 24 * 7 }) {
    this.store = store;
    this.jwtSecret = jwtSecret;
    this.sessionTtlSeconds = sessionTtlSeconds;
  }

  createSession({ provider = "dummy", email, idempotencyKey }) {
    const normalizedProvider = provider.toLowerCase();
    const identity = this.#resolveIdentity({ provider: normalizedProvider, email });
    const cached = this.store.getIdempotent(`session:${identity.subject}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    const user =
      this.store.findUserByExternalSubject(identity.subject) ??
      this.store.findUserByEmail(identity.email) ??
      this.store.createUser({ externalSubject: identity.subject, email: identity.email });

    const sessionId = crypto.randomUUID();
    const token = this.#signToken({
      userId: user.userId,
      provider: identity.provider,
      sessionId
    });
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000).toISOString();
    this.store.createUserSession({
      sessionId,
      userId: user.userId,
      provider: identity.provider,
      token,
      expiresAt
    });

    const session = {
      userId: user.userId,
      token
    };
    this.store.setIdempotent(`session:${identity.subject}`, idempotencyKey, session);
    return session;
  }

  #resolveIdentity({ provider, email }) {
    if (provider !== "dummy") {
      throw new AppError(400, `unsupported auth provider: ${provider}`);
    }
    if (!email || !email.includes("@")) {
      throw new AppError(400, "dummy login requires a valid email");
    }
    const normalizedEmail = email.trim().toLowerCase();
    return {
      provider,
      email: normalizedEmail,
      subject: `dummy:${normalizedEmail}`
    };
  }

  #signToken({ userId, provider, sessionId }) {
    const header = this.#toBase64Url({ alg: "HS256", typ: "JWT" });
    const now = Math.floor(Date.now() / 1000);
    const payload = this.#toBase64Url({
      sub: userId,
      jti: sessionId,
      iss: "celeris",
      aud: "player",
      provider,
      iat: now,
      exp: now + this.sessionTtlSeconds
    });
    const signature = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  #toBase64Url(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
}
