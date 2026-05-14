import test from "node:test";
import assert from "node:assert/strict";
import { parseProvisionSponsorWalletArgs, runProvisionSponsorWallet } from "../../scripts/provision-sponsor-wallet.js";
import { getRetiredFullDemoMessage } from "../../scripts/full-demo.js";
import { parseRegisterProgramArgs, runRegisterProgram } from "../../scripts/register-program.js";

test("provision sponsor wallet script parses required arguments and access token auth", () => {
  const config = parseProvisionSponsorWalletArgs([
    "--api-origin=http://localhost:3000/",
    "--app-id=app_123",
    "--access-token=token_123"
  ]);

  assert.deepEqual(config, {
    apiOrigin: "http://localhost:3000",
    appId: "app_123",
    accessToken: "token_123",
    username: null,
    password: null
  });
});

test("register program script parses developer credentials and required program id", () => {
  const config = parseRegisterProgramArgs([
    "--app-id=app_123",
    "--package-id=0x123",
    "--app-state-object-id=0x456",
    "--authority-cap-object-id=0x789",
    "--username=dev",
    "--password=secret"
  ]);

  assert.deepEqual(config, {
    apiOrigin: "http://localhost:3000",
    appId: "app_123",
    packageId: "0x123",
    appStateObjectId: "0x456",
    authorityCapObjectId: "0x789",
    accessToken: null,
    username: "dev",
    password: "secret"
  });
});

test("helper scripts issue the expected developer API requests", async () => {
  const requests: Array<{ url: string; method: string; headers: Headers; body: any }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(input),
      method: String(init?.method ?? "GET"),
      headers,
      body
    });

    if (String(input).endsWith("/v1/developer/sign-in")) {
      return new Response(JSON.stringify({ accessToken: "signed-in-token" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await runProvisionSponsorWallet(
    {
      apiOrigin: "http://localhost:3000",
      appId: "app_123",
      accessToken: "token_123",
      username: null,
      password: null
    },
    { fetchImpl }
  );

  await runRegisterProgram(
    {
      apiOrigin: "http://localhost:3000",
      appId: "app_123",
      packageId: "0x123",
      appStateObjectId: "0x456",
      authorityCapObjectId: "0x789",
      accessToken: null,
      username: "dev",
      password: "secret"
    },
    { fetchImpl }
  );

  assert.equal(requests[0].url, "http://localhost:3000/v1/developer/apps/app_123/sponsor-wallet");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.get("authorization"), "Bearer token_123");
  assert.match(String(requests[0].headers.get("idempotency-key")), /^script-sponsor-wallet-/);

  assert.equal(requests[1].url, "http://localhost:3000/v1/developer/sign-in");
  assert.equal(requests[1].method, "POST");
  assert.deepEqual(requests[1].body, {
    username: "dev",
    password: "secret"
  });

  assert.equal(requests[2].url, "http://localhost:3000/v1/developer/apps/app_123/program");
  assert.equal(requests[2].method, "PUT");
  assert.equal(requests[2].headers.get("authorization"), "Bearer signed-in-token");
  assert.equal(requests[2].body.packageId, "0x123");
  assert.equal(requests[2].body.appStateObjectId, "0x456");
  assert.equal(requests[2].body.authorityCapObjectId, "0x789");
  assert.match(String(requests[2].headers.get("idempotency-key")), /^script-register-program-/);
});

test("retired full-demo message points to the manual devnet flow", () => {
  const message = getRetiredFullDemoMessage();

  assert.match(message, /retired/i);
  assert.match(message, /provision-sponsor-wallet\.ts/);
  assert.match(message, /register-program\.ts/);
  assert.match(message, /say_hello/);
});
