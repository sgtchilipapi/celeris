type FetchLike = typeof fetch;

type BrowserClientOptions = {
  apiBaseUrl: string;
  appId: string;
  tokenProvider: () => Promise<string | null | undefined> | string | null | undefined;
  fetchImpl?: FetchLike;
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

function normalizeBaseUrl(apiBaseUrl: string) {
  return String(apiBaseUrl ?? "").replace(/\/+$/, "");
}

async function parseJson(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }
  return payload;
}

export function createBrowserClient({
  apiBaseUrl,
  appId,
  tokenProvider,
  fetchImpl = globalThis.fetch
}: BrowserClientOptions) {
  if (!appId) {
    throw new Error("appId is required");
  }
  if (typeof tokenProvider !== "function") {
    throw new Error("tokenProvider is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const baseUrl = normalizeBaseUrl(apiBaseUrl);

  async function authorizedFetch(path: string, init: RequestInit = {}) {
    const token = await tokenProvider();
    if (!token) {
      throw new Error("player token is required");
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

  return {
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
