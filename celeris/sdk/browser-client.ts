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
  createdAt: string;
};

type BrowserClientOptions = {
  apiBaseUrl: string;
  appId: string;
  tokenProvider?: () => Promise<string | null | undefined> | string | null | undefined;
  fetchImpl?: FetchLike;
  auth?: {
    projectId?: string;
    redirectUri?: string;
    frontendOrigin?: string;
    hostedAuthOrigin?: string;
    storageKey?: string;
    storage?: StorageLike | null;
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

type LoginRequestResponse = {
  loginRequestId: string;
  hostedLoginUrl: string;
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
};

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

export function createBrowserClient({
  apiBaseUrl,
  appId,
  tokenProvider,
  fetchImpl = globalThis.fetch,
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
  const projectId = auth?.projectId ?? appId;
  const runtimeWindow = getWindow(auth?.window);
  const storage = getStorage(auth?.storage, runtimeWindow);
  const storageKey = auth?.storageKey ?? `celeris-player-session:${projectId}`;
  const pendingLoginStorageKey = `${storageKey}:pending-login`;
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
    storage.setItem(storageKey, JSON.stringify(session));
  }

  function readPersistedSession() {
    currentSession = (safeJsonParse(storage?.getItem(storageKey) ?? null) as PlayerSession | null) ?? null;
    return currentSession;
  }

  function persistPendingLogin(pendingLogin: PendingLogin | null) {
    if (!storage) {
      return;
    }
    if (!pendingLogin) {
      storage.removeItem(pendingLoginStorageKey);
      return;
    }
    storage.setItem(pendingLoginStorageKey, JSON.stringify(pendingLogin));
  }

  function readPendingLogin() {
    return (safeJsonParse(storage?.getItem(pendingLoginStorageKey) ?? null) as PendingLogin | null) ?? null;
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
      finalizeCallbackUrl(pendingLogin.redirectUri);
      notifyOpener({ state, status: "success", session });
      if (runtimeWindow?.opener) {
        runtimeWindow.close?.();
      }
      return session;
    } catch (error) {
      notifyOpener({
        state,
        status: "error",
        error: error instanceof Error ? error.message : "hosted auth callback failed"
      });
      throw error;
    }
  }

  async function login({ mode = "popup" }: { mode?: AuthFlowMode } = {}) {
    if (!auth) {
      throw new Error("auth configuration is required");
    }

    const { codeVerifier, codeChallenge } = await createPkcePair();
    const frontendOrigin = auth.frontendOrigin ?? resolveWindowOrigin(runtimeWindow);
    const redirectUri = auth.redirectUri ?? `${frontendOrigin}/auth/callback`;
    const state = createRandomState();
    persistPendingLogin({
      state,
      codeVerifier,
      redirectUri,
      frontendOrigin,
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
        codeChallenge
      })
    });
    const loginRequest = (await parseJson(loginRequestResponse, "failed to create login request")) as LoginRequestResponse;
    const hostedLoginUrl = new URL(loginRequest.hostedLoginUrl);
    hostedLoginUrl.searchParams.set("state", state);

    if (mode === "redirect") {
      runtimeWindow?.location?.assign?.(hostedLoginUrl.toString());
      return null;
    }

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
    const message = await (auth.waitForMessage ?? defaultWaitForMessage)(callbackOrigin, popup);
    if (message.origin !== callbackOrigin) {
      throw new Error("popup completion only accepts messages from the callback origin");
    }
    if (message.data.state !== state) {
      throw new Error("popup completion state mismatch");
    }
    if (message.data.status === "error") {
      throw new Error(String(message.data.error || "hosted auth callback failed"));
    }

    const session = readPersistedSession();
    if (!session) {
      throw new Error("player session was not established by the hosted auth callback");
    }
    persistPendingLogin(null);
    return session;
  }

  function logout() {
    persistSession(null);
    persistPendingLogin(null);
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
        return currentSession ?? readPersistedSession();
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
      execute(actionId: string, payload: Record<string, unknown> | undefined = undefined, { idempotencyKey }: ExecuteActionOptions = {}) {
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
    }
  };
}
