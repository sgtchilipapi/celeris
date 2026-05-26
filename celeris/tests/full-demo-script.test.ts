import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildSuiPublishArgs,
  createSuiCommandError,
  extractInitializedAppObjects,
  extractPublishedPackageId,
  inferSuiBuildEnvironment,
  inferSuiNetwork,
  parseMist,
  parseFullDemoArgs,
  selectSuiCoinForTransfer
} from "../../scripts/full-demo.js";

test("full demo script parses overrides for ports, credentials, and lifecycle flags", () => {
  const config = parseFullDemoArgs(
    [
      "--api-port=4100",
      "--frontend-port=4102",
      "--hosted-auth-origin=http://localhost:4100",
      "--sui-rpc-origin=https://fullnode.testnet.sui.io:443",
      "--app-name=Scripted Demo",
      "--developer-username=alice",
      "--developer-password=secret",
      "--sponsor-fund-amount-mist=75000000",
      "--publish-gas-budget=300000000",
      "--initialize-gas-budget=70000000",
      "--say-hello-cost=30",
      "--package-path=sui/hello-celeris",
      "--skip-sponsor-funding",
      "--skip-sui-publish",
      "--no-keep-running"
    ],
    {}
  );

  assert.equal(config.apiPort, 4100);
  assert.equal(config.frontendPort, 4102);
  assert.equal(config.apiOrigin, "http://localhost:4100");
  assert.equal(config.frontendOrigin, "http://localhost:4102");
  assert.deepEqual(config.allowedFrontendOrigins, ["http://localhost:4102"]);
  assert.deepEqual(config.allowedRedirectUris, ["http://localhost:4102/auth/callback"]);
  assert.equal(config.hostedAuthOrigin, "http://localhost:4100");
  assert.equal(config.developerUsername, "alice");
  assert.equal(config.developerPassword, "secret");
  assert.equal(config.sponsorFundAmountMist, 75_000_000);
  assert.equal(config.publishGasBudget, 300_000_000);
  assert.equal(config.initializeGasBudget, 70_000_000);
  assert.equal(config.sayHelloCost, 30);
  assert.equal(config.packagePath, path.resolve("/workspaces/celeris", "sui/hello-celeris"));
  assert.equal(config.skipSponsorFunding, true);
  assert.equal(config.skipSuiPublish, true);
  assert.equal(config.keepRunning, false);
});

test("full demo script allowlists configured public frontend origins", () => {
  const config = parseFullDemoArgs(
    [
      "--frontend-port=4102",
      "--allowed-frontend-origin=https://preview.celeris.pro/path",
      "--allowed-frontend-origin=https://staging.celeris.pro"
    ],
    {
      CELERIS_DEMO_FRONTEND_ORIGINS: "https://demo.celeris.pro, https://demo.celeris.pro/path",
      CLOUDFLARED_DEMO_FRONTEND_HOSTNAME: "demo-frontend.celeris.pro"
    }
  );

  assert.deepEqual(config.allowedFrontendOrigins, [
    "http://localhost:4102",
    "https://demo.celeris.pro",
    "https://demo-frontend.celeris.pro",
    "https://preview.celeris.pro",
    "https://staging.celeris.pro"
  ]);
  assert.deepEqual(config.allowedRedirectUris, [
    "http://localhost:4102/auth/callback",
    "https://demo.celeris.pro/auth/callback",
    "https://demo-frontend.celeris.pro/auth/callback",
    "https://preview.celeris.pro/auth/callback",
    "https://staging.celeris.pro/auth/callback"
  ]);
});

test("full demo script extracts published package id from Sui JSON output", () => {
  const packageId = extractPublishedPackageId({
    objectChanges: [
      {
        type: "published",
        packageId: "0x2"
      }
    ]
  });

  assert.equal(packageId, "0x0000000000000000000000000000000000000000000000000000000000000002");
});

test("full demo script extracts initialized app object ids from Sui JSON output", () => {
  const objects = extractInitializedAppObjects({
    objectChanges: [
      {
        type: "created",
        objectType: "0x2::hello_celeris::AppState",
        objectId: "0x123"
      },
      {
        type: "created",
        objectType: "0x2::hello_celeris::AppAuthorityCap",
        objectId: "0x456"
      }
    ]
  });

  assert.deepEqual(objects, {
    appStateObjectId: "0x0000000000000000000000000000000000000000000000000000000000000123",
    authorityCapObjectId: "0x0000000000000000000000000000000000000000000000000000000000000456"
  });
});

test("full demo script explains when the Sui CLI is missing", () => {
  const error = createSuiCommandError(["--version"], {
    code: "ENOENT",
    message: "spawn sui ENOENT"
  });

  assert.match(error.message, /Sui CLI was not found on PATH/);
  assert.match(error.message, /npm run start:full-demo/);
  assert.match(error.message, /sui --version/);
  assert.match(error.message, /sui client active-address/);
});

test("full demo script includes both stderr and stdout in Sui command failures", () => {
  const error = createSuiCommandError(["client", "publish"], {
    message: "command failed",
    stderr: "compiler warning",
    stdout: "actual publish failure"
  });

  assert.match(error.message, /compiler warning/);
  assert.match(error.message, /stdout:\nactual publish failure/);
});

test("full demo script publishes with an ephemeral publication file", () => {
  const args = buildSuiPublishArgs({
    packagePath: "/tmp/hello-celeris",
    gasBudget: 200_000_000,
    publicationFilePath: "/tmp/run-123/Published.toml",
    buildEnvironment: "testnet"
  });

  assert.deepEqual(args, [
    "client",
    "test-publish",
    "--gas-budget",
    "200000000",
    "--build-env",
    "testnet",
    "--pubfile-path",
    "/tmp/run-123/Published.toml",
    "--json",
    "/tmp/hello-celeris"
  ]);
});

test("full demo script chooses the smallest sufficient SUI coin for sponsor funding", () => {
  const coinObjectId = selectSuiCoinForTransfer(
    [
      { coinObjectId: "0x1", balance: "900" },
      { coinObjectId: "0x2", balance: "600" },
      { coinObjectId: "0x3", balance: "1200" }
    ],
    550n
  );

  assert.equal(coinObjectId, "0x2");
});

test("full demo script rejects funding when no single coin can cover transfer plus gas", () => {
  assert.throws(
    () =>
      selectSuiCoinForTransfer(
        [
          { coinObjectId: "0x1", balance: "300" },
          { coinObjectId: "0x2", balance: "400" }
        ],
        550n
      ),
    /does not own a single SUI coin/
  );
});

test("full demo script parses MIST balances and infers network labels", () => {
  assert.equal(parseMist("1000000000", "balance"), 1_000_000_000n);
  assert.equal(inferSuiNetwork("https://fullnode.testnet.sui.io:443"), "testnet");
  assert.equal(inferSuiNetwork("https://fullnode.mainnet.sui.io:443"), "mainnet");
  assert.equal(inferSuiNetwork("http://localhost:9000"), "localnet");
  assert.equal(inferSuiBuildEnvironment("https://fullnode.testnet.sui.io:443"), "testnet");
  assert.equal(inferSuiBuildEnvironment("http://localhost:9000"), "testnet");
});
