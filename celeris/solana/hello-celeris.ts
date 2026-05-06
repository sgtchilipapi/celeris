import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const HELLO_CELERIS_APP_STATE_SEED = "app_state";
export const HELLO_CELERIS_MAX_GREETING_ENTRIES = 100;
export const HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES = 32;
export const HELLO_CELERIS_MESSAGE_SUFFIX = " says Hello Celeris!";
export const HELLO_CELERIS_MAX_MESSAGE_UTF8_BYTES =
  HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES + Buffer.byteLength(HELLO_CELERIS_MESSAGE_SUFFIX, "utf8");

export interface HelloCelerisGreetingEntry {
  playerWallet: PublicKey;
  username: string;
  message: string;
  createdAtUnixSeconds: number;
}

export interface HelloCelerisAppState {
  appIdHash: Buffer;
  authority: PublicKey;
  entryCount: number;
  entries: HelloCelerisGreetingEntry[];
}

export function parseSolanaProgramId(programId: string): PublicKey {
  try {
    return new PublicKey(programId);
  } catch (error) {
    throw new Error(`Invalid Solana program ID: ${programId}`, { cause: error });
  }
}

export function hashHelloCelerisAppId(appId: string): Buffer {
  return createHash("sha256").update(appId, "utf8").digest();
}

export function deriveHelloCelerisStatePda({
  appId,
  programId
}: {
  appId: string;
  programId: string | PublicKey;
}) {
  const parsedProgramId = typeof programId === "string" ? parseSolanaProgramId(programId) : programId;
  const appIdHash = hashHelloCelerisAppId(appId);
  const [statePda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(HELLO_CELERIS_APP_STATE_SEED, "utf8"), appIdHash],
    parsedProgramId
  );

  return {
    appIdHash,
    statePda,
    bump
  };
}

export function assertValidHelloCelerisUsername(username: string) {
  if (Buffer.byteLength(username, "utf8") === 0) {
    throw new Error("username must not be empty");
  }

  if (Buffer.byteLength(username, "utf8") > HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES) {
    throw new Error(`username must be at most ${HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES} UTF-8 bytes`);
  }
}

export function renderHelloCelerisMessage(username: string) {
  assertValidHelloCelerisUsername(username);
  return `${username}${HELLO_CELERIS_MESSAGE_SUFFIX}`;
}

export function createHelloCelerisGreetingEntry({
  playerWallet,
  username,
  createdAtUnixSeconds
}: {
  playerWallet: string | PublicKey;
  username: string;
  createdAtUnixSeconds: number;
}): HelloCelerisGreetingEntry {
  return {
    playerWallet: typeof playerWallet === "string" ? parseSolanaProgramId(playerWallet) : playerWallet,
    username,
    message: renderHelloCelerisMessage(username),
    createdAtUnixSeconds
  };
}

export function appendHelloCelerisGreetingEntry({
  state,
  entry
}: {
  state: HelloCelerisAppState;
  entry: HelloCelerisGreetingEntry;
}): HelloCelerisAppState {
  if (state.entries.length >= HELLO_CELERIS_MAX_GREETING_ENTRIES) {
    throw new Error(`app state already contains ${HELLO_CELERIS_MAX_GREETING_ENTRIES} greetings`);
  }

  const nextEntries = [...state.entries, entry];

  return {
    ...state,
    entryCount: nextEntries.length,
    entries: nextEntries
  };
}
