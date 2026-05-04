import crypto, { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  AuthCodeExchangeResponse,
  AuthLoginRequestResponse,
  CompleteHostedLoginWithPrivyTokenRequest,
  HostedAuthConfig,
  MemoryStore,
  WalletPrincipal
} from "../types.js";
import type { PrivyAuthService } from "./privy-auth-service.js";
import type { PlayerSessionService } from "./player-session-service.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    throw new AppError(400, "invalid origin");
  }
}

function normalizeRedirectUri(redirectUri: string) {
  try {
    return new URL(redirectUri).toString();
  } catch {
    throw new AppError(400, "invalid redirectUri");
  }
}

export class AuthGatewayService {
  readonly store: MemoryStore;
  readonly privyAuthService: PrivyAuthService;
  readonly playerSessionService: PlayerSessionService;
  readonly config: HostedAuthConfig;

  constructor({
    store,
    privyAuthService,
    playerSessionService,
    config
  }: {
    store: MemoryStore;
    privyAuthService: PrivyAuthService;
    playerSessionService: PlayerSessionService;
    config: HostedAuthConfig;
  }) {
    this.store = store;
    this.privyAuthService = privyAuthService;
    this.playerSessionService = playerSessionService;
    this.config = config;
  }

  createLoginRequest({
    projectId,
    origin,
    redirectUri,
    codeChallenge
  }: {
    projectId: string;
    origin: string;
    redirectUri: string;
    codeChallenge: string;
  }): AuthLoginRequestResponse {
    const app = this.store.apps.get(projectId);
    if (!app) {
      throw new AppError(404, "project not found");
    }

    const playerPolicy = this.store.appPlayerPolicies.get(projectId);
    if (!playerPolicy) {
      throw new AppError(404, "app player policy not found");
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const normalizedRedirectUri = normalizeRedirectUri(redirectUri);
    const normalizedCodeChallenge = normalizeCodeChallenge(codeChallenge);
    if (!playerPolicy.allowedFrontendOrigins.includes(normalizedOrigin)) {
      throw new AppError(403, "origin not allowed");
    }
    if (!playerPolicy.allowedRedirectUris.includes(normalizedRedirectUri)) {
      throw new AppError(403, "redirectUri not allowed");
    }

    const loginRequest = this.store.createLoginRequest({
      loginRequestId: randomUUID(),
      projectId,
      origin: normalizedOrigin,
      redirectUri: normalizedRedirectUri,
      codeChallenge: normalizedCodeChallenge,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      consumedAt: null,
      createdAt: nowIso()
    });

    return {
      loginRequestId: loginRequest.loginRequestId,
      hostedLoginUrl: `${this.config.hostedAuthOrigin}/auth/login?loginRequestId=${encodeURIComponent(loginRequest.loginRequestId)}`,
      expiresAt: loginRequest.expiresAt
    };
  }

  getLoginRequest(loginRequestId: string) {
    const loginRequest = this.store.loginRequests.get(loginRequestId);
    if (!loginRequest) {
      throw new AppError(404, "login request not found");
    }
    return loginRequest;
  }

  async completeHostedLoginWithPrivyToken({
    loginRequestId,
    privyAccessToken
  }: CompleteHostedLoginWithPrivyTokenRequest): Promise<{
    code: string;
    origin: string;
    redirectUri: string;
    projectId: string;
    player: WalletPrincipal;
  }> {
    const loginRequest = this.getLoginRequest(loginRequestId);
    if (loginRequest.expiresAt <= nowIso()) {
      throw new AppError(401, "login request expired");
    }
    if (loginRequest.consumedAt) {
      throw new AppError(409, "login request already consumed");
    }

    const playerPolicy = this.store.appPlayerPolicies.get(loginRequest.projectId);
    if (!playerPolicy) {
      throw new AppError(404, "app player policy not found");
    }

    const verifiedIdentity = await this.privyAuthService.resolveVerifiedToken(privyAccessToken, {
      allowedChainId: playerPolicy.allowedChainId
    });

    const celerisUser = this.store.upsertCelerisUser({
      externalSubject: verifiedIdentity.externalSubject,
      walletAddress: verifiedIdentity.walletPrincipal.walletAddress,
      chainId: verifiedIdentity.walletPrincipal.chainId
    });
    const projectUser = this.store.upsertProjectUser({
      projectId: loginRequest.projectId,
      celerisUserId: celerisUser.celerisUserId,
      walletAddress: verifiedIdentity.walletPrincipal.walletAddress,
      chainId: verifiedIdentity.walletPrincipal.chainId
    });

    loginRequest.consumedAt = nowIso();
    this.store.saveLoginRequest(loginRequest);

    const authCode = this.store.createAuthCode({
      codeId: randomUUID(),
      loginRequestId: loginRequest.loginRequestId,
      projectId: loginRequest.projectId,
      celerisUserId: celerisUser.celerisUserId,
      projectUserId: projectUser.projectUserId,
      walletAddress: verifiedIdentity.walletPrincipal.walletAddress,
      chainId: verifiedIdentity.walletPrincipal.chainId,
      codeChallenge: loginRequest.codeChallenge,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      consumedAt: null,
      createdAt: nowIso()
    });

    return {
      code: authCode.codeId,
      origin: loginRequest.origin,
      redirectUri: loginRequest.redirectUri,
      projectId: loginRequest.projectId,
      player: verifiedIdentity.walletPrincipal
    };
  }

  exchangeAuthorizationCode(code: string, codeVerifier: string): AuthCodeExchangeResponse {
    const authCode = this.store.authCodes.get(code);
    if (!authCode) {
      throw new AppError(401, "invalid authorization code");
    }
    if (authCode.expiresAt <= nowIso()) {
      throw new AppError(401, "authorization code expired");
    }
    if (authCode.consumedAt) {
      throw new AppError(409, "authorization code already consumed");
    }
    if (!verifyCodeChallenge(codeVerifier, authCode.codeChallenge)) {
      throw new AppError(401, "invalid authorization code verifier");
    }

    authCode.consumedAt = nowIso();
    this.store.saveAuthCode(authCode);

    const session = this.playerSessionService.createPlayerSession({
      projectId: authCode.projectId,
      celerisUserId: authCode.celerisUserId,
      projectUserId: authCode.projectUserId,
      walletPrincipal: {
        walletAddress: authCode.walletAddress,
        chainId: authCode.chainId
      }
    });

    return {
      accessToken: session.accessToken,
      expiresAt: session.session.expiresAt,
      player: {
        walletAddress: authCode.walletAddress,
        chainId: authCode.chainId
      },
      projectId: authCode.projectId,
      celerisUserId: authCode.celerisUserId,
      projectUserId: authCode.projectUserId
    };
  }
}

function normalizeCodeChallenge(codeChallenge: string) {
  const normalized = String(codeChallenge ?? "").trim();
  if (!normalized) {
    throw new AppError(400, "codeChallenge is required");
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(normalized)) {
    throw new AppError(400, "invalid codeChallenge");
  }
  return normalized;
}

function verifyCodeChallenge(codeVerifier: string, expectedCodeChallenge: string) {
  const normalizedVerifier = String(codeVerifier ?? "").trim();
  if (!normalizedVerifier) {
    throw new AppError(400, "codeVerifier is required");
  }
  const computedChallenge = crypto.createHash("sha256").update(normalizedVerifier).digest("base64url");
  return computedChallenge === expectedCodeChallenge;
}

export function normalizeAllowedOrigins(origins: string[] | undefined, fallbackOrigin: string) {
  const values = origins && origins.length > 0 ? origins : [fallbackOrigin];
  return [...new Set(values.map(normalizeOrigin))];
}

export function normalizeAllowedRedirectUris(redirectUris: string[] | undefined, fallbackRedirectUri: string) {
  const values = redirectUris && redirectUris.length > 0 ? redirectUris : [fallbackRedirectUri];
  return [...new Set(values.map(normalizeRedirectUri))];
}
