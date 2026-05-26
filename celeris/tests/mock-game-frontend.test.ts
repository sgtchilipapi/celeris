import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SUI_RPC_ORIGIN, getTransactionDisplayModel, isSayHelloSubmissionReady } from "../../mock-game-frontend/view-model.js";

test("say_hello form state rejects empty or whitespace-only usernames", () => {
  assert.equal(
    isSayHelloSubmissionReady({
      hasSession: true,
      hasAction: true,
      username: "",
      pendingAction: false
    }),
    false
  );

  assert.equal(
    isSayHelloSubmissionReady({
      hasSession: true,
      hasAction: true,
      username: "   ",
      pendingAction: false
    }),
    false
  );

  assert.equal(
    isSayHelloSubmissionReady({
      hasSession: true,
      hasAction: true,
      username: " Sam ",
      pendingAction: false
    }),
    true
  );
});

test("transaction display prefers SUI digest and explorer URL metadata", () => {
  const display = getTransactionDisplayModel(
    {
      transactionId: "tx-1",
      actionId: "say_hello",
      digest: "sui-digest-123",
      providerTxId: "legacy-provider-id",
      explorerUrl: "https://suiexplorer.com/txblock/sui-digest-123?network=testnet",
      walletAddress: "0xabc123",
      username: "Sam",
      message: "Sam says Hello Celeris!",
      status: "submitted",
      submittedAt: "2026-05-14T10:00:00.000Z",
      confirmedAt: null
    },
    (value: string) => value
  );

  assert.equal(display.walletAddress, "0xabc123");
  assert.equal(display.username, "Sam");
  assert.equal(display.message, "Sam says Hello Celeris!");
  assert.equal(display.status, "submitted");
  assert.equal(display.timestamp, "Submitted 2026-05-14T10:00:00.000Z");
  assert.equal(display.digestLabel, "Digest: sui-digest-123");
  assert.equal(display.explorerUrl, "https://suiexplorer.com/txblock/sui-digest-123?network=testnet");
});

test("mock game frontend public runtime config includes the SUI RPC origin only as a public value", async () => {
  const { buildRunConfig } = await import("../../scripts/mock-game-frontend.js");
  const config = buildRunConfig({
    appId: "app_123",
    appName: "Hello Celeris",
    apiOrigin: "/api",
    hostedAuthOrigin: "http://localhost:3000",
    suiRpcOrigin: DEFAULT_SUI_RPC_ORIGIN,
    redirectUri: "http://localhost:3002/auth/callback"
  });

  assert.deepEqual(config, {
    appId: "app_123",
    appName: "Hello Celeris",
    apiOrigin: "/api",
    hostedAuthOrigin: "http://localhost:3000",
    suiRpcOrigin: DEFAULT_SUI_RPC_ORIGIN,
    redirectUri: "http://localhost:3002/auth/callback"
  });
});

test("mock game frontend bundles the browser SDK without bare package imports", async () => {
  const { bundleBrowserSdkModule } = await import("../../scripts/mock-game-frontend.js");
  const source = await bundleBrowserSdkModule();

  assert.doesNotMatch(source, /from\s+["']@mysten\//);
  assert.doesNotMatch(source, /from\s+["']@mysten\/bcs["']/);
  assert.match(source, /createBrowserClient/);
});
