import test from "node:test";
import assert from "node:assert/strict";
import { buildServices } from "../api/index.js";
import { createApi } from "../api/create-api.js";

test("POST /auth/session creates a canonical user and returns a jwt-shaped token for dummy login", async () => {
  const services = buildServices();
  const api = createApi(services);

  const response = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-dummy-1" },
    body: {
      provider: "dummy",
      email: "Player@One.Example"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body.userId, /^[0-9a-f-]{36}$/);
  assert.match(response.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const user = services.store.users.get(response.body.userId);
  assert.equal(user.email, "player@one.example");
  assert.equal(user.externalSubject, "dummy:player@one.example");
  assert.equal(services.store.userSessions.size, 1);
});

test("POST /auth/session is idempotent per identity and key and reuses the same user across requests", async () => {
  const services = buildServices();
  const api = createApi(services);

  const first = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-repeat" },
    body: { provider: "dummy", email: "player@repeat.example" }
  });
  const duplicate = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-repeat" },
    body: { provider: "dummy", email: "player@repeat.example" }
  });
  const secondLogin = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-repeat-2" },
    body: { provider: "dummy", email: "player@repeat.example" }
  });

  assert.equal(first.body.userId, duplicate.body.userId);
  assert.equal(first.body.token, duplicate.body.token);
  assert.equal(secondLogin.body.userId, first.body.userId);
  assert.notEqual(secondLogin.body.token, first.body.token);
  assert.equal(services.store.users.size, 1);
  assert.equal(services.store.userSessions.size, 2);
});

test("POST /auth/session rejects invalid dummy login requests", async () => {
  const services = buildServices();
  const api = createApi(services);

  const missingEmail = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-invalid-1" },
    body: { provider: "dummy" }
  });
  const unsupportedProvider = await api.handle({
    method: "POST",
    url: "/auth/session",
    headers: { "idempotency-key": "session-invalid-2" },
    body: { provider: "magic_link", email: "player@example.com" }
  });

  assert.equal(missingEmail.statusCode, 400);
  assert.equal(missingEmail.body.error, "dummy login requires a valid email");
  assert.equal(unsupportedProvider.statusCode, 400);
  assert.equal(unsupportedProvider.body.error, "unsupported auth provider: magic_link");
});
