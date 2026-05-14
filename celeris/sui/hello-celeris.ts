import { Transaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  isValidSuiObjectId,
  normalizeSuiAddress,
  normalizeSuiObjectId
} from "@mysten/sui/utils";

export const HELLO_CELERIS_MAX_GREETING_ENTRIES = 100;
export const HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES = 32;
export const HELLO_CELERIS_MESSAGE_SUFFIX = " says Hello Celeris!";
export const HELLO_CELERIS_MODULE_NAME = "hello_celeris";
export const HELLO_CELERIS_INITIALIZE_APP_FUNCTION = "initialize_app";
export const HELLO_CELERIS_SAY_HELLO_FUNCTION = "say_hello";
export const HELLO_CELERIS_CLOCK_OBJECT_ID = normalizeSuiObjectId(SUI_CLOCK_OBJECT_ID);

export interface HelloCelerisSayHelloTransactionParams {
  packageId: string;
  appAuthorityCapObjectId: string;
  appStateObjectId: string;
  username: string;
  clockObjectId?: string;
}

export interface HelloCelerisRegisteredProgramLike {
  packageId: string;
  authorityCapObjectId: string;
  appStateObjectId: string;
}

export interface CanonicalHelloCelerisSayHelloTransactionParams {
  registeredProgram: HelloCelerisRegisteredProgramLike;
  playerWalletAddress: string;
  username: string;
  clockObjectId?: string;
}

interface TransactionKindComparableShape {
  version: unknown;
  inputs: unknown;
  commands: unknown;
}

export function parseSuiAddress(address: string) {
  const normalized = normalizeSuiAddress(address.trim());

  if (!isValidSuiAddress(normalized)) {
    throw new Error(`Invalid Sui address: ${address}`);
  }

  return normalized;
}

export function parseSuiObjectId(objectId: string, label = "Sui object ID") {
  const normalized = normalizeSuiObjectId(objectId.trim());

  if (!isValidSuiObjectId(normalized)) {
    throw new Error(`Invalid ${label}: ${objectId}`);
  }

  return normalized;
}

export function parseSuiPackageId(packageId: string) {
  return parseSuiObjectId(packageId, "Sui package ID");
}

export function assertValidHelloCelerisUsername(username: string) {
  const utf8Length = new TextEncoder().encode(username).length;

  if (utf8Length === 0) {
    throw new Error("username must not be empty");
  }

  if (utf8Length > HELLO_CELERIS_MAX_USERNAME_UTF8_BYTES) {
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

export function buildHelloCelerisSayHelloTransaction(params: HelloCelerisSayHelloTransactionParams) {
  const packageId = parseSuiPackageId(params.packageId);
  const appAuthorityCapObjectId = parseSuiObjectId(
    params.appAuthorityCapObjectId,
    "Sui Hello Celeris authority capability object ID"
  );
  const appStateObjectId = parseSuiObjectId(
    params.appStateObjectId,
    "Sui Hello Celeris app state object ID"
  );
  const clockObjectId = parseSuiObjectId(
    params.clockObjectId ?? HELLO_CELERIS_CLOCK_OBJECT_ID,
    "Sui Clock object ID"
  );
  const normalizedUsername = normalizeHelloCelerisUsername(params.username);
  const transaction = new Transaction();

  transaction.moveCall({
    target: `${packageId}::${HELLO_CELERIS_MODULE_NAME}::${HELLO_CELERIS_SAY_HELLO_FUNCTION}`,
    arguments: [
      transaction.object(appAuthorityCapObjectId),
      transaction.object(appStateObjectId),
      transaction.object(clockObjectId),
      transaction.pure.string(normalizedUsername)
    ]
  });

  return {
    packageId,
    appAuthorityCapObjectId,
    appStateObjectId,
    clockObjectId,
    normalizedUsername,
    message: renderHelloCelerisMessage(normalizedUsername),
    transaction,
    transactionKind: transaction.getData()
  };
}

export function buildCanonicalHelloCelerisSayHelloTransaction(params: CanonicalHelloCelerisSayHelloTransactionParams) {
  const playerWalletAddress = parseSuiAddress(params.playerWalletAddress);
  const built = buildHelloCelerisSayHelloTransaction({
    packageId: params.registeredProgram.packageId,
    appAuthorityCapObjectId: params.registeredProgram.authorityCapObjectId,
    appStateObjectId: params.registeredProgram.appStateObjectId,
    username: params.username,
    clockObjectId: params.clockObjectId
  });

  return {
    ...built,
    playerWalletAddress
  };
}

export function assertHelloCelerisSayHelloTransactionKindMatches(
  transaction: Transaction,
  params: HelloCelerisSayHelloTransactionParams
) {
  const actual = extractComparableTransactionKindShape(transaction.getData());
  const expected = extractComparableTransactionKindShape(buildHelloCelerisSayHelloTransaction(params).transactionKind);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("provided TransactionKind does not exactly match the canonical Hello Celeris say_hello shape");
  }
}

function extractComparableTransactionKindShape(value: unknown): TransactionKindComparableShape {
  if (!value || typeof value !== "object") {
    throw new Error("TransactionKind is missing programmable transaction data");
  }

  const transactionKind = value as Record<string, unknown>;

  return {
    version: transactionKind.version ?? null,
    inputs: transactionKind.inputs ?? null,
    commands: transactionKind.commands ?? null
  };
}
