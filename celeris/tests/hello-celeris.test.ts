import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  HELLO_CELERIS_MAX_GREETING_ENTRIES,
  appendHelloCelerisGreetingEntry,
  assertValidHelloCelerisUsername,
  createHelloCelerisGreetingEntry,
  deriveHelloCelerisStatePda,
  hashHelloCelerisAppId,
  renderHelloCelerisMessage
} from "../solana/hello-celeris.js";

const APP_ID = "123e4567-e89b-12d3-a456-426614174000";
const PROGRAM_ID = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgMQhg2j1kqM";
const PLAYER_WALLET = "11111111111111111111111111111111";

test("app ID hashing is stable and returns 32 bytes", () => {
  const first = hashHelloCelerisAppId(APP_ID);
  const second = hashHelloCelerisAppId(APP_ID);

  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.equal(first.toString("hex"), "986c0dc956dc822b5d8f698661b9eb1ef880786ff9043c16744d2a420e99e9bb");
});

test("PDA derivation is deterministic for a given app ID and program ID", () => {
  const first = deriveHelloCelerisStatePda({ appId: APP_ID, programId: PROGRAM_ID });
  const second = deriveHelloCelerisStatePda({ appId: APP_ID, programId: new PublicKey(PROGRAM_ID) });

  assert.equal(first.appIdHash.toString("hex"), second.appIdHash.toString("hex"));
  assert.equal(first.statePda.toBase58(), second.statePda.toBase58());
  assert.equal(first.bump, second.bump);
});

test("canonical message rendering returns the on-chain hello format", () => {
  assert.equal(renderHelloCelerisMessage("Sam"), "Sam says Hello Celeris!");
});

test("username validation rejects empty and oversized input", () => {
  assert.throws(() => assertValidHelloCelerisUsername(""), /must not be empty/);
  assert.throws(() => assertValidHelloCelerisUsername("x".repeat(33)), /at most 32 UTF-8 bytes/);
  assert.doesNotThrow(() => assertValidHelloCelerisUsername("valid_name"));
});

test("app state append helper rejects writes after the max greeting capacity", () => {
  const authority = new PublicKey(PROGRAM_ID);
  const baseState = {
    appIdHash: hashHelloCelerisAppId(APP_ID),
    authority,
    entryCount: HELLO_CELERIS_MAX_GREETING_ENTRIES,
    entries: Array.from({ length: HELLO_CELERIS_MAX_GREETING_ENTRIES }, (_, index) =>
      createHelloCelerisGreetingEntry({
        playerWallet: PLAYER_WALLET,
        username: `user-${index}`,
        createdAtUnixSeconds: index
      })
    )
  };

  assert.throws(
    () =>
      appendHelloCelerisGreetingEntry({
        state: baseState,
        entry: createHelloCelerisGreetingEntry({
          playerWallet: PLAYER_WALLET,
          username: "late-user",
          createdAtUnixSeconds: 999
        })
      }),
    /already contains 100 greetings/
  );
});
