import test from "node:test";
import assert from "node:assert/strict";
import { buildServices, resolveRuntimePlatformPrivyConfig } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import {
  createPrivyTestToken,
  LocalPrivyTokenVerifier,
  PrivyAuthService,
  resolveHostedWalletPrincipalFromLinkedAccounts,
  resolvePlatformPrivyConfig
} from "../services/privy-auth-service.js";
import { createHostedPlayerSession } from "./helpers/auth.js";

test("PrivyAuthService accepts a valid token and resolves a verified wallet principal", async () => {
  const services = buildServices();
  const authService = new PrivyAuthService({
    store: services.store,
    verifier: new LocalPrivyTokenVerifier()
  });

  const player = await authService.resolveVerifiedToken(
    createPrivyTestToken({
      walletAddress: "0xAbC123",
      chainId: "eip155:1"
    })
  );

  assert.equal(player.walletPrincipal.walletAddress, "0xabc123");
  assert.equal(player.walletPrincipal.chainId, "eip155:1");
  assert.equal(player.externalSubject, "did:privy:test-user");
});

test("PrivyAuthService rejects missing, malformed, incomplete, and unsupported-chain tokens", async () => {
  const services = buildServices();
  const authService = new PrivyAuthService({
    store: services.store,
    verifier: new LocalPrivyTokenVerifier()
  });

  await assert.rejects(() => authService.resolveVerifiedToken(""), /authorization token required/);
  await assert.rejects(() => authService.resolveVerifiedToken("not-a-token"), /invalid authorization token/);
  await assert.rejects(
    () =>
      authService.resolveVerifiedToken(
        createPrivyTestToken({
          chainId: "eip155:1"
        })
      ),
    /privy token missing wallet address/
  );
  await assert.rejects(
    () =>
      authService.resolveVerifiedToken(
        createPrivyTestToken({
          walletAddress: "0xabc123"
        })
      ),
    /privy token missing chain id/
  );
  await assert.rejects(
    () =>
      authService.resolveVerifiedToken(
        createPrivyTestToken({
          walletAddress: "0xabc123",
          chainId: "eip155:137"
        }),
        { allowedChainId: "eip155:1" }
      ),
    /unsupported chain/
  );
});

test("hosted Privy wallet resolution falls back by chain family for embedded wallets", () => {
  const resolved = resolveHostedWalletPrincipalFromLinkedAccounts(
    [
      {
        type: "wallet",
        address: "0xAbC123",
        chain_id: "1",
        chain_type: "ethereum",
        wallet_client_type: "privy"
      }
    ],
    "eip155:11155111"
  );

  assert.deepEqual(resolved, {
    walletAddress: "0xabc123",
    chainId: "eip155:11155111"
  });
});

test("GET /v1/me returns wallet identity from the authenticated Celeris player session", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "player-session-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Player Session App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const session = await createHostedPlayerSession({
    api,
    appId: app.body.appId as string,
    walletAddress: "0xFf00Aa11"
  });
  const response = await api.handle({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    walletAddress: "0xff00aa11",
    chainId: "eip155:1"
  });
});

test("GET /v1/me returns 401 for missing or invalid bearer tokens", async () => {
  const services = buildServices();
  const api = createApi(services);

  const missing = await api.handle({
    method: "GET",
    url: "/v1/me"
  });
  const invalid = await api.handle({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: "Bearer not-a-token" }
  });

  assert.equal(missing.statusCode, 401);
  assert.equal(missing.body.error, "authorization token required");
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.error, "invalid authorization token");
});

test("GET /v1/apps/:appId/me/credits returns a zero balance for a valid wallet with no prior activity", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "privy-app-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Privy Credits App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });
  const session = await createHostedPlayerSession({
    api,
    appId: app.body.appId as string,
    walletAddress: "0xabc123"
  });

  const response = await api.handle({
    method: "GET",
    url: `/v1/apps/${app.body.appId as string}/me/credits`,
    headers: { authorization: `Bearer ${session.accessToken}` }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.appId, app.body.appId);
  assert.equal(response.body.walletAddress, "0xabc123");
  assert.equal(response.body.chainId, "eip155:1");
  assert.equal(response.body.balance, 0);
  assert.equal(response.body.reserved, 0);
});

test("player identity spoofing through request input is rejected and legacy player auth routes are removed", async () => {
  const services = buildServices();
  const api = createApi(services);
  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "privy-app-2" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Spoofing App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });
  const session = await createHostedPlayerSession({
    api,
    appId: app.body.appId as string,
    walletAddress: "0xabc123"
  });

  const spoofed = await api.handle({
    method: "GET",
    url: `/v1/apps/${app.body.appId as string}/me/credits`,
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: {
      walletAddress: "0xdef456",
      userId: "user-123"
    }
  });

  assert.equal(spoofed.statusCode, 400);
  assert.equal(spoofed.body.error, "player identity must come from the authenticated session");

  for (const [url, body] of [
    ["/auth/session", {}],
    ["/player/sign-up", {}],
    ["/player/sign-in", {}],
    [
      "/v1/auth/token",
      {
        grantType: "privy_mock",
        loginRequestId: "legacy-login-request",
        walletAddress: "0xabc123"
      }
    ]
  ] as const) {
    const response = await api.handle({
      method: "POST",
      url,
      headers: { "idempotency-key": `removed-${url}` },
      body
    });

    if (url === "/v1/auth/token") {
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, "unsupported grantType");
      continue;
    }

    assert.equal(response.statusCode, 404);
  }
});

test("shared wallet identity is reused across apps while project membership remains app-scoped", async () => {
  const services = buildServices();
  const api = createApi(services);

  const appIds: string[] = [];
  for (const [key, name] of [
    ["shared-app-1", "Shared App One"],
    ["shared-app-2", "Shared App Two"]
  ] as const) {
    const response = await api.handle({
      method: "POST",
      url: "/apps",
      headers: { "idempotency-key": key },
      body: {
        developerId: services.defaultDeveloper.developerId,
        name,
        priceCents: 499,
        credits: 500,
        allowedChainId: "eip155:1"
      }
    });
    appIds.push(response.body.appId as string);
  }

  for (const appId of appIds) {
    const session = await createHostedPlayerSession({
      api,
      appId,
      walletAddress: "0xshared123"
    });
    const response = await api.handle({
      method: "GET",
      url: `/v1/apps/${appId}/me/credits`,
      headers: { authorization: `Bearer ${session.accessToken}` }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.walletAddress, "0xshared123");
    assert.equal(response.body.balance, 0);
  }

  assert.equal(services.store.celerisUsers.size, 1);
  assert.equal(services.store.projectUsers.size, 2);
  assert.equal(services.store.creditBalances.size, 2);
});

test("shared Celeris identity stays stable when the same Privy subject reprovisions its wallet", async () => {
  const services = buildServices();
  const api = createApi(services);
  const subject = "did:privy:reprovisioned-user";

  const app = await api.handle({
    method: "POST",
    url: "/apps",
    headers: { "idempotency-key": "privy-app-reprovision-1" },
    body: {
      developerId: services.defaultDeveloper.developerId,
      name: "Reprovision App",
      priceCents: 499,
      credits: 500,
      allowedChainId: "eip155:1"
    }
  });

  const firstSession = await createHostedPlayerSession({
    api,
    appId: app.body.appId as string,
    walletAddress: "0xaaa111",
    subject
  });
  const secondSession = await createHostedPlayerSession({
    api,
    appId: app.body.appId as string,
    walletAddress: "0xbbb222",
    subject
  });

  assert.equal(firstSession.projectUserId, secondSession.projectUserId);
  assert.equal(services.store.celerisUsers.size, 1);
  assert.equal(services.store.projectUsers.size, 1);

  const celerisUser = [...services.store.celerisUsers.values()][0];
  const projectUser = [...services.store.projectUsers.values()][0];
  assert.equal(celerisUser.externalSubject, subject);
  assert.equal(celerisUser.walletAddress, "0xbbb222");
  assert.equal(projectUser.celerisUserId, celerisUser.celerisUserId);
  assert.equal(projectUser.walletAddress, "0xbbb222");
});

test("platform auth bootstrap fails closed without runtime configuration and only uses defaults in test mode", () => {
  assert.deepEqual(resolveRuntimePlatformPrivyConfig({ NODE_TEST_CONTEXT: "1" }), {
    authProvider: "privy",
    privyAppId: "cl-dev-privy-app",
    appSecret: "privy-dev-secret",
    googleOAuthEnabled: true
  });

  assert.throws(() => resolveRuntimePlatformPrivyConfig({}), /platform Privy app ID is required/);
  assert.throws(() => resolvePlatformPrivyConfig({ appId: "", appSecret: "secret" }), /platform Privy app ID is required/);
  assert.throws(() => resolvePlatformPrivyConfig({ appId: "app", appSecret: "" }), /platform Privy app secret is required/);
  assert.throws(
    () => resolvePlatformPrivyConfig({ appId: "app", appSecret: "secret", googleOAuthEnabled: false }),
    /platform Privy Google login must be enabled/
  );
});
