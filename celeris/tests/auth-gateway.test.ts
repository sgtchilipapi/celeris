import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { SuiGateway } from "../types.js";
import { buildServices, resolveHostedAuthConfigFromEnv, resolveRuntimePlatformZkLoginConfig } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createBrowserClient } from "../sdk/browser-client.js";
import {
  GoogleJwksIdentityTokenVerifier,
  HttpZkLoginProver,
  LocalGoogleIdentityTokenVerifier,
  LocalZkLoginProver,
  createGoogleTestIdToken,
  resolvePlatformZkLoginConfig
} from "../services/zklogin-auth-service.js";
import { createDeveloperApp, signUpDeveloper } from "./helpers/developer.js";

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
  sessionStorage
}: {
  href: string;
  storage: ReturnType<typeof createMemoryStorage>;
  sessionStorage: ReturnType<typeof createMemoryStorage>;
}) {
  const locationUrl = new URL(href);
  return {
    location: {
      href: locationUrl.toString(),
      origin: locationUrl.origin,
      pathname: locationUrl.pathname,
      search: locationUrl.search,
      assign(_url: string) {}
    },
    localStorage: storage,
    sessionStorage,
    history: {
      replaceState() {}
    },
    close() {}
  };
}

function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function createEphemeralPublicKey() {
  return Ed25519Keypair.generate().getPublicKey().toBase64();
}

function createSuiGatewayStub(epoch = "100"): SuiGateway {
  return {
    getCurrentEpoch: async () => epoch,
    getReferenceGasPrice: async () => "1000",
    getChainIdentifier: async () => "sui:testnet",
    listSponsorGasCoins: async () => [],
    getObjectReference: async () => ({
      objectId: "0x1",
      version: "1",
      digest: "digest",
      initialSharedVersion: null
    }),
    verifySubmittedDigest: async (input) => ({
      digest: input.digest,
      status: "success",
      explorerUrl: `https://suiexplorer.com/txblock/${input.digest}?network=testnet`,
      confirmedAt: new Date().toISOString()
    }),
    getBuildClient() {
      return null as never;
    }
  };
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

function createTestServices() {
  return buildServices({
    suiGateway: createSuiGatewayStub("100"),
    googleIdentityTokenVerifier: new LocalGoogleIdentityTokenVerifier({
      secret: "google-dev-secret",
      issuer: "https://accounts.google.com"
    }),
    zkLoginProver: new LocalZkLoginProver({
      proverOrigin: "http://localhost:3001"
    })
  });
}

test("login-request creation stores randomness, computes the canonical nonce, and returns a backend-chosen max epoch", async () => {
  const services = createTestServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, {
    name: "Gateway App",
    allowedFrontendOrigins: ["http://localhost:3002"],
    allowedRedirectUris: ["http://localhost:3002/auth/callback"]
  });

  const { codeChallenge } = createPkcePair();
  const jwtRandomness = "12345678901234567890";
  const created = await api.handle({
    method: "POST",
    url: "/v1/auth/login-requests",
    headers: { origin: "http://localhost:3002" },
    body: {
      projectId: app.appId,
      redirectUri: "http://localhost:3002/auth/callback",
      codeChallenge,
      zkLogin: {
        ephemeralPublicKey: createEphemeralPublicKey(),
        jwtRandomness
      }
    }
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.body.zkLoginMaxEpoch, 130);
  const stored = services.store.loginRequests.get(created.body.loginRequestId)!;
  assert.equal(stored.zkLoginMaxEpoch, 130);
  assert.equal(stored.zkLoginJwtRandomness, jwtRandomness);
  assert.equal(stored.zkLoginNonce, created.body.zkLoginNonce);
});

test("hosted auth rejects nonce mismatch and expired login state", async () => {
  const services = createTestServices();
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
      zkLogin: {
        ephemeralPublicKey: createEphemeralPublicKey(),
        jwtRandomness: "999999999999"
      }
    }
  });

  const mismatch = await api.handle({
    method: "POST",
    url: "/v1/auth/token",
    body: {
        grantType: "google_identity_token",
        loginRequestId: created.body.loginRequestId,
        googleIdToken: createGoogleTestIdToken({
          nonce: "bad-nonce",
          audience: services.platformZkLoginConfig.googleClientId
        })
      }
    });

  const loginRequest = services.store.loginRequests.get(created.body.loginRequestId)!;
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
          audience: services.platformZkLoginConfig.googleClientId
        })
      }
    });

  assert.equal(mismatch.statusCode, 401);
  assert.equal(mismatch.body.error, "hosted login nonce mismatch");
  assert.equal(expiredAttempt.statusCode, 401);
  assert.equal(expiredAttempt.body.error, "login request expired");
});

test("repeat login for the same Google subject resolves the same zkLogin wallet address", async () => {
  const services = createTestServices();
  const api = createApi(services);
  const app = await createGatewayApp(api, services, { name: "Repeat Login App" });
  const subject = "google-repeat-user";
  const results: string[] = [];

  for (const _ of [1, 2]) {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const created = await api.handle({
      method: "POST",
      url: "/v1/auth/login-requests",
      headers: { origin: "http://localhost:3002" },
      body: {
        projectId: app.appId,
        redirectUri: "http://localhost:3002/auth/callback",
        codeChallenge,
        zkLogin: {
          ephemeralPublicKey: createEphemeralPublicKey(),
          jwtRandomness: "424242424242"
        }
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
          audience: services.platformZkLoginConfig.googleClientId
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

    assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
    assert.equal(exchanged.statusCode, 200, JSON.stringify(exchanged.body));
    results.push(exchanged.body.player.walletAddress as string);
  }

  assert.equal(results[0], results[1]);
});

test("browser SDK popup login keeps zkLogin material in session storage only and uses the canonical hosted flow contract", async () => {
  const services = createTestServices();
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
              audience: services.platformZkLoginConfig.googleClientId
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
  assert.equal(storage.getItem(`celeris-player-session:${app.appId}:zklogin-session`), null);

  const rawEphemeralSession = sessionStorage.getItem(`celeris-player-session:${app.appId}:zklogin-session`);
  assert.ok(rawEphemeralSession);
  assert.match(rawEphemeralSession!, /jwtRandomness/);
  assert.match(rawEphemeralSession!, /nonce/);
});

test("the canonical runtime no longer exposes the fake Google token minting route", async () => {
  const services = createTestServices();
  const api = createApi(services);

  const response = await api.handle({
    method: "POST",
    url: "/v1/auth/google/dev-token",
    body: {
      loginRequestId: "anything"
    }
  });

  assert.equal(response.statusCode, 404);
});

test("Google JWKS verification rejects bad signature, wrong audience, wrong issuer, expired tokens, and nonce mismatch", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const verifier = new GoogleJwksIdentityTokenVerifier({
    jwks: createLocalJWKSet({ keys: [jwk] })
  });

  async function signJwt({
    nonce = "expected-nonce",
    aud = "google-client-dev",
    iss = "https://accounts.google.com",
    exp = Math.floor(Date.now() / 1000) + 300
  }: {
    nonce?: string;
    aud?: string;
    iss?: string;
    exp?: number;
  }) {
    return new SignJWT({
      sub: "user-123",
      email: "player@example.com",
      nonce,
      aud,
      iss
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  }

  await assert.rejects(
    async () =>
      verifier.verifyToken(await signJwt({ nonce: "wrong-nonce" }), {
        expectedNonce: "expected-nonce",
        expectedAudience: "google-client-dev",
        expectedIssuer: "https://accounts.google.com"
      }),
    /hosted login nonce mismatch/
  );

  await assert.rejects(
    async () =>
      verifier.verifyToken(await signJwt({ aud: "wrong-aud" }), {
        expectedNonce: "expected-nonce",
        expectedAudience: "google-client-dev",
        expectedIssuer: "https://accounts.google.com"
      }),
    /unsupported Google audience/
  );

  await assert.rejects(
    async () =>
      verifier.verifyToken(await signJwt({ iss: "https://evil.example" }), {
        expectedNonce: "expected-nonce",
        expectedAudience: "google-client-dev",
        expectedIssuer: "https://accounts.google.com"
      }),
    /unsupported Google issuer|invalid Google identity token/
  );

  await assert.rejects(
    async () =>
      verifier.verifyToken(await signJwt({ exp: Math.floor(Date.now() / 1000) - 10 }), {
        expectedNonce: "expected-nonce",
        expectedAudience: "google-client-dev",
        expectedIssuer: "https://accounts.google.com"
      }),
    /Google identity token expired|invalid Google identity token/
  );

  const otherKeyPair = await generateKeyPair("RS256");
  const badSignatureToken = await new SignJWT({
    sub: "user-123",
    nonce: "expected-nonce",
    aud: "google-client-dev",
    iss: "https://accounts.google.com"
  })
    .setProtectedHeader({ alg: "RS256", kid: "other-key", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(otherKeyPair.privateKey);

  await assert.rejects(
    () =>
      verifier.verifyToken(badSignatureToken, {
        expectedNonce: "expected-nonce",
        expectedAudience: "google-client-dev",
        expectedIssuer: "https://accounts.google.com"
      }),
    /invalid Google identity token/
  );
});

test("HTTP zkLogin prover sends the canonical payload and maps the proof response", async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  const prover = new HttpZkLoginProver({
    proverOrigin: "http://localhost:3001",
    fetchImpl: async (_url, init) => {
      capturedRequest = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          proofPoints: {
            a: ["1", "2"],
            b: [["3", "4"], ["5", "6"]],
            c: ["7", "8"]
          },
          issBase64Details: {
            value: "aHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29t",
            indexMod4: 0
          },
          headerBase64: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const proof = await prover.createProof({
    jwt: "header.payload.signature",
    extendedEphemeralPublicKey: "extended-pk",
    maxEpoch: 123,
    jwtRandomness: "4444",
    salt: "5555",
    keyClaimName: "sub"
  });

  assert.deepEqual(capturedRequest, {
    jwt: "header.payload.signature",
    extendedEphemeralPublicKey: "extended-pk",
    maxEpoch: 123,
    jwtRandomness: "4444",
    salt: "5555",
    keyClaimName: "sub"
  });
  assert.equal(proof.proofPoints.a[0], "1");
  assert.equal(proof.proverOrigin, "http://localhost:3001");
});

test("zkLogin config loading fails closed when required values are missing", () => {
  assert.deepEqual(resolveRuntimePlatformZkLoginConfig({ NODE_TEST_CONTEXT: "1" }), {
    authProvider: "zklogin",
    googleClientId: "google-client-dev",
    googleIssuer: "https://accounts.google.com",
    googleAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    googleJwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    zkLoginSaltSeed: "zklogin-salt-dev-seed",
    zkLoginMaxEpoch: 30,
    zkLoginProverOrigin: "http://localhost:3001"
  });
  assert.throws(() => resolveRuntimePlatformZkLoginConfig({}), /Google client ID is required/);
  assert.throws(
    () => resolvePlatformZkLoginConfig({ googleClientId: "", googleIssuer: "https://accounts.google.com" }),
    /Google client ID is required/
  );
  assert.doesNotThrow(() =>
    resolveHostedAuthConfigFromEnv({ NODE_TEST_CONTEXT: "1" }, { allowDevelopmentDefaults: true })
  );
});
