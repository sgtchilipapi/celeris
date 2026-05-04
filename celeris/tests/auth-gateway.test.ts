import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { buildServices, resolveHostedAuthConfigFromEnv } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createBrowserClient } from "../sdk/browser-client.js";
import { createPrivyTestToken } from "../services/privy-auth-service.js";

function resolveTestVerifierSecret() {
  return process.env.PRIVY_APP_SECRET ?? process.env.PRIVY_VERIFIER_SECRET ?? "privy-dev-secret";
}

function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
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
    }
  };
}

function createWindowStub({
  href,
  storage,
  opener = null,
  onAssign,
  onReplaceState,
  onClose
}: {
  href: string;
  storage: ReturnType<typeof createMemoryStorage>;
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

test("login-request creation enforces project existence, exact origin matching, and exact redirect URI matching", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1",
      allowedFrontendOrigins: ["http://localhost:3002"],
      allowedRedirectUris: ["http://localhost:3002/auth/callback"]
    }
  });

  const missingProject = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: { projectId: "missing-project", redirectUri: "http://localhost:3002/auth/callback", codeChallenge: createPkcePair().codeChallenge }
  });
  const badOrigin = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://evil.local" },
    body: { projectId: app.body.appId, redirectUri: "http://localhost:3002/auth/callback", codeChallenge: createPkcePair().codeChallenge }
  });
  const badRedirect = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: { projectId: app.body.appId, redirectUri: "http://localhost:3002/other", codeChallenge: createPkcePair().codeChallenge }
  });

  assert.equal(missingProject.statusCode, 404);
  assert.equal(missingProject.body.error, "project not found");
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(badOrigin.body.error, "origin not allowed");
  assert.equal(badRedirect.statusCode, 403);
  assert.equal(badRedirect.body.error, "redirectUri not allowed");
});

test("hosted login completion rejects expired or consumed login requests", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-2" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway App Two",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: { projectId: app.body.appId, redirectUri: "http://localhost:3002/auth/callback", codeChallenge: createPkcePair().codeChallenge }
  });
  const loginRequestId = created.body.loginRequestId as string;
  const loginRequest = services.store.loginRequests.get(loginRequestId)!;
  loginRequest.expiresAt = new Date(Date.now() - 1000).toISOString();
  services.store.saveLoginRequest(loginRequest);

  const expired = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId,
      privyAccessToken: createPrivyTestToken({
        walletAddress: "0xabc123",
        chainId: "eip155:1"
      }, {
        secret: resolveTestVerifierSecret()
      })
    }
  });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.body.error, "login request expired");

  loginRequest.expiresAt = new Date(Date.now() + 60_000).toISOString();
  services.store.saveLoginRequest(loginRequest);
  const first = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId,
      privyAccessToken: createPrivyTestToken({
        walletAddress: "0xabc123",
        chainId: "eip155:1"
      }, {
        secret: resolveTestVerifierSecret()
      })
    }
  });
  const consumed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId,
      privyAccessToken: createPrivyTestToken({
        walletAddress: "0xabc123",
        chainId: "eip155:1"
      }, {
        secret: resolveTestVerifierSecret()
      })
    }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(consumed.statusCode, 409);
  assert.equal(consumed.body.error, "login request already consumed");
});

test("browser SDK popup login completes through the app callback origin and persists the player session", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-3" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway SDK App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1",
      allowedFrontendOrigins: ["http://localhost:3002"],
      allowedRedirectUris: ["http://localhost:3002/auth/callback"]
    }
  });
  const fetchImpl = createFetchBridge(api);
  const storage = createMemoryStorage();
  let popupClosed = false;

  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: app.body.appId as string,
    fetchImpl,
    auth: {
      frontendOrigin: "http://localhost:3002",
      redirectUri: "http://localhost:3002/auth/callback",
      storage,
      window: createWindowStub({
        href: "http://localhost:3002/",
        storage
      }),
      openPopup: () => ({ close() {} }),
      waitForMessage: async (expectedOrigin) => {
        const created = [...services.store.loginRequests.values()].slice(-1)[0]!;
        const completed = await api.handle({
          method: "POST",
          url: "/v1/auth/token",
          body: {
            grantType: "privy_access_token",
            loginRequestId: created.loginRequestId,
            privyAccessToken: createPrivyTestToken({
              walletAddress: "0xshared123",
              chainId: "eip155:1"
            }, {
              secret: resolveTestVerifierSecret()
            })
          }
        });
        const pendingLogin = JSON.parse(storage.getItem(`celeris-player-session:${app.body.appId}:pending-login`) ?? "{}");
        let callbackMessageData: any = null;
        const callbackClient = createBrowserClient({
          apiBaseUrl: "/api",
          appId: app.body.appId as string,
          fetchImpl,
          auth: {
            frontendOrigin: "http://localhost:3002",
            redirectUri: "http://localhost:3002/auth/callback",
            storage,
            window: createWindowStub({
              href: `http://localhost:3002/auth/callback?code=${encodeURIComponent(completed.body.code as string)}&state=${encodeURIComponent(pendingLogin.state)}`,
              storage,
              opener: {
                postMessage(message: any, targetOrigin: string) {
                  assert.equal(targetOrigin, expectedOrigin);
                  callbackMessageData = message;
                }
              },
              onClose() {
                popupClosed = true;
              }
            })
          }
        });
        await callbackClient.auth.handleCallback();
        assert.ok(callbackMessageData);
        return {
          origin: expectedOrigin,
          data: callbackMessageData
        };
      }
    }
  });

  const session = await client.auth.login();
  assert.ok(session);
  const me = await client.me.get();
  assert.equal(session.player.walletAddress, "0xshared123");
  assert.equal(me.walletAddress, "0xshared123");
  assert.equal(services.store.celerisUsers.size, 1);
  assert.equal(services.store.projectUsers.size, 1);
  assert.equal(popupClosed, true);

  const badOriginClient = createBrowserClient({
    apiBaseUrl: "/api",
    appId: app.body.appId as string,
    fetchImpl,
    auth: {
      frontendOrigin: "http://localhost:3002",
      redirectUri: "http://localhost:3002/auth/callback",
      storage: createMemoryStorage(),
      window: createWindowStub({
        href: "http://localhost:3002/",
        storage: createMemoryStorage()
      }),
      openPopup: () => ({ close() {} }),
      waitForMessage: async () => ({
        origin: "http://malicious.local",
        data: { type: "celeris-auth-callback", state: "nope", status: "success" }
      })
    }
  });

  await assert.rejects(() => badOriginClient.auth.login(), /popup completion only accepts messages from the callback origin/);
});

test("browser SDK redirect login uses the registered callback and rejects state mismatches", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-redirect-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway Redirect App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1",
      allowedFrontendOrigins: ["http://localhost:3002"],
      allowedRedirectUris: ["http://localhost:3002/auth/callback"]
    }
  });
  const fetchImpl = createFetchBridge(api);
  const storage = createMemoryStorage();
  let redirectedTo = "";
  let cleanedUrl = "";
  const runtimeWindow = createWindowStub({
    href: "http://localhost:3002/",
    storage,
    onAssign(url) {
      redirectedTo = url;
    },
    onReplaceState(url) {
      cleanedUrl = String(url ?? "");
    }
  });

  const client = createBrowserClient({
    apiBaseUrl: "/api",
    appId: app.body.appId as string,
    fetchImpl,
    auth: {
      frontendOrigin: "http://localhost:3002",
      redirectUri: "http://localhost:3002/auth/callback",
      storage,
      window: runtimeWindow
    }
  });

  await client.auth.login({ mode: "redirect" });
  assert.match(redirectedTo, /^https:\/\/auth\.celeris\.pro\/auth\/login\?/);

  const created = [...services.store.loginRequests.values()].slice(-1)[0]!;
  const completed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId: created.loginRequestId,
      privyAccessToken: createPrivyTestToken(
        {
          subject: "did:privy:callback-user",
          walletAddress: "0xredirect123",
          chainId: "eip155:1"
        },
        {
          secret: resolveTestVerifierSecret()
        }
      )
    }
  });

  const pendingLogin = JSON.parse(storage.getItem(`celeris-player-session:${app.body.appId}:pending-login`) ?? "{}");
  const session = await client.auth.handleCallback({
    url: `http://localhost:3002/auth/callback?code=${encodeURIComponent(completed.body.code as string)}&state=${encodeURIComponent(pendingLogin.state)}`
  });

  assert.equal(session?.player.walletAddress, "0xredirect123");
  assert.equal(client.auth.getSession()?.player.walletAddress, "0xredirect123");
  assert.equal(storage.getItem(`celeris-player-session:${app.body.appId}:pending-login`), null);
  assert.equal(cleanedUrl, "/");

  await client.auth.login({ mode: "redirect" });
  const nextCreated = [...services.store.loginRequests.values()].slice(-1)[0]!;
  const nextCompleted = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId: nextCreated.loginRequestId,
      privyAccessToken: createPrivyTestToken(
        {
          subject: "did:privy:callback-user",
          walletAddress: "0xredirect123",
          chainId: "eip155:1"
        },
        {
          secret: resolveTestVerifierSecret()
        }
      )
    }
  });

  await assert.rejects(
    () =>
      client.auth.handleCallback({
        url: `http://localhost:3002/auth/callback?code=${encodeURIComponent(nextCompleted.body.code as string)}&state=wrong-state`
      }),
    /hosted auth callback state mismatch/
  );
});

test("hosted auth login page no longer exposes manual wallet entry or the legacy mock grant path", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-4" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway Hosted Login App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: { projectId: app.body.appId, redirectUri: "http://localhost:3002/auth/callback", codeChallenge: createPkcePair().codeChallenge }
  });
  const page = await api.handle({
    method: "GET",
    url: `/auth/login?loginRequestId=${created.body.loginRequestId as string}`
  });

  const html = String(page.body);
  assert.match(html, /Continue with Privy/);
  assert.doesNotMatch(html, /Wallet address/);
  assert.doesNotMatch(html, /privy_mock/);
  assert.match(html, /\/auth\/client\.js/);
});

test("auth-code exchange rejects verifier mismatches and accepts the original verifier only once", async () => {
  const services = buildServices();
  const api = createApi(services);
  const { codeVerifier, codeChallenge } = createPkcePair();
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "auth-gateway-app-5" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Gateway PKCE App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: { projectId: app.body.appId, redirectUri: "http://localhost:3002/auth/callback", codeChallenge }
  });
  const completed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "privy_access_token",
      loginRequestId: created.body.loginRequestId,
      privyAccessToken: createPrivyTestToken(
        {
          subject: "did:privy:wo-05-8-user",
          walletAddress: "0xabc123",
          chainId: "eip155:1"
        },
        {
          secret: resolveTestVerifierSecret()
        }
      )
    }
  });

  const mismatched = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "authorization_code",
      code: completed.body.code,
      codeVerifier: "not-the-right-verifier"
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
  const replayed = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
      grantType: "authorization_code",
      code: completed.body.code,
      codeVerifier
    }
  });

  assert.equal(mismatched.statusCode, 401);
  assert.equal(mismatched.body.error, "invalid authorization code verifier");
  assert.equal(exchanged.statusCode, 200);
  assert.equal(replayed.statusCode, 409);
  assert.equal(replayed.body.error, "authorization code already consumed");
});

test("hosted auth config fails closed without runtime configuration and only uses defaults in test mode", () => {
  assert.deepEqual(resolveHostedAuthConfigFromEnv({}, { allowDevelopmentDefaults: true }), {
    hostedAuthOrigin: "https://auth.celeris.pro",
    sessionSecret: "celeris-session-dev-secret"
  });

  assert.throws(() => resolveHostedAuthConfigFromEnv({}), /hosted auth origin is required/);

  assert.throws(
    () => resolveHostedAuthConfigFromEnv({ CELERIS_HOSTED_AUTH_ORIGIN: "", CELERIS_SESSION_SECRET: "secret" }),
    /hosted auth origin is required/
  );
  assert.throws(
    () => resolveHostedAuthConfigFromEnv({ CELERIS_HOSTED_AUTH_ORIGIN: "https://auth.celeris.pro", CELERIS_SESSION_SECRET: "" }),
    /session secret is required/
  );
});
