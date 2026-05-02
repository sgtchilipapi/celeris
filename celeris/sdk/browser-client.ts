type FetchLike = typeof fetch;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type PopupLike = {
  close?: () => void;
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

function resolveWindowOrigin() {
  if (typeof window === "undefined" || !window.location?.origin) {
    throw new Error("frontend origin is required");
  }
  return window.location.origin;
}

function getStorage(candidate: StorageLike | null | undefined) {
  if (candidate) {
    return candidate;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
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
  if (typeof window === "undefined" || typeof window.open !== "function") {
    throw new Error("popup login requires a browser window");
  }
  return window.open(url, target, features);
}

function defaultWaitForMessage(expectedOrigin: string, popup: PopupLike | null) {
  if (typeof window === "undefined") {
    throw new Error("message listener requires a browser window");
  }

  return new Promise<{ origin: string; data: any }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      popup?.close?.();
      reject(new Error("hosted login timed out"));
    }, 60_000);

    function handleMessage(event: MessageEvent) {
      if (event.origin !== expectedOrigin) {
        return;
      }
      const data = event.data ?? {};
      if (data.type !== "celeris-auth-complete" || typeof data.code !== "string") {
        return;
      }
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeout);
      popup?.close?.();
      resolve({
        origin: event.origin,
        data
      });
    }

    window.addEventListener("message", handleMessage);
  });
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
  const storage = getStorage(auth?.storage);
  const storageKey = auth?.storageKey ?? `celeris-player-session:${projectId}`;
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

  async function login() {
    if (!auth) {
      throw new Error("auth configuration is required");
    }

    const { codeVerifier, codeChallenge } = await createPkcePair();
    const frontendOrigin = auth.frontendOrigin ?? resolveWindowOrigin();
    const redirectUri = auth.redirectUri ?? `${frontendOrigin}/auth/callback`;
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
    const hostedLoginOrigin = new URL(loginRequest.hostedLoginUrl).origin;
    const popup = (auth.openPopup ?? defaultPopupOpener)(
      loginRequest.hostedLoginUrl,
      "celeris-login",
      "popup=yes,width=460,height=720"
    );
    if (!popup) {
      throw new Error("login popup was blocked");
    }

    const message = await (auth.waitForMessage ?? defaultWaitForMessage)(hostedLoginOrigin, popup);
    if (message.origin !== hostedLoginOrigin) {
      throw new Error("popup completion only accepts messages from the hosted auth origin");
    }

    const exchangeResponse = await fetchImpl(`${baseUrl}/v1/auth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        grantType: "authorization_code",
        code: message.data.code,
        codeVerifier
      })
    });
    const session = (await parseJson(exchangeResponse, "failed to exchange authorization code")) as PlayerSession;
    persistSession(session);
    return session;
  }

  function logout() {
    persistSession(null);
  }

  return {
    auth: {
      async login() {
        return login();
      },
      logout,
      getSession() {
        return currentSession;
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
