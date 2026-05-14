import crypto from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { AppError } from "./errors.js";
import type {
  ChainId,
  GoogleIdentityClaims,
  GoogleIdentityTokenVerifier,
  MemoryStore,
  PlatformZkLoginConfig,
  WalletPrincipal,
  ZkLoginProof,
  ZkLoginSessionMaterial
} from "../types.js";

export interface VerifiedZkLoginIdentity {
  externalSubject: string;
  email: string | null;
  walletPrincipal: WalletPrincipal;
  zkLogin: ZkLoginSessionMaterial;
}

export interface ZkLoginProver {
  createProof(input: {
    issuer: string;
    audience: string;
    subject: string;
    nonce: string;
    userSalt: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
    addressSeed: string;
  }): ZkLoginProof | Promise<ZkLoginProof>;
}

export class ZkLoginAuthService {
  readonly store: MemoryStore;
  readonly config: PlatformZkLoginConfig;
  readonly googleIdentityTokenVerifier: GoogleIdentityTokenVerifier;
  readonly prover: ZkLoginProver;

  constructor({
    store,
    config,
    googleIdentityTokenVerifier,
    prover
  }: {
    store: MemoryStore;
    config: PlatformZkLoginConfig;
    googleIdentityTokenVerifier: GoogleIdentityTokenVerifier;
    prover: ZkLoginProver;
  }) {
    this.store = store;
    this.config = config;
    this.googleIdentityTokenVerifier = googleIdentityTokenVerifier;
    this.prover = prover;
  }

  async resolveVerifiedIdentity({
    googleIdToken,
    allowedChainId,
    nonce,
    ephemeralPublicKey,
    maxEpoch
  }: {
    googleIdToken: string;
    allowedChainId: ChainId;
    nonce: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
  }): Promise<VerifiedZkLoginIdentity> {
    if (!googleIdToken) {
      throw new AppError(401, "Google identity token required");
    }

    const claims = await this.googleIdentityTokenVerifier.verifyToken(googleIdToken, {
      expectedNonce: nonce,
      expectedAudience: this.config.googleClientId
    });
    const externalSubject = this.resolveExternalSubject(claims);
    const userSalt = this.resolveUserSalt(externalSubject);
    const addressSeed = deriveAddressSeed({
      issuer: claims.iss,
      audience: claims.aud,
      subject: claims.sub,
      salt: userSalt
    });
    const walletPrincipal = {
      walletAddress: deriveZkLoginWalletAddress(addressSeed),
      chainId: allowedChainId
    };
    const proof = await this.prover.createProof({
      issuer: claims.iss,
      audience: claims.aud,
      subject: claims.sub,
      nonce,
      userSalt,
      ephemeralPublicKey,
      maxEpoch,
      addressSeed
    });

    return {
      externalSubject,
      email: typeof claims.email === "string" ? claims.email : null,
      walletPrincipal,
      zkLogin: {
        nonce,
        ephemeralPublicKey,
        maxEpoch,
        userSalt,
        issuer: claims.iss,
        audience: claims.aud,
        subject: claims.sub,
        addressSeed,
        proof
      }
    };
  }

  resolveLoginNonce({
    loginRequestId,
    ephemeralPublicKey,
    maxEpoch
  }: {
    loginRequestId: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
  }) {
    return createDigest(`zklogin:nonce:${loginRequestId}:${ephemeralPublicKey}:${maxEpoch}`);
  }

  private resolveExternalSubject(claims: GoogleIdentityClaims) {
    const normalized = String(claims.sub ?? "").trim();
    if (!normalized) {
      throw new AppError(401, "Google identity token missing subject");
    }
    return `${claims.iss}:${normalized}`;
  }

  private resolveUserSalt(externalSubject: string) {
    const existing = this.store.getZkLoginUserSalt(externalSubject);
    if (existing) {
      return existing.salt;
    }

    const salt = createDigest(`zklogin:salt:${this.config.zkLoginSaltSeed}:${externalSubject}`);
    this.store.saveZkLoginUserSalt({
      externalSubject,
      salt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return salt;
  }
}

export class LocalGoogleIdentityTokenVerifier implements GoogleIdentityTokenVerifier {
  readonly secret: string;
  readonly issuer: string;

  constructor({
    secret = "google-dev-secret",
    issuer = "https://accounts.google.com"
  }: {
    secret?: string;
    issuer?: string;
  } = {}) {
    this.secret = secret;
    this.issuer = issuer;
  }

  verifyToken(token: string, { expectedNonce, expectedAudience }: { expectedNonce: string; expectedAudience: string }) {
    const claims = verifyHmacBackedToken(token, this.secret) as unknown as GoogleIdentityClaims;

    if (!claims.sub) {
      throw new AppError(401, "Google identity token missing subject");
    }
    if (claims.nonce !== expectedNonce) {
      throw new AppError(401, "hosted login nonce mismatch");
    }
    if (claims.aud !== expectedAudience) {
      throw new AppError(403, "unsupported Google audience");
    }
    if (claims.iss !== this.issuer) {
      throw new AppError(401, "unsupported Google issuer");
    }

    return claims;
  }
}

export class LocalZkLoginProver implements ZkLoginProver {
  readonly proverOrigin: string;

  constructor({ proverOrigin = "http://localhost:3001" }: { proverOrigin?: string } = {}) {
    this.proverOrigin = proverOrigin;
  }

  createProof(input: {
    issuer: string;
    audience: string;
    subject: string;
    nonce: string;
    userSalt: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
    addressSeed: string;
  }): ZkLoginProof {
    return {
      proofDigest: createDigest(JSON.stringify(input)),
      proverOrigin: this.proverOrigin
    };
  }
}

export function resolvePlatformZkLoginConfig({
  googleClientId,
  googleIssuer,
  googleVerifierSecret,
  zkLoginSaltSeed,
  zkLoginMaxEpoch,
  zkLoginProverOrigin
}: {
  googleClientId?: string | null;
  googleIssuer?: string | null;
  googleVerifierSecret?: string | null;
  zkLoginSaltSeed?: string | null;
  zkLoginMaxEpoch?: string | number | null;
  zkLoginProverOrigin?: string | null;
}): PlatformZkLoginConfig {
  const normalizedClientId = String(googleClientId ?? "").trim();
  const normalizedIssuer = String(googleIssuer ?? "").trim();
  const normalizedVerifierSecret = String(googleVerifierSecret ?? "").trim();
  const normalizedSaltSeed = String(zkLoginSaltSeed ?? "").trim();
  const normalizedProverOrigin = String(zkLoginProverOrigin ?? "").trim();
  const parsedMaxEpoch = Number(zkLoginMaxEpoch);

  if (!normalizedClientId) {
    throw new Error("Google client ID is required");
  }
  if (!normalizedIssuer) {
    throw new Error("Google issuer is required");
  }
  if (!normalizedVerifierSecret) {
    throw new Error("Google verifier secret is required");
  }
  if (!normalizedSaltSeed) {
    throw new Error("zkLogin salt seed is required");
  }
  if (!Number.isFinite(parsedMaxEpoch) || parsedMaxEpoch <= 0) {
    throw new Error("zkLogin max epoch is required");
  }
  if (!normalizedProverOrigin) {
    throw new Error("zkLogin prover origin is required");
  }

  return {
    authProvider: "zklogin",
    googleClientId: normalizedClientId,
    googleIssuer: normalizedIssuer,
    googleVerifierSecret: normalizedVerifierSecret,
    zkLoginSaltSeed: normalizedSaltSeed,
    zkLoginMaxEpoch: parsedMaxEpoch,
    zkLoginProverOrigin: normalizedProverOrigin
  };
}

export function resolvePlatformZkLoginConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { allowDevelopmentDefaults = false }: { allowDevelopmentDefaults?: boolean } = {}
) {
  return resolvePlatformZkLoginConfig({
    googleClientId: env.CELERIS_GOOGLE_CLIENT_ID ?? (allowDevelopmentDefaults ? "google-client-dev" : undefined),
    googleIssuer: env.CELERIS_GOOGLE_ISSUER ?? "https://accounts.google.com",
    googleVerifierSecret: env.CELERIS_GOOGLE_VERIFIER_SECRET ?? (allowDevelopmentDefaults ? "google-dev-secret" : undefined),
    zkLoginSaltSeed: env.CELERIS_ZKLOGIN_SALT_SEED ?? (allowDevelopmentDefaults ? "zklogin-salt-dev-seed" : undefined),
    zkLoginMaxEpoch: env.CELERIS_ZKLOGIN_MAX_EPOCH ?? (allowDevelopmentDefaults ? "30" : undefined),
    zkLoginProverOrigin: env.CELERIS_ZKLOGIN_PROVER_ORIGIN ?? (allowDevelopmentDefaults ? "http://localhost:3001" : undefined)
  });
}

export function createGoogleTestIdToken(
  {
    subject = "google-test-user",
    email = "player@example.com",
    nonce,
    audience = "google-client-dev",
    issuer = "https://accounts.google.com",
    expiresInSeconds = 60 * 5
  }: {
    subject?: string;
    email?: string;
    nonce: string;
    audience?: string;
    issuer?: string;
    expiresInSeconds?: number;
  },
  { secret = "google-dev-secret" }: { secret?: string } = {}
) {
  return createHmacBackedToken(
    {
      sub: subject,
      email,
      nonce,
      aud: audience,
      iss: issuer,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    } satisfies GoogleIdentityClaims,
    secret
  );
}

function deriveAddressSeed({
  issuer,
  audience,
  subject,
  salt
}: {
  issuer: string;
  audience: string;
  subject: string;
  salt: string;
}) {
  return createDigest(`${issuer}:${audience}:${subject}:${salt}`);
}

function deriveZkLoginWalletAddress(addressSeed: string) {
  return normalizeSuiAddress(`0x${addressSeed}`);
}

function createDigest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createHmacBackedToken(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${encodedPayload}`).digest("base64url");
  return `${header}.${encodedPayload}.${signature}`;
}

function verifyHmacBackedToken(token: string, secret: string) {
  const [encodedHeader, encodedPayload, providedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !providedSignature) {
    throw new AppError(401, "invalid Google identity token");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  if (providedSignature !== expectedSignature) {
    throw new AppError(401, "invalid Google identity token");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new AppError(401, "invalid Google identity token");
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError(401, "Google identity token expired");
  }

  return payload;
}
