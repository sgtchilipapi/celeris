import { buildCanonicalHelloCelerisSayHelloTransaction } from "../sui/hello-celeris.js";

type FetchLike = typeof fetch;

type ServerClientOptions = {
  apiBaseUrl: string;
  accessToken?: string | null;
  fetchImpl?: FetchLike;
};

type DeveloperCredentials = {
  username: string;
  password: string;
  developerId?: string;
  idempotencyKey?: string;
};

type CreateAppInput = {
  name: string;
  priceCents: number;
  credits: number;
  allowedChainId: string;
  allowedFrontendOrigins?: string[];
  allowedRedirectUris?: string[];
  idempotencyKey?: string;
};

type UpdateAppInput = CreateAppInput;

type ConfigureActionInput = {
  actionType: string;
  cost: number;
  executionMode: "managed" | "server" | "webhook";
  idempotencyKey?: string;
};

type RegisterProgramInput = {
  packageId: string;
  appStateObjectId: string;
  authorityCapObjectId: string;
  idempotencyKey?: string;
};

type RegisteredProgramMetadata = {
  packageId: string;
  appStateObjectId: string;
  authorityCapObjectId: string;
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

export function createServerClient({ apiBaseUrl, accessToken = null, fetchImpl = globalThis.fetch }: ServerClientOptions) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const baseUrl = normalizeBaseUrl(apiBaseUrl);

  async function requestJson(
    path: string,
    {
      method = "GET",
      body,
      developerAccessToken = accessToken,
      playerAccessToken,
      idempotencyKey
    }: {
      method?: string;
      body?: Record<string, unknown>;
      developerAccessToken?: string | null;
      playerAccessToken?: string | null;
      idempotencyKey?: string;
    } = {}
  ) {
    const headers = new Headers();
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (idempotencyKey) {
      headers.set("idempotency-key", idempotencyKey);
    }
    if (developerAccessToken) {
      headers.set("authorization", `Bearer ${developerAccessToken}`);
    }
    if (playerAccessToken) {
      headers.set("authorization", `Bearer ${playerAccessToken}`);
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return parseJson(response, `request failed: ${path}`);
  }

  return {
    auth: {
      signUp({ username, password, developerId, idempotencyKey }: DeveloperCredentials) {
        return requestJson("/v1/developer/sign-up", {
          method: "POST",
          body: {
            username,
            password,
            developerId,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      signIn({ username, password }: DeveloperCredentials) {
        return requestJson("/v1/developer/sign-in", {
          method: "POST",
          body: {
            username,
            password
          }
        });
      }
    },
    apps: {
      list() {
        return requestJson("/v1/developer/apps");
      },
      create({ idempotencyKey, ...input }: CreateAppInput) {
        return requestJson("/v1/developer/apps", {
          method: "POST",
          body: {
            ...input,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      get(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}`);
      },
      getProgram(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/program`);
      },
      registerProgram(appId: string, { idempotencyKey, ...input }: RegisterProgramInput) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/program`, {
          method: "PUT",
          body: {
            ...input,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      getSponsorWallet(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/sponsor-wallet`);
      },
      createSponsorWallet(appId: string, { idempotencyKey }: { idempotencyKey?: string } = {}) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/sponsor-wallet`, {
          method: "POST",
          body: {
            idempotencyKey
          },
          idempotencyKey
        });
      },
      update(appId: string, { idempotencyKey, ...input }: UpdateAppInput) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}`, {
          method: "PUT",
          body: {
            ...input,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      delete(appId: string, { idempotencyKey }: { idempotencyKey?: string } = {}) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}`, {
          method: "DELETE",
          body: {
            idempotencyKey
          },
          idempotencyKey
        });
      },
      configureAction(appId: string, { idempotencyKey, ...input }: ConfigureActionInput) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/actions`, {
          method: "POST",
          body: {
            ...input,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      updateAction(appId: string, currentActionId: string, { idempotencyKey, ...input }: ConfigureActionInput & { actionType?: string }) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(currentActionId)}`, {
          method: "PUT",
          body: {
            ...input,
            idempotencyKey
          },
          idempotencyKey
        });
      },
      deleteAction(appId: string, actionId: string, { idempotencyKey }: { idempotencyKey?: string } = {}) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(actionId)}`, {
          method: "DELETE",
          body: {
            idempotencyKey
          },
          idempotencyKey
        });
      }
    },
    metrics: {
      getAppMetrics(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/metrics`);
      }
    },
    players: {
      list(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/players`);
      }
    },
    transactions: {
      list(appId: string) {
        return requestJson(`/v1/developer/apps/${encodeURIComponent(appId)}/transactions`);
      }
    },
    sui: {
      buildSayHelloTransaction({
        registeredProgram,
        playerWalletAddress,
        username
      }: {
        registeredProgram: RegisteredProgramMetadata;
        playerWalletAddress: string;
        username: string;
      }) {
        return buildCanonicalHelloCelerisSayHelloTransaction({
          registeredProgram,
          playerWalletAddress,
          username
        });
      }
    },
    asUser(playerAccessToken: string) {
      return {
        me: {
          get() {
            return requestJson("/v1/me", { playerAccessToken });
          }
        },
        catalog: {
          get(appId: string) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/catalog`, { playerAccessToken });
          }
        },
        credits: {
          getBalance(appId: string) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/me/credits`, { playerAccessToken });
          }
        },
        assets: {
          getHistory(appId: string) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/me/asset-history`, { playerAccessToken });
          }
        },
        transactions: {
          list(appId: string) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/transactions`, { playerAccessToken });
          }
        },
        payments: {
          createCheckoutSession(appId: string, body: { packageId: string; successUrl?: string; cancelUrl?: string; idempotencyKey?: string }) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/checkout-sessions`, {
              method: "POST",
              body,
              playerAccessToken,
              idempotencyKey: body.idempotencyKey
            });
          }
        },
        actions: {
          execute(
            appId: string,
            actionId: string,
            body: Record<string, unknown> & { payload?: Record<string, unknown>; idempotencyKey?: string } = {}
          ) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(actionId)}/execute`, {
              method: "POST",
              body,
              playerAccessToken,
              idempotencyKey: body.idempotencyKey
            });
          },
          completeSayHello(
            appId: string,
            body: { reservationId: string; outcome: "submitted" | "failed"; digest?: string; idempotencyKey?: string }
          ) {
            return requestJson(`/v1/apps/${encodeURIComponent(appId)}/actions/say_hello/complete`, {
              method: "POST",
              body,
              playerAccessToken,
              idempotencyKey: body.idempotencyKey
            });
          }
        }
      };
    }
  };
}
