import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";
import { createPrivyTestToken, LocalPrivyTokenVerifier, PrivyAuthService } from "../services/privy-auth-service.js";

test("PrivyAuthService accepts a valid token and resolves a wallet principal", () => {
  const services = buildServices();
  const authService = new PrivyAuthService({
    store: services.store,
    verifier: new LocalPrivyTokenVerifier()
  });

  const player = authService.authenticatePlayerToken(
    createPrivyTestToken({
      walletAddress: "0xAbC123",
      chainId: "eip155:1"
    })
  );

  assert.equal(player.walletPrincipal.walletAddress, "0xabc123");
  assert.equal(player.walletPrincipal.chainId, "eip155:1");
  assert.match(player.userId, /^[0-9a-f-]{36}$/);
});

test("PrivyAuthService rejects missing, malformed, incomplete, and unsupported-chain tokens", () => {
  const services = buildServices();
  const authService = new PrivyAuthService({
    store: services.store,
    verifier: new LocalPrivyTokenVerifier()
  });

  assert.throws(() => authService.authenticatePlayerToken(""), /authorization token required/);
  assert.throws(() => authService.authenticatePlayerToken("not-a-token"), /invalid authorization token/);
  assert.throws(
    () =>
      authService.authenticatePlayerToken(
        createPrivyTestToken({
          chainId: "eip155:1"
        })
      ),
    /privy token missing wallet address/
  );
  assert.throws(
    () =>
      authService.authenticatePlayerToken(
        createPrivyTestToken({
          walletAddress: "0xabc123"
        })
      ),
    /privy token missing chain id/
  );
  assert.throws(
    () =>
      authService.authenticatePlayerToken(
        createPrivyTestToken({
          walletAddress: "0xabc123",
          chainId: "eip155:137"
        }),
        { allowedChainId: "eip155:1" }
      ),
    /unsupported chain/
  );
});

test("GET /v1/me returns wallet identity from the authenticated Privy token", async () => {
  const services = buildServices();
  const api = createApi(services);
  const token = createPrivyTestToken({
    walletAddress: "0xFf00Aa11",
    chainId: "eip155:1"
  });

  const response = await api.handle({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${token}` }
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
      privyAppId: "privy-app-123",
      allowedChainId: "eip155:1"
    }
  });
  const token = createPrivyTestToken({
    walletAddress: "0xabc123",
    chainId: "eip155:1"
  });

  const response = await api.handle({
    method: "GET",
    url: `/v1/apps/${app.body.appId as string}/me/credits`,
    headers: { authorization: `Bearer ${token}` }
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
      privyAppId: "privy-app-456",
      allowedChainId: "eip155:1"
    }
  });
  const token = createPrivyTestToken({
    walletAddress: "0xabc123",
    chainId: "eip155:1"
  });

  const spoofed = await api.handle({
    method: "GET",
    url: `/v1/apps/${app.body.appId as string}/me/credits`,
    headers: { authorization: `Bearer ${token}` },
    body: {
      walletAddress: "0xdef456",
      userId: "user-123"
    }
  });

  assert.equal(spoofed.statusCode, 400);
  assert.equal(spoofed.body.error, "player identity must come from the authenticated session");

  for (const url of ["/auth/session", "/player/sign-up", "/player/sign-in"]) {
    const response = await api.handle({
      method: "POST",
      url,
      headers: { "idempotency-key": `removed-${url}` },
      body: {}
    });

    assert.equal(response.statusCode, 404);
  }
});
