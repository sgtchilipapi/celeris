import assert from "node:assert/strict";
import test from "node:test";
import {
  HELLO_CELERIS_CLOCK_OBJECT_ID,
  HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES,
  assertHelloCelerisSayHelloTransactionKindMatches,
  buildCanonicalHelloCelerisSayHelloTransaction,
  buildHelloCelerisSayHelloTransaction,
  normalizeHelloCelerisUsername,
  parseSuiObjectId,
  parseSuiPackageId
} from "../sui/hello-celeris.js";

const PACKAGE_ID = "0x2";
const APP_STATE_OBJECT_ID = "0x123";
const APP_AUTHORITY_CAP_OBJECT_ID = "0x456";

test("username normalization trims and enforces the maximum UTF-8 size", () => {
  assert.equal(normalizeHelloCelerisUsername("  Sam  "), "Sam");
  assert.throws(
    () => normalizeHelloCelerisUsername("x".repeat(HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES + 1)),
    /at most 32 UTF-8 bytes/
  );
});

test("package and object ID parsing rejects malformed values", () => {
  assert.equal(
    parseSuiPackageId(PACKAGE_ID),
    "0x0000000000000000000000000000000000000000000000000000000000000002"
  );
  assert.equal(
    parseSuiObjectId(APP_STATE_OBJECT_ID),
    "0x0000000000000000000000000000000000000000000000000000000000000123"
  );
  assert.throws(() => parseSuiPackageId("not-a-package"), /Invalid Sui package ID/);
  assert.throws(() => parseSuiObjectId("xyz"), /Invalid Sui object ID/);
});

test("canonical TransactionKind builder emits the expected move call and arguments", () => {
  const { transactionKind, normalizedUsername, message } = buildHelloCelerisSayHelloTransaction({
    packageId: PACKAGE_ID,
    appAuthorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID,
    appStateObjectId: APP_STATE_OBJECT_ID,
    username: "  Sam  "
  });
  const transactionData = transactionKind as {
    commands: Array<{
      MoveCall: {
        package: string;
        module: string;
        function: string;
        arguments: Array<{ Input: number; type: string }>;
      };
    }>;
    inputs: unknown[];
  };
  const inputs = transactionData.inputs as Array<Record<string, unknown>>;

  assert.equal(normalizedUsername, "Sam");
  assert.equal(message, "Sam says Hello Celeris!");
  assert.equal(transactionData.commands.length, 1);
  assert.equal(
    transactionData.commands[0].MoveCall.package,
    "0x0000000000000000000000000000000000000000000000000000000000000002"
  );
  assert.equal(transactionData.commands[0].MoveCall.module, "hello_celeris");
  assert.equal(transactionData.commands[0].MoveCall.function, "say_hello");
  assert.deepEqual(
    transactionData.commands[0].MoveCall.arguments,
    [
      { Input: 0, type: "object", $kind: "Input" },
      { Input: 1, type: "object", $kind: "Input" },
      { Input: 2, type: "object", $kind: "Input" },
      { Input: 3, type: "pure", $kind: "Input" }
    ]
  );
  assert.equal(
    (inputs[0].UnresolvedObject as { objectId: string }).objectId,
    "0x0000000000000000000000000000000000000000000000000000000000000456"
  );
  assert.equal(
    (inputs[1].UnresolvedObject as { objectId: string }).objectId,
    "0x0000000000000000000000000000000000000000000000000000000000000123"
  );
  assert.equal((inputs[2].UnresolvedObject as { objectId: string }).objectId, HELLO_CELERIS_CLOCK_OBJECT_ID);
  assert.deepEqual(inputs[3], { Pure: { bytes: "A1NhbQ==" }, $kind: "Pure" });
});

test("TransactionKind validator rejects mismatched payload and object references", () => {
  const { transaction } = buildHelloCelerisSayHelloTransaction({
    packageId: PACKAGE_ID,
    appAuthorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID,
    appStateObjectId: APP_STATE_OBJECT_ID,
    username: "Sam"
  });

  assert.doesNotThrow(() =>
    assertHelloCelerisSayHelloTransactionKindMatches(transaction, {
      packageId: PACKAGE_ID,
      appAuthorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID,
      appStateObjectId: APP_STATE_OBJECT_ID,
      username: "Sam"
    })
  );

  assert.throws(
    () =>
      assertHelloCelerisSayHelloTransactionKindMatches(transaction, {
        packageId: PACKAGE_ID,
        appAuthorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID,
        appStateObjectId: APP_STATE_OBJECT_ID,
        username: "Alex"
      }),
    /does not exactly match/
  );

  assert.throws(
    () =>
      assertHelloCelerisSayHelloTransactionKindMatches(transaction, {
        packageId: PACKAGE_ID,
        appAuthorityCapObjectId: "0x789",
        appStateObjectId: APP_STATE_OBJECT_ID,
        username: "Sam"
      }),
    /does not exactly match/
  );
});

test("canonical shared builder accepts registered program metadata and player wallet context", () => {
  const built = buildCanonicalHelloCelerisSayHelloTransaction({
    registeredProgram: {
      packageId: PACKAGE_ID,
      authorityCapObjectId: APP_AUTHORITY_CAP_OBJECT_ID,
      appStateObjectId: APP_STATE_OBJECT_ID
    },
    playerWalletAddress: "0xabc",
    username: "  Sam  "
  });

  assert.equal(
    built.playerWalletAddress,
    "0x0000000000000000000000000000000000000000000000000000000000000abc"
  );
  assert.equal(built.normalizedUsername, "Sam");
  assert.equal(built.message, "Sam says Hello Celeris!");
});
