import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { buildServices, resolveHostedAuthConfigFromEnv, resolveRuntimePlatformZkLoginConfig } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createBrowserClient } from "../sdk/browser-client.js";
import { createGoogleTestIdToken, resolvePlatformZkLoginConfig } from "../services/zklogin-auth-service.js";
import { createDeveloperApp, signUpDeveloper } from "./helpers/developer.js";

function resolveGoogleVerifierSecret() {
  return process.env.CELERIS_GOOGLE_VERIFIER_SECRET ?? "google-dev-secret";
}

function createFetchBridge(api: ReturnType<typeof createApi>): typeof fetch {
  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const resolvedUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await api.handle({
      method: init?.method ?? "GET",
      url: new URL(resolvedUrl, "http://localhost").pathname.replace(/^\/api/, "") || "/",
      headers,
      body
    });
    return new Response(JSON.stringify(response.body), {
      status: response.statusCode,
      headers: response.headers
    });
  };
}

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    dump() {
      return new Map(values);
    }
  };
}

function createWindowStub({
  href,
  storage,
  sessionStorage,
  opener = null,
  onAssign,
  onReplaceState,
  onClose
}: {
  href: string;
  storage: ReturnType<typeof createMemoryStorage>;
  sessionStorage: ReturnType<typeof createMemoryStorage>;
  opener?: { postMessage?: (message: any, targetOrigin: string) => void } | null;
  onAssign?: (url: string) => void;
  onReplaceState?: (url?: string | URL | null) => void;
  onClose?: () => void;
}) {
  const locationUrl = new URL(href);
  return {
    location: {
      href: locationUrl.toString(),
      origin: locationUrl.origin,
      pathname: locationUrl.pathname,
      search: locationUrl.search,
      assign(url: string) {
        onAssign?.(url);
      }
    },
    localStorage: storage,
    sessionStorage,
    opener,
    history: {
      replaceState(_data: unknown, _unused: string, url?: string | URL | null) {
        onReplaceState?.(url);
      }
    },
    close() {
      onClose?.();
    }
  };
}

function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

async function createGatewayApp(
  api: ReturnType<typeof createApi>,
  services: ReturnType<typeof buildServices>,
  {
    name,
    allowedChainId = "sui:testnet",
    allowedFrontendOrigins,
    allowedRedirectUris
  }: {
    name: string;
    allowedChainId?: string;
    allowedFrontendOrigins?: string[];
    allowedRedirectUris?: string[];
  }
) {
  const developer = await signUpDeveloper({ api, developerId: services.defaultDeveloper.developerId });
  return createDeveloperApp({
    api,
    accessToken: developer.accessToken,
    name,
    priceCents: 499,
    credits: 500,
    allowedChainId,
    allowedFrontendOrigins,
    allowedRedirectUris
  });
}

test("login-request creation enforces project existence, origin/redirect allowlists, and zkLogin request state", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, {
    name: "Gateway App",
    allowedFrontendOrigins: ["http://localhost:3002"],
    allowedRedirectUris: ["http://localhost:3002/auth/callback"]
  });

  const { codeChallenge } = createPkcePair();
  const missingProject = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: "missing-project",
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });
  const badOrigin = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://evil.local" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });
  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });

  assert.equal(missingProject.statusCode, 404);
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(created.statusCode, 201);
  assert.match(created.body.zkLoginNonce, /^[a-f0-9]{64}$/);
  const stored = services.store.loginRequests.get(created.body.loginRequestId)!;
  assert.equal(stored.zkLoginNonce, created.body.zkLoginNonce);
  assert.equal(stored.zkLoginMaxEpoch, 30);
});

test("hosted auth rejects nonce mismatch and expired login state", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, { name: "Gateway App Two" });
  const { codeChallenge } = createPkcePair();
  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });
  const loginRequest = services.store.loginRequests.get(created.body.loginRequestId)!;
  const expired = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "google_identity_token",
      loginRequestId: created.body.loginRequestId,
      googleIdToken: createGoogleTestIdToken({
        nonce: created.body.zkLoginNonce,
        audience: "google-client-dev"
      }, {
        secret: resolveGoogleVerifierSecret()
      })
    }
  });
  assert.equal(expired.statusCode, 200);

  const second = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });
  const mismatch = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "google_identity_token",
      loginRequestId: second.body.loginRequestId,
      googleIdToken: createGoogleTestIdToken({
        nonce: "bad-nonce",
        audience: "google-client-dev"
      }, {
        secret: resolveGoogleVerifierSecret()
      })
    }
  });

  loginRequest.expiresAt = new Date(Date.now() - 1000).toISOString();
  services.store.saveLoginRequest(loginRequest);
  const expiredAttempt = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "google_identity_token",
      loginRequestId: loginRequest.loginRequestId,
      googleIdToken: createGoogleTestIdToken({
        nonce: loginRequest.zkLoginNonce,
        audience: "google-client-dev"
      }, {
        secret: resolveGoogleVerifierSecret()
      })
    }
  });

  assert.equal(mismatch.statusCode, 401);
  assert.equal(mismatch.body.error, "hosted login nonce mismatch");
  assert.equal(expiredAttempt.statusCode, 401);
  assert.equal(expiredAttempt.body.error, "login request expired");
});

test("repeat login for the same Google subject resolves the same zkLogin wallet address", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, { name: "Repeat Login App" });
  const subject = "google-repeat-user";
  const results: string[] = [];

  for (const iteration of [1, 2]) {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const created = await api.handle({
      method: "POST",
      url: "/v1/auth/login-requests",
      headers: { origin: "http://localhost:3002" },
      body: {
        projectId: app.appId,
        redirectUri: "http://localhost:3002/auth/callback",
        codeChallenge,
        zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
      }
    });
    const completed = await api.handle({
      method: "POST",
      url: "/v1/auth/token",
      body: {
        grantType: "google_identity_token",
        loginRequestId: created.body.loginRequestId,
        googleIdToken: createGoogleTestIdToken({
          subject,
          nonce: created.body.zkLoginNonce,
          audience: "google-client-dev"
        }, {
          secret: resolveGoogleVerifierSecret()
        })
      }
    });
    const exchanged = await api.handle({
      method: "POST",
      url: "/v1/auth/token",
      body: {
        grantType: "authorization_code",
        code: completed.body.code,
        codeVerifier
      }
    });
    assert.equal(exchanged.statusCode, 200, `repeat login iteration ${iteration} should exchange successfully`);
    results.push(exchanged.body.player.walletAddress as string);
  }

  assert.equal(results[0], results[1]);
});

test("browser SDK popup login stores zkLogin ephemeral material in session storage only", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, {
    name: "Gateway SDK App",
    allowedFrontendOrigins: ["http://localhost:3002"],
    allowedRedirectUris: ["http://localhost:3002/auth/callback"]
  });
  const fetchImpl = createFetchBridge(api);
  const storage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();

  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: app.appId as string,
    fetchImpl,
    auth: {
      frontendOrigin: "http://localhost:3002",
      redirectUri: "http://localhost:3002/auth/callback",
      storage,
      sessionStorage,
      window: createWindowStub({
        href: "http://localhost:3002/",
        storage,
        sessionStorage
      }),
      openPopup: () => ({ close() {} }),
      waitForMessage: async (expectedOrigin) => {
        const created = [...services.store.loginRequests.values()].slice(-1)[0]!;
        const pendingLogin = JSON.parse(sessionStorage.getItem(`celeris-player-session:${app.appId}:pending-login`) ?? "{}");
        const completed = await api.handle({
          method: "POST",
          url: "/v1/auth/token",
          body: {
            grantType: "google_identity_token",
            loginRequestId: created.loginRequestId,
            googleIdToken: createGoogleTestIdToken({
              subject: "popup-login-user",
              nonce: created.zkLoginNonce,
              audience: "google-client-dev"
            }, {
              secret: resolveGoogleVerifierSecret()
            })
          }
        });
        const exchanged = await api.handle({
          method: "POST",
          url: "/v1/auth/token",
          body: {
            grantType: "authorization_code",
            code: completed.body.code,
            codeVerifier: pendingLogin.codeVerifier
          }
        });

        return {
          origin: expectedOrigin,
          data: {
            type: "celeris-auth-callback",
            state: pendingLogin.state,
            status: "success",
            session: exchanged.body
          }
        };
      }
    }
  });

  const session = await client.auth.login({ mode: "popup" });
  assert.ok(session);
  assert.equal(session?.player.chainId, "sui:testnet");
  assert.equal(storage.getItem(`celeris-player-session:${app.appId}:zklogin-session`), null);
  assert.ok(sessionStorage.getItem(`celeris-player-session:${app.appId}:zklogin-session`));
});

test("hosted auth page and bundle no longer reference Privy", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, { name: "Hosted Auth Copy App" });
  const { codeChallenge } = createPkcePair();
  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: { ephemeralPublicKey: crypto.randomBytes(32).toString("base64url"), maxEpoch: 30 }
    }
  });

  const loginPage = await api.handle({
    method: "GET",
    url: `/auth/login?loginRequestId=${encodeURIComponent(created.body.loginRequestId)}`
  });
  const authBundle = await api.handle({
    method: "GET",
    url: "/auth/client.js"
  });

  assert.equal(loginPage.statusCode, 200);
  assert.equal(authBundle.statusCode, 200);
  assert.doesNotMatch(String(loginPage.body), /Privy/i);
  assert.doesNotMatch(String(authBundle.body), /Privy/i);
});

test("zkLogin config loading fails closed when required values are missing", () => {
  assert.deepEqual(resolveRuntimePlatformZkLoginConfig({ NODE_TEST_CONTEXT: "1" }), {
    authProvider: "zklogin",
    googleClientId: "google-client-dev",
    googleIssuer: "https://accounts.google.com",
    googleVerifierSecret: "google-dev-secret",
    zkLoginSaltSeed: "zklogin-salt-dev-seed",
    zkLoginMaxEpoch: 30,
    zkLoginProverOrigin: "http://localhost:3001"
  });
  assert.throws(() => resolveRuntimePlatformZkLoginConfig({}), /Google client ID is required/);
  assert.throws(() => resolvePlatformZkLoginConfig({ googleClientId: "", googleIssuer: "https://accounts.google.com" }), /Google client ID is required/);
  assert.doesNotThrow(() =>
    resolveHostedAuthConfigFromEnv({ NODE_TEST_CONTEXT: "1" }, { allowDevelopmentDefaults: true })
  );
});
