import { createHash } from "node:crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

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

export function normalizeHelloCelerisUsername(username: string) {
  const normalized = username.trim();
  assertValidHelloCelerisUsername(normalized);
  return normalized;
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

function createAnchorInstructionDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`, "utf8").digest().subarray(0, 8);
}

export function encodeHelloCelerisSayHelloInstructionData({
  playerWallet,
  username
}: {
  playerWallet: string | PublicKey;
  username: string;
}) {
  const normalizedUsername = normalizeHelloCelerisUsername(username);
  const usernameBytes = Buffer.from(normalizedUsername, "utf8");
  const usernameLength = Buffer.alloc(4);
  usernameLength.writeUInt32LE(usernameBytes.length, 0);

  return Buffer.concat([
    createAnchorInstructionDiscriminator("say_hello"),
    (typeof playerWallet === "string" ? parseSolanaProgramId(playerWallet) : playerWallet).toBuffer(),
    usernameLength,
    usernameBytes
  ]);
}

export function createHelloCelerisSayHelloInstruction({
  appId,
  programId,
  sponsorWalletPublicKey,
  playerWallet,
  username
}: {
  appId: string;
  programId: string | PublicKey;
  sponsorWalletPublicKey: string | PublicKey;
  playerWallet: string | PublicKey;
  username: string;
}) {
  const parsedProgramId = typeof programId === "string" ? parseSolanaProgramId(programId) : programId;
  const parsedSponsorWallet = typeof sponsorWalletPublicKey === "string"
    ? parseSolanaProgramId(sponsorWalletPublicKey)
    : sponsorWalletPublicKey;
  const normalizedUsername = normalizeHelloCelerisUsername(username);
  const { statePda } = deriveHelloCelerisStatePda({
    appId,
    programId: parsedProgramId
  });

  return {
    statePda,
    username: normalizedUsername,
    message: renderHelloCelerisMessage(normalizedUsername),
    instruction: new TransactionInstruction({
      programId: parsedProgramId,
      keys: [
        { pubkey: statePda, isSigner: false, isWritable: true },
        { pubkey: parsedSponsorWallet, isSigner: true, isWritable: false }
      ],
      data: encodeHelloCelerisSayHelloInstructionData({
        playerWallet,
        username: normalizedUsername
      })
    })
  };
}
