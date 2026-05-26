import { fromBase64 } from "@mysten/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { generateRandomness, getZkLoginSignature } from "@mysten/sui/zklogin";
import { buildCanonicalHelloCelerisSayHelloTransaction, renderHelloCelerisMessage } from "../sui/hello-celeris.js";

type FetchLike = typeof fetch;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type PopupLike = {
  close?: () => void;
};

type WindowLocationLike = {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  assign?: (url: string) => void;
};

type WindowLike = {
  location?: WindowLocationLike;
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
  opener?: { postMessage?: (message: any, targetOrigin: string) => void } | null;
  close?: () => void;
  history?: { replaceState: (data: unknown, unused: string, url?: string | URL | null) => void };
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  removeEventListener?: (type: string, listener: (event: any) => void) => void;
  open?: (url: string, target: string, features: string) => PopupLike | null;
};

type AuthFlowMode = "popup" | "redirect";

type PendingLogin = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  frontendOrigin: string;
  ephemeralPublicKey: string;
  createdAt: string;
};

type BrowserClientOptions = {
  apiBaseUrl: string;
  appId: string;
  tokenProvider?: () => Promise<string | null | undefined> | string | null | undefined;
  fetchImpl?: FetchLike;
  sui?: {
    rpcUrl?: string;
    rpcClient?: BrowserSuiRpcClientLike;
  };
  auth?: {
    projectId?: string;
    redirectUri?: string;
    frontendOrigin?: string;
    hostedAuthOrigin?: string;
    storageKey?: string;
    storage?: StorageLike | null;
    sessionStorage?: StorageLike | null;
    window?: WindowLike;
    openPopup?: (url: string, target: string, features: string) => PopupLike | null;
    waitForMessage?: (expectedOrigin: string, popup: PopupLike | null) => Promise<{ origin: string; data: any }>;
  };
};

type CheckoutSessionInput = {
  packageId: string;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey?: string;
};

type ExecuteActionOptions = {
  idempotencyKey?: string;
};

type BrowserSuiRpcClientLike = {
  executeTransactionBlock(input: {
    transactionBlock: string;
    signature: string | string[];
    options?: Record<string, unknown>;
  }): Promise<unknown>;
};

type LoginRequestResponse = {
  loginRequestId: string;
  hostedLoginUrl: string;
  zkLoginNonce: string;
  zkLoginMaxEpoch: number;
  expiresAt: string;
};

type PlayerSession = {
  accessToken: string;
  expiresAt: string;
  player: {
    walletAddress: string;
    chainId: string;
  };
  projectId: string;
  celerisUserId: string;
  projectUserId: string;
  zkLogin?: {
    nonce: string;
    ephemeralPublicKey: string;
    maxEpoch: number;
    userSalt: string;
    issuer: string;
    audience: string;
    subject: string;
    addressSeed: string;
    proof: {
      proofDigest: string;
      proverOrigin: string;
      proofPoints: {
        a: [string, string];
        b: [[string, string], [string, string]];
        c: [string, string];
      };
      issBase64Details: {
        value: string;
        indexMod4: number;
      };
      headerBase64: string;
    };
  };
};

type ZkLoginEphemeralSession = {
  ephemeralPrivateKey: string;
  ephemeralPublicKey: string;
  jwtRandomness: string;
  maxEpoch: number;
  createdAt: string;
  nonce?: string;
  userSalt?: string;
  issuer?: string;
  audience?: string;
  subject?: string;
  addressSeed?: string;
  proof?: {
    proofDigest: string;
    proverOrigin: string;
    proofPoints: {
      a: [string, string];
      b: [[string, string], [string, string]];
      c: [string, string];
    };
    issBase64Details: {
      value: string;
      indexMod4: number;
    };
    headerBase64: string;
  };
};

type ActiveZkLoginSessionMaterial = ZkLoginEphemeralSession & {
  nonce: string;
  userSalt: string;
  issuer: string;
  audience: string;
  subject: string;
  addressSeed: string;
  proof: NonNullable<ZkLoginEphemeralSession["proof"]>;
};

type BrowserCatalogResponse = {
  registeredProgram?: {
    packageId: string;
    appStateObjectId: string;
    authorityCapObjectId: string;
  } | null;
};

type PreparedSayHelloResponse = {
  reservationId: string;
  transactionBytes: string;
  sponsorSignature: string;
  sponsorAddress: string;
  expiresAt: string;
  username: string;
  message: string;
};

type SayHelloCompletionResponse = {
  reservationId: string;
  transactionId: string | null;
  digest: string | null;
  explorerUrl: string | null;
  status: string;
};

type PopupCompletionResult =
  | { state: string; status: "success"; session: PlayerSession }
  | { state: string; status: "error"; error: string };

type HandleCallbackOptions = {
  url?: string;
};

function getWindow(candidate?: WindowLike) {
  return candidate ?? (typeof window !== "undefined" ? (window as unknown as WindowLike) : null);
}

function requireCrypto() {
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto?.subtle || typeof runtimeCrypto.getRandomValues !== "function") {
    throw new Error("secure browser login requires Web Crypto support");
  }
  return runtimeCrypto;
}

function base64UrlEncode(bytes: Uint8Array) {
  const base64 =
    typeof btoa === "function"
      ? (() => {
          let binary = "";
          for (const value of bytes) {
            binary += String.fromCharCode(value);
          }
          return btoa(binary);
        })()
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createPkcePair() {
  const runtimeCrypto = requireCrypto();
  const verifierBytes = new Uint8Array(32);
  runtimeCrypto.getRandomValues(verifierBytes);
  const codeVerifier = base64UrlEncode(verifierBytes);
  const digest = await runtimeCrypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

function normalizeBaseUrl(apiBaseUrl: string) {
  return String(apiBaseUrl ?? "").replace(/\/+$/, "");
}

function resolveWindowOrigin(runtimeWindow: WindowLike | null) {
  if (!runtimeWindow?.location?.origin) {
    throw new Error("frontend origin is required");
  }
  return runtimeWindow.location.origin;
}

function getStorage(candidate: StorageLike | null | undefined, runtimeWindow: WindowLike | null) {
  if (candidate) {
    return candidate;
  }
  if (runtimeWindow?.localStorage) {
    return runtimeWindow.localStorage;
  }
  return null;
}

async function parseJson(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }
  return payload;
}

function isExpiredTimestamp(timestamp: string | undefined | null) {
  if (!timestamp) {
    return true;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) || parsed <= Date.now();
}

function safeJsonParse(raw: string | null) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function defaultPopupOpener(url: string, target: string, features: string) {
  const runtimeWindow = getWindow();
  if (!runtimeWindow || typeof runtimeWindow.open !== "function") {
    throw new Error("popup login requires a browser window");
  }
  return runtimeWindow.open(url, target, features);
}

function defaultWaitForMessage(expectedOrigin: string, popup: PopupLike | null) {
  const runtimeWindow = getWindow();
  if (
    !runtimeWindow ||
    typeof runtimeWindow.addEventListener !== "function" ||
    typeof runtimeWindow.removeEventListener !== "function" ||
    typeof runtimeWindow.setTimeout !== "function" ||
    typeof runtimeWindow.clearTimeout !== "function"
  ) {
    throw new Error("message listener requires a browser window");
  }

  return new Promise<{ origin: string; data: any }>((resolve, reject) => {
    const timeout = runtimeWindow.setTimeout!(() => {
      runtimeWindow.removeEventListener!("message", handleMessage);
      popup?.close?.();
      reject(new Error("hosted login timed out"));
    }, 60_000);

    function handleMessage(event: any) {
      if (event.origin !== expectedOrigin) {
        return;
      }
      const data = event.data ?? {};
      if (data.type !== "celeris-auth-callback" || typeof data.state !== "string") {
        return;
      }
      runtimeWindow!.removeEventListener!("message", handleMessage);
      runtimeWindow!.clearTimeout!(timeout);
      popup?.close?.();
      resolve({
        origin: event.origin,
        data
      });
    }

    runtimeWindow.addEventListener!("message", handleMessage);
  });
}

function createRandomState() {
  const bytes = new Uint8Array(16);
  requireCrypto().getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createZkLoginEphemeralSession(maxEpoch: number) {
  const keypair = Ed25519Keypair.generate();
  return {
    ephemeralPrivateKey: keypair.getSecretKey(),
    ephemeralPublicKey: keypair.getPublicKey().toBase64(),
    jwtRandomness: generateRandomness(),
    maxEpoch,
    createdAt: new Date().toISOString()
  } satisfies ZkLoginEphemeralSession;
}

export function createBrowserClient({
  apiBaseUrl,
  appId,
  tokenProvider,
  fetchImpl = globalThis.fetch,
  sui,
  auth
}: BrowserClientOptions) {
  if (!appId) {
    throw new Error("appId is required");
  }
  if (!tokenProvider && !auth) {
    throw new Error("tokenProvider or auth configuration is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  const rpcClient =
    sui?.rpcClient ??
    (sui?.rpcUrl
      ? new SuiJsonRpcClient({
          url: sui.rpcUrl,
          network: "testnet"
        })
      : null);
  const projectId = auth?.projectId ?? appId;
  const runtimeWindow = getWindow(auth?.window);
  const storage = getStorage(auth?.storage, runtimeWindow);
  const sessionStorage = auth?.sessionStorage ?? runtimeWindow?.sessionStorage ?? null;
  const storageKey = auth?.storageKey ?? `celeris-player-session:${projectId}`;
  const pendingLoginStorageKey = `${storageKey}:pending-login`;
  const popupCompletionStorageKey = `${storageKey}:popup-completion`;
  const zkLoginSessionStorageKey = `${storageKey}:zklogin-session`;
  let currentSession = (safeJsonParse(storage?.getItem(storageKey) ?? null) as PlayerSession | null) ?? null;

  function persistSession(session: PlayerSession | null) {
    currentSession = session;
    if (!storage) {
      return;
    }
    if (!session) {
      storage.removeItem(storageKey);
      return;
    }
    const persistedSession = session.zkLogin ? { ...session, zkLogin: undefined } : session;
    storage.setItem(storageKey, JSON.stringify(persistedSession));
  }

  function readPersistedSession() {
    currentSession = (safeJsonParse(storage?.getItem(storageKey) ?? null) as PlayerSession | null) ?? null;
    return currentSession;
  }

  function persistPendingLogin(pendingLogin: PendingLogin | null) {
    if (!sessionStorage) {
      return;
    }
    if (!pendingLogin) {
      sessionStorage.removeItem(pendingLoginStorageKey);
      return;
    }
    sessionStorage.setItem(pendingLoginStorageKey, JSON.stringify(pendingLogin));
  }

  function readPendingLogin() {
    return (safeJsonParse(sessionStorage?.getItem(pendingLoginStorageKey) ?? null) as PendingLogin | null) ?? null;
  }

  function persistPopupCompletion(result: PopupCompletionResult | null) {
    if (!sessionStorage) {
      return;
    }
    if (!result) {
      sessionStorage.removeItem(popupCompletionStorageKey);
      return;
    }
    sessionStorage.setItem(popupCompletionStorageKey, JSON.stringify(result));
  }

  function readPopupCompletion() {
    return (safeJsonParse(sessionStorage?.getItem(popupCompletionStorageKey) ?? null) as PopupCompletionResult | null) ?? null;
  }

  function persistZkLoginEphemeralSession(zkLoginSession: ZkLoginEphemeralSession | null) {
    if (!sessionStorage) {
      return;
    }
    if (!zkLoginSession) {
      sessionStorage.removeItem(zkLoginSessionStorageKey);
      return;
    }
    sessionStorage.setItem(zkLoginSessionStorageKey, JSON.stringify(zkLoginSession));
  }

  function readZkLoginEphemeralSession() {
    return (safeJsonParse(sessionStorage?.getItem(zkLoginSessionStorageKey) ?? null) as ZkLoginEphemeralSession | null) ?? null;
  }

  async function getAccessToken() {
    if (typeof tokenProvider === "function") {
      return tokenProvider();
    }
    return currentSession?.accessToken ?? null;
  }

  async function authorizedFetch(path: string, init: RequestInit = {}) {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("player session is required");
    }

    const headers = new Headers(init.headers ?? {});
    headers.set("authorization", `Bearer ${token}`);

    const hasJsonBody = init.body !== undefined && !headers.has("content-type");
    if (hasJsonBody) {
      headers.set("content-type", "application/json");
    }

    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers
    });
  }

  async function getJson(path: string, fallbackMessage: string) {
    const response = await authorizedFetch(path);
    return parseJson(response, fallbackMessage);
  }

  async function postJson(path: string, body: Record<string, unknown>, fallbackMessage: string) {
    const response = await authorizedFetch(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
    return parseJson(response, fallbackMessage);
  }

  function requireActivePlayerSession() {
    const session = currentSession ?? readPersistedSession();
    if (!session) {
      throw new Error("player session is required");
    }
    if (isExpiredTimestamp(session.expiresAt)) {
      throw new Error("player session is expired");
    }
    return session;
  }

  function requireActiveZkLoginSessionMaterial() {
    const session = requireActivePlayerSession();
    const ephemeralSession = readZkLoginEphemeralSession();
    const zkLoginCandidate = ephemeralSession?.nonce ? { ...session.zkLogin, ...ephemeralSession } : null;

    if (
      !zkLoginCandidate?.ephemeralPrivateKey ||
      !zkLoginCandidate.nonce ||
      !zkLoginCandidate.addressSeed ||
      !zkLoginCandidate.issuer ||
      !zkLoginCandidate.audience ||
      !zkLoginCandidate.subject ||
      !zkLoginCandidate.userSalt ||
      !zkLoginCandidate.proof
    ) {
      throw new Error("zkLogin session material is missing or expired");
    }

    if (
      zkLoginCandidate.ephemeralPublicKey !== session.zkLogin?.ephemeralPublicKey &&
      zkLoginCandidate.ephemeralPublicKey !== ephemeralSession?.ephemeralPublicKey
    ) {
      throw new Error("zkLogin session material does not match the authenticated player session");
    }

    return {
      session,
      zkLogin: zkLoginCandidate as ActiveZkLoginSessionMaterial
    };
  }

  function requireRpcClient() {
    if (!rpcClient) {
      throw new Error("Sui RPC configuration is required for say_hello execution");
    }
    return rpcClient;
  }

  async function buildSayHelloTransaction(username: string) {
    const session = requireActivePlayerSession();
    const catalog = (await getJson(
      `/v1/apps/${encodeURIComponent(appId)}/catalog`,
      "failed to load app catalog"
    )) as BrowserCatalogResponse;
    if (!catalog.registeredProgram) {
      throw new Error("registered Sui program is not available for this app");
    }

    return buildCanonicalHelloCelerisSayHelloTransaction({
      registeredProgram: catalog.registeredProgram,
      playerWalletAddress: session.player.walletAddress,
      username
    });
  }

  async function signSponsoredSayHelloTransaction(transactionBytes: string) {
    const { zkLogin } = requireActiveZkLoginSessionMaterial();
    const ephemeralKeypair = Ed25519Keypair.fromSecretKey(zkLogin.ephemeralPrivateKey);
    const userSignature = await ephemeralKeypair.signTransaction(fromBase64(transactionBytes));

    return getZkLoginSignature({
      inputs: {
        proofPoints: zkLogin.proof.proofPoints,
        issBase64Details: zkLogin.proof.issBase64Details,
        headerBase64: zkLogin.proof.headerBase64,
        addressSeed: zkLogin.addressSeed
      },
      maxEpoch: zkLogin.maxEpoch,
      userSignature: userSignature.signature
    });
  }

  function extractSubmittedDigest(result: unknown) {
    const parsed = (result ?? {}) as Record<string, unknown>;
    const digest =
      (typeof parsed.digest === "string" && parsed.digest) ||
      (typeof parsed.transactionDigest === "string" && parsed.transactionDigest) ||
      (((parsed.effects as Record<string, unknown> | undefined)?.transactionDigest as string | undefined) ?? null);

    if (!digest) {
      throw new Error("Sui RPC response did not include a transaction digest");
    }

    return digest;
  }

  async function completeSayHello(
    reservationId: string,
    body: { outcome: "submitted"; digest: string } | { outcome: "failed" },
    idempotencyKey?: string
  ) {
    return (await postJson(
      `/v1/apps/${encodeURIComponent(appId)}/actions/say_hello/complete`,
      {
        reservationId,
        ...body,
        ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:complete` } : {})
      },
      "failed to reconcile say_hello transaction"
    )) as SayHelloCompletionResponse;
  }

  async function executeSayHello(username: string, { idempotencyKey }: ExecuteActionOptions = {}) {
    const built = await buildSayHelloTransaction(username);
    const prepared = (await postJson(
      `/v1/apps/${encodeURIComponent(appId)}/actions/say_hello/execute`,
      {
        payload: {
          username: built.normalizedUsername,
          transactionKind: built.transactionKind
        },
        ...(idempotencyKey ? { idempotencyKey } : {})
      },
      "failed to prepare sponsored say_hello transaction"
    )) as PreparedSayHelloResponse;

    if (prepared.username !== built.normalizedUsername) {
      throw new Error("prepared say_hello username does not match the canonical browser builder");
    }
    if (prepared.message !== renderHelloCelerisMessage(built.normalizedUsername)) {
      throw new Error("prepared say_hello message does not match the canonical browser builder");
    }
    if (!prepared.sponsorAddress) {
      throw new Error("prepared say_hello response is missing sponsor metadata");
    }
    if (isExpiredTimestamp(prepared.expiresAt)) {
      throw new Error("prepared say_hello transaction is already expired");
    }

    try {
      const zkLoginSignature = await signSponsoredSayHelloTransaction(prepared.transactionBytes);
      const submitted = await requireRpcClient().executeTransactionBlock({
        transactionBlock: prepared.transactionBytes,
        signature: [zkLoginSignature, prepared.sponsorSignature],
        options: {
          showEffects: true
        }
      });
      const digest = extractSubmittedDigest(submitted);
      const completion = await completeSayHello(prepared.reservationId, { outcome: "submitted", digest }, idempotencyKey);

      return {
        reservationId: prepared.reservationId,
        digest,
        rpc: submitted,
        completion
      };
    } catch (error) {
      await completeSayHello(prepared.reservationId, { outcome: "failed" }, idempotencyKey).catch(() => undefined);
      throw error;
    }
  }

  async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
    const exchangeResponse = await fetchImpl(`${baseUrl}/v1/auth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        grantType: "authorization_code",
        code,
        codeVerifier
      })
    });
    const session = (await parseJson(exchangeResponse, "failed to exchange authorization code")) as PlayerSession;
    const ephemeralSession = readZkLoginEphemeralSession();
    if (session.zkLogin) {
      if (!ephemeralSession || ephemeralSession.ephemeralPublicKey !== session.zkLogin.ephemeralPublicKey) {
        throw new Error("zkLogin ephemeral session is missing or does not match the login request");
      }
      persistZkLoginEphemeralSession({
        ...ephemeralSession,
        nonce: session.zkLogin.nonce,
        maxEpoch: session.zkLogin.maxEpoch,
        userSalt: session.zkLogin.userSalt,
        issuer: session.zkLogin.issuer,
        audience: session.zkLogin.audience,
        subject: session.zkLogin.subject,
        addressSeed: session.zkLogin.addressSeed,
        proof: session.zkLogin.proof
      });
    }
    persistSession(session);
    return session;
  }

  function notifyOpener(result: { state: string; status: "success"; session: PlayerSession } | { state: string; status: "error"; error: string }) {
    const opener = runtimeWindow?.opener;
    const targetOrigin = readPendingLogin()?.frontendOrigin ?? runtimeWindow?.location?.origin;
    if (!opener?.postMessage || !targetOrigin) {
      return;
    }
    opener.postMessage(
      {
        type: "celeris-auth-callback",
        ...result
      },
      targetOrigin
    );
  }

  function finalizeCallbackUrl(redirectUri: string) {
    if (!runtimeWindow?.history?.replaceState) {
      return;
    }
    const redirectUrl = new URL(redirectUri);
    const appPath = redirectUrl.pathname.replace(/\/auth\/callback\/?$/, "/");
    runtimeWindow.history.replaceState({}, "", `${appPath}${redirectUrl.hash}`);
  }

  async function handleCallback({ url }: HandleCallbackOptions = {}) {
    const callbackUrl = url ?? runtimeWindow?.location?.href;
    if (!callbackUrl) {
      return null;
    }

    const parsedUrl = new URL(callbackUrl, "http://localhost");
    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");
    if (!code && !state) {
      return null;
    }
    if (!code || !state) {
      throw new Error("hosted auth callback is missing required parameters");
    }

    const pendingLogin = readPendingLogin();
    if (!pendingLogin) {
      throw new Error("hosted auth callback has no pending login state");
    }
    if (pendingLogin.state !== state) {
      throw new Error("hosted auth callback state mismatch");
    }

    try {
      const session = await exchangeAuthorizationCode(code, pendingLogin.codeVerifier);
      persistPendingLogin(null);
      persistPopupCompletion({ state, status: "success", session });
      finalizeCallbackUrl(pendingLogin.redirectUri);
      notifyOpener({ state, status: "success", session });
      if (runtimeWindow?.opener) {
        runtimeWindow.close?.();
      }
      return session;
    } catch (error) {
      const result = {
        state,
        status: "error",
        error: error instanceof Error ? error.message : "hosted auth callback failed"
      } satisfies PopupCompletionResult;
      persistPopupCompletion(result);
      notifyOpener(result);
      throw error;
    }
  }

  async function waitForPopupCompletion(expectedOrigin: string, popup: PopupLike | null) {
    if (auth?.waitForMessage) {
      return auth.waitForMessage(expectedOrigin, popup);
    }

    if (
      !runtimeWindow ||
      typeof runtimeWindow.addEventListener !== "function" ||
      typeof runtimeWindow.removeEventListener !== "function" ||
      typeof runtimeWindow.setTimeout !== "function" ||
      typeof runtimeWindow.clearTimeout !== "function"
    ) {
      throw new Error("message listener requires a browser window");
    }
    const listenerWindow = runtimeWindow;

    return new Promise<{ origin: string; data: PopupCompletionResult }>((resolve, reject) => {
      let pollTimer: ReturnType<typeof setTimeout> | null = null;

      const timeout = listenerWindow.setTimeout!(() => {
        cleanup();
        popup?.close?.();
        reject(new Error("hosted login timed out"));
      }, 60_000);

      function cleanup() {
        listenerWindow.removeEventListener!("message", handleMessage);
        listenerWindow.clearTimeout!(timeout);
        if (pollTimer) {
          listenerWindow.clearTimeout!(pollTimer);
        }
      }

      function schedulePoll() {
        pollTimer = listenerWindow.setTimeout!(() => {
          const completion = readPopupCompletion();
          if (completion) {
            cleanup();
            popup?.close?.();
            resolve({
              origin: expectedOrigin,
              data: completion
            });
            return;
          }
          schedulePoll();
        }, 200);
      }

      function handleMessage(event: any) {
        if (event.origin !== expectedOrigin) {
          return;
        }
        const data = event.data ?? {};
        if (data.type !== "celeris-auth-callback" || typeof data.state !== "string") {
          return;
        }
        cleanup();
        popup?.close?.();
        resolve({
          origin: event.origin,
          data
        });
      }

      listenerWindow.addEventListener!("message", handleMessage);
      schedulePoll();
    });
  }

  async function login({ mode = "popup" }: { mode?: AuthFlowMode } = {}) {
    if (!auth) {
      throw new Error("auth configuration is required");
    }

    const { codeVerifier, codeChallenge } = await createPkcePair();
    const frontendOrigin = auth.frontendOrigin ?? resolveWindowOrigin(runtimeWindow);
    const redirectUri = auth.redirectUri ?? `${frontendOrigin}/auth/callback`;
    const state = createRandomState();
    const zkLoginEphemeralSession = await createZkLoginEphemeralSession(0);
    persistZkLoginEphemeralSession(zkLoginEphemeralSession);
    persistPendingLogin({
      state,
      codeVerifier,
      redirectUri,
      frontendOrigin,
      ephemeralPublicKey: zkLoginEphemeralSession.ephemeralPublicKey,
      createdAt: new Date().toISOString()
    });
    const loginRequestResponse = await fetchImpl(`${baseUrl}/v1/auth/login-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: frontendOrigin
      },
      body: JSON.stringify({
        projectId,
        redirectUri,
        codeChallenge,
        zkLogin: {
          ephemeralPublicKey: zkLoginEphemeralSession.ephemeralPublicKey,
          jwtRandomness: zkLoginEphemeralSession.jwtRandomness
        }
      })
    });
    const loginRequest = (await parseJson(loginRequestResponse, "failed to create login request")) as LoginRequestResponse;
    persistZkLoginEphemeralSession({
      ...zkLoginEphemeralSession,
      nonce: loginRequest.zkLoginNonce,
      maxEpoch: loginRequest.zkLoginMaxEpoch
    });
    const hostedLoginUrl = new URL(loginRequest.hostedLoginUrl);
    hostedLoginUrl.searchParams.set("state", state);

    if (mode === "redirect") {
      runtimeWindow?.location?.assign?.(hostedLoginUrl.toString());
      return null;
    }

    persistPopupCompletion(null);
    const popup = (auth.openPopup ?? defaultPopupOpener)(
      hostedLoginUrl.toString(),
      "celeris-login",
      "popup=yes,width=460,height=720"
    );
    if (!popup) {
      runtimeWindow?.location?.assign?.(hostedLoginUrl.toString());
      return null;
    }

    const callbackOrigin = new URL(redirectUri).origin;
    const message = await waitForPopupCompletion(callbackOrigin, popup);
    if (message.origin !== callbackOrigin) {
      throw new Error("popup completion only accepts messages from the callback origin");
    }
    if (message.data.state !== state) {
      throw new Error("popup completion state mismatch");
    }
    if (message.data.status === "error") {
      persistPopupCompletion(null);
      throw new Error(String(message.data.error || "hosted auth callback failed"));
    }

    const session = readPersistedSession() ?? message.data.session;
    if (!session) {
      throw new Error("player session was not established by the hosted auth callback");
    }
    persistSession(session);
    persistPendingLogin(null);
    persistPopupCompletion(null);
    return session;
  }

  function logout() {
    persistSession(null);
    persistPendingLogin(null);
    persistPopupCompletion(null);
    persistZkLoginEphemeralSession(null);
  }

  return {
    auth: {
      async login(options?: { mode?: AuthFlowMode }) {
        return login(options);
      },
      async handleCallback(options?: HandleCallbackOptions) {
        return handleCallback(options);
      },
      logout,
      getSession() {
        const session = currentSession ?? readPersistedSession();
        const ephemeralSession = readZkLoginEphemeralSession();
        if (!session) {
          return null;
        }
        if (!session.zkLogin && !ephemeralSession?.nonce) {
          return session;
        }
        return {
          ...session,
          zkLogin: {
            nonce: ephemeralSession?.nonce ?? session.zkLogin?.nonce ?? "",
            ephemeralPublicKey: ephemeralSession?.ephemeralPublicKey ?? session.zkLogin?.ephemeralPublicKey ?? "",
            maxEpoch: ephemeralSession?.maxEpoch ?? session.zkLogin?.maxEpoch ?? 0,
            userSalt: ephemeralSession?.userSalt ?? session.zkLogin?.userSalt ?? "",
            issuer: ephemeralSession?.issuer ?? session.zkLogin?.issuer ?? "",
            audience: ephemeralSession?.audience ?? session.zkLogin?.audience ?? "",
            subject: ephemeralSession?.subject ?? session.zkLogin?.subject ?? "",
            addressSeed: ephemeralSession?.addressSeed ?? session.zkLogin?.addressSeed ?? "",
            proof:
              ephemeralSession?.proof ??
              session.zkLogin?.proof ?? {
                proofDigest: "",
                proverOrigin: "",
                proofPoints: {
                  a: ["", ""],
                  b: [["", ""], ["", ""]],
                  c: ["", ""]
                },
                issBase64Details: {
                  value: "",
                  indexMod4: 0
                },
                headerBase64: ""
              }
          }
        };
      }
    },
    me: {
      get() {
        return getJson("/v1/me", "failed to load player identity");
      }
    },
    catalog: {
      get() {
        return getJson(`/v1/apps/${encodeURIComponent(appId)}/catalog`, "failed to load app catalog");
      }
    },
    credits: {
      getBalance() {
        return getJson(`/v1/apps/${encodeURIComponent(appId)}/me/credits`, "failed to load credit balance");
      }
    },
    payments: {
      createCheckoutSession({ packageId, successUrl, cancelUrl, idempotencyKey }: CheckoutSessionInput) {
        return postJson(
          `/v1/apps/${encodeURIComponent(appId)}/checkout-sessions`,
          {
            packageId,
            successUrl,
            cancelUrl,
            idempotencyKey
          },
          "failed to create checkout session"
        );
      }
    },
    actions: {
      async buildSayHelloTransaction(username: string) {
        return buildSayHelloTransaction(username);
      },
      execute(actionId: string, payload: Record<string, unknown> | undefined = undefined, { idempotencyKey }: ExecuteActionOptions = {}) {
        if (actionId === "say_hello") {
          if (!payload || typeof payload.username !== "string") {
            throw new Error("say_hello requires a username payload");
          }
          return executeSayHello(payload.username, { idempotencyKey });
        }

        return postJson(
          `/v1/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(actionId)}/execute`,
          {
            ...(payload === undefined ? {} : { payload }),
            ...(idempotencyKey ? { idempotencyKey } : {})
          },
          `failed to execute action ${actionId}`
        );
      }
    },
    assets: {
      getHistory() {
        return getJson(`/v1/apps/${encodeURIComponent(appId)}/me/asset-history`, "failed to load asset history");
      }
    },
    transactions: {
      list() {
        return getJson(`/v1/apps/${encodeURIComponent(appId)}/transactions`, "failed to load app transactions");
      }
    }
  };
}
