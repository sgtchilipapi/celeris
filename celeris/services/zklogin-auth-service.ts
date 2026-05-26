import crypto from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  computeZkLoginAddress,
  genAddressSeed,
  generateNonce,
  getExtendedEphemeralPublicKey
} from "@mysten/sui/zklogin";
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
    jwt: string;
    extendedEphemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
    salt: string;
    keyClaimName: "sub";
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
    maxEpoch,
    jwtRandomness
  }: {
    googleIdToken: string;
    allowedChainId: ChainId;
    nonce: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
  }): Promise<VerifiedZkLoginIdentity> {
    if (!googleIdToken) {
      throw new AppError(401, "Google identity token required");
    }

    const resolvedNonce = this.resolveLoginNonce({
      ephemeralPublicKey,
      maxEpoch,
      jwtRandomness
    });
    if (resolvedNonce !== nonce) {
      throw new AppError(401, "hosted login nonce mismatch");
    }

    const claims = await this.googleIdentityTokenVerifier.verifyToken(googleIdToken, {
      expectedNonce: resolvedNonce,
      expectedAudience: this.config.googleClientId,
      expectedIssuer: this.config.googleIssuer
    });
    const externalSubject = this.resolveExternalSubject(claims);
    const userSalt = this.resolveUserSalt(externalSubject);
    const addressSeed = genAddressSeed(userSalt, "sub", claims.sub, claims.aud).toString();
    const walletPrincipal = {
      walletAddress: computeZkLoginAddress({
        claimName: "sub",
        claimValue: claims.sub,
        iss: claims.iss,
        aud: claims.aud,
        userSalt,
        legacyAddress: false
      }),
      chainId: allowedChainId
    };
    const proof = await this.prover.createProof({
      jwt: googleIdToken,
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(new Ed25519PublicKey(ephemeralPublicKey)),
      maxEpoch,
      jwtRandomness,
      salt: userSalt,
      keyClaimName: "sub"
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
    ephemeralPublicKey,
    maxEpoch,
    jwtRandomness
  }: {
    ephemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
  }) {
    return generateNonce(new Ed25519PublicKey(ephemeralPublicKey), maxEpoch, jwtRandomness);
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

    const salt = hexDigestToBigIntString(createDigest(`zklogin:salt:${this.config.zkLoginSaltSeed}:${externalSubject}`));
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

  verifyToken(
    token: string,
    {
      expectedNonce,
      expectedAudience,
      expectedIssuer
    }: { expectedNonce: string; expectedAudience: string; expectedIssuer: string }
  ) {
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
    if (claims.iss !== expectedIssuer || claims.iss !== this.issuer) {
      throw new AppError(401, "unsupported Google issuer");
    }

    return claims;
  }
}

export class GoogleJwksIdentityTokenVerifier implements GoogleIdentityTokenVerifier {
  readonly jwks: Parameters<typeof jwtVerify>[1];

  constructor({ jwksUri, jwks }: { jwksUri?: string; jwks?: Parameters<typeof jwtVerify>[1] }) {
    this.jwks = jwks ?? createRemoteJWKSet(new URL(String(jwksUri)));
  }

  async verifyToken(
    token: string,
    {
      expectedNonce,
      expectedAudience,
      expectedIssuer
    }: { expectedNonce: string; expectedAudience: string; expectedIssuer: string }
  ) {
    try {
      const verified = await jwtVerify(token, this.jwks, {
        issuer: expectedIssuer,
        audience: expectedAudience
      });
      const audience = Array.isArray(verified.payload.aud) ? verified.payload.aud[0] : verified.payload.aud;
      const nonce = typeof verified.payload.nonce === "string" ? verified.payload.nonce : "";
      const subject = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
      const issuer = typeof verified.payload.iss === "string" ? verified.payload.iss : "";

      if (!subject) {
        throw new AppError(401, "Google identity token missing subject");
      }
      if (!audience) {
        throw new AppError(403, "unsupported Google audience");
      }
      if (nonce !== expectedNonce) {
        throw new AppError(401, "hosted login nonce mismatch");
      }

      return {
        sub: subject,
        email: typeof verified.payload.email === "string" ? verified.payload.email : null,
        nonce,
        aud: audience,
        iss: issuer,
        iat: typeof verified.payload.iat === "number" ? verified.payload.iat : undefined,
        exp: typeof verified.payload.exp === "number" ? verified.payload.exp : undefined
      } satisfies GoogleIdentityClaims;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("unexpected \"aud\"")) {
        throw new AppError(403, "unsupported Google audience");
      }
      if (message.includes("unexpected \"iss\"")) {
        throw new AppError(401, "unsupported Google issuer");
      }
      if (message.includes("exp")) {
        throw new AppError(401, "Google identity token expired");
      }
      throw new AppError(401, "invalid Google identity token");
    }
  }
}

export class LocalZkLoginProver implements ZkLoginProver {
  readonly proverOrigin: string;

  constructor({ proverOrigin = "http://localhost:3001" }: { proverOrigin?: string } = {}) {
    this.proverOrigin = proverOrigin;
  }

  createProof(input: {
    jwt: string;
    extendedEphemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
    salt: string;
    keyClaimName: "sub";
  }): ZkLoginProof {
    const proofDigest = createDigest(JSON.stringify(input));
    return {
      proofDigest,
      proverOrigin: this.proverOrigin,
      proofPoints: deriveMockProofPoints(proofDigest),
      issBase64Details: {
        value: Buffer.from("https://accounts.google.com", "utf8").toString("base64"),
        indexMod4: 0
      },
      headerBase64: Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64")
    };
  }
}

export class HttpZkLoginProver implements ZkLoginProver {
  readonly proverOrigin: string;
  readonly fetchImpl: typeof fetch;

  constructor({
    proverOrigin = "http://localhost:3001",
    fetchImpl = fetch
  }: {
    proverOrigin?: string;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.proverOrigin = proverOrigin.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async createProof(input: {
    jwt: string;
    extendedEphemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
    salt: string;
    keyClaimName: "sub";
  }) {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL("/v1", this.proverOrigin), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    } catch (error) {
      throw new AppError(502, "zkLogin prover is unavailable", {
        detail: error instanceof Error ? error.message : String(error)
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppError(502, "zkLogin prover request failed", {
        statusCode: response.status,
        detail: payload?.error ?? payload?.message ?? `HTTP ${response.status}`
      });
    }

    return mapProverResponse(payload, this.proverOrigin);
  }
}

export function resolvePlatformZkLoginConfig({
  googleClientId,
  googleIssuer,
  googleAuthorizeUrl,
  googleJwksUri,
  zkLoginSaltSeed,
  zkLoginMaxEpoch,
  zkLoginProverOrigin
}: {
  googleClientId?: string | null;
  googleIssuer?: string | null;
  googleAuthorizeUrl?: string | null;
  googleJwksUri?: string | null;
  zkLoginSaltSeed?: string | null;
  zkLoginMaxEpoch?: string | number | null;
  zkLoginProverOrigin?: string | null;
}): PlatformZkLoginConfig {
  const normalizedClientId = String(googleClientId ?? "").trim();
  const normalizedIssuer = String(googleIssuer ?? "").trim();
  const normalizedAuthorizeUrl = String(googleAuthorizeUrl ?? "").trim();
  const normalizedJwksUri = String(googleJwksUri ?? "").trim();
  const normalizedSaltSeed = String(zkLoginSaltSeed ?? "").trim();
  const normalizedProverOrigin = String(zkLoginProverOrigin ?? "").trim();
  const parsedMaxEpoch = Number(zkLoginMaxEpoch);

  if (!normalizedClientId) {
    throw new Error("Google client ID is required");
  }
  if (!normalizedIssuer) {
    throw new Error("Google issuer is required");
  }
  if (!normalizedAuthorizeUrl) {
    throw new Error("Google authorize URL is required");
  }
  if (!normalizedJwksUri) {
    throw new Error("Google JWKS URI is required");
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
    googleAuthorizeUrl: normalizedAuthorizeUrl,
    googleJwksUri: normalizedJwksUri,
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
    googleAuthorizeUrl:
      env.CELERIS_GOOGLE_AUTHORIZE_URL ??
      "https://accounts.google.com/o/oauth2/v2/auth",
    googleJwksUri:
      env.CELERIS_GOOGLE_JWKS_URI ??
      "https://www.googleapis.com/oauth2/v3/certs",
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

function deriveMockProofPoints(seed: string) {
  const chunks = seed.match(/.{1,16}/g) ?? [seed];
  const values = Array.from({ length: 8 }, (_, index) => chunks[index] ?? chunks[chunks.length - 1] ?? "0");
  const toField = (value: string) => BigInt(`0x${value.padEnd(16, "0")}`).toString();

  return {
    a: [toField(values[0]), toField(values[1])] as [string, string],
    b: [
      [toField(values[2]), toField(values[3])],
      [toField(values[4]), toField(values[5])]
    ] as [[string, string], [string, string]],
    c: [toField(values[6]), toField(values[7])] as [string, string]
  };
}

function mapProverResponse(payload: any, proverOrigin: string): ZkLoginProof {
  const proofPoints = payload?.proofPoints ?? payload?.proof_points;
  const issBase64Details = payload?.issBase64Details ?? payload?.iss_base64_details;
  const headerBase64 = payload?.headerBase64 ?? payload?.header_base64;

  if (
    !proofPoints?.a ||
    !proofPoints?.b ||
    !proofPoints?.c ||
    typeof issBase64Details?.value !== "string" ||
    typeof issBase64Details?.indexMod4 !== "number" ||
    typeof headerBase64 !== "string"
  ) {
    throw new AppError(502, "zkLogin prover returned an invalid proof payload");
  }

  return {
    proofDigest: createDigest(JSON.stringify(payload)),
    proverOrigin,
    proofPoints: {
      a: [String(proofPoints.a[0] ?? ""), String(proofPoints.a[1] ?? "")],
      b: [
        [String(proofPoints.b[0]?.[0] ?? ""), String(proofPoints.b[0]?.[1] ?? "")],
        [String(proofPoints.b[1]?.[0] ?? ""), String(proofPoints.b[1]?.[1] ?? "")]
      ],
      c: [String(proofPoints.c[0] ?? ""), String(proofPoints.c[1] ?? "")]
    },
    issBase64Details: {
      value: issBase64Details.value,
      indexMod4: issBase64Details.indexMod4
    },
    headerBase64
  };
}

function hexDigestToBigIntString(value: string) {
  const bn254FieldOrder = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
  );
  return (BigInt(`0x${value}`) % bn254FieldOrder).toString();
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
