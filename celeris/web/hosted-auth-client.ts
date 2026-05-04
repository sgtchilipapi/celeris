import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getUserEmbeddedSolanaWallet
} from "@privy-io/js-sdk-core";

type HostedAuthConfig = {
  loginRequestId: string;
  privyAppId: string;
  privyClientId?: string | null;
  googleOAuthEnabled: boolean;
  hostedAuthOrigin: string;
  authApiBaseUrl: string;
  allowedChainId: string;
};

declare global {
  interface Window {
    CELERIS_HOSTED_AUTH_CONFIG?: HostedAuthConfig;
  }
}

const hostedAuthConfig = getHostedAuthConfig();

const loginButton = requireElement<HTMLButtonElement>("login-button");
const feedback = requireElement<HTMLParagraphElement>("feedback");

const privy = new Privy({
  appId: hostedAuthConfig.privyAppId,
  ...(hostedAuthConfig.privyClientId ? { clientId: hostedAuthConfig.privyClientId } : {}),
  storage: new LocalStorage()
});
const callbackStateStorageKey = `celeris-hosted-auth:${hostedAuthConfig.loginRequestId}:callback-state`;
const oauthProgressStorageKey = `celeris-hosted-auth:${hostedAuthConfig.loginRequestId}:google-oauth-in-progress`;

let initialized = false;

void initialize();

function getHostedAuthConfig() {
  const config = window.CELERIS_HOSTED_AUTH_CONFIG;
  if (!config) {
    throw new Error("Celeris hosted auth config is missing");
  }
  return config;
}

function requireElement<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing hosted auth element: ${id}`);
  }
  return element as T;
}

async function initialize() {
  setBusy(loginButton, true);
  try {
    if (!hostedAuthConfig.googleOAuthEnabled) {
      throw new Error("Google login is not enabled for this hosted auth deployment");
    }

    captureCallbackStateFromRequest();
    await privy.initialize();
    await initializeEmbeddedWalletIframe();
    initialized = true;

    const oauthCallback = readGoogleOAuthCallback();
    if (oauthCallback) {
      loginButton.textContent = "Completing Google sign-in...";
      const { user } = await privy.auth.oauth.loginWithCode(
        oauthCallback.authorizationCode,
        oauthCallback.returnedStateCode,
        "google",
        undefined,
        "login-or-sign-up",
        {
          embedded: embeddedWalletLoginConfigForChain(hostedAuthConfig.allowedChainId)
        }
      );
      const ensuredUser = await ensureWallet(user);
      await completeHostedLogin(ensuredUser);
      return;
    }

    const existingUser = await getExistingUser();
    if (existingUser && readOAuthInProgress()) {
      loginButton.textContent = "Finalizing Google sign-in...";
      const ensuredUser = await ensureWallet(existingUser);
      await completeHostedLogin(ensuredUser);
      return;
    }

    if (existingUser) {
      loginButton.textContent = "Continue with existing Google session";
    }
  } catch (error) {
    clearOAuthInProgress();
    setFeedback(error instanceof Error ? error.message : "Failed to initialize hosted auth");
  } finally {
    setBusy(loginButton, false);
  }
}

loginButton.addEventListener("click", async () => {
  if (!initialized) {
    return;
  }

  setBusy(loginButton, true);
  setFeedback("");
  try {
    const existingUser = await getExistingUser();
    if (!existingUser) {
      const redirectUrl = buildGoogleRedirectUrl();
      markOAuthInProgress();
      const oauthInit = await privy.auth.oauth.generateURL("google", redirectUrl);
      window.location.assign(oauthInit.url);
      return;
    }

    const ensuredUser = await ensureWallet(existingUser);
    await completeHostedLogin(ensuredUser);
  } catch (error) {
    clearOAuthInProgress();
    setFeedback(error instanceof Error ? error.message : "Privy login failed");
  } finally {
    setBusy(loginButton, false);
  }
});

async function initializeEmbeddedWalletIframe() {
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = privy.embeddedWallet.getURL();
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Timed out initializing Privy embedded wallet")), 30_000);

    iframe.addEventListener("load", () => {
      window.clearTimeout(timeout);
      if (!iframe.contentWindow) {
        reject(new Error("Privy embedded wallet iframe is unavailable"));
        return;
      }
      privy.setMessagePoster({
        postMessage: (message, targetOrigin, transfer) => iframe.contentWindow?.postMessage(message, targetOrigin, transfer ? [transfer] : []),
        reload: () => iframe.contentWindow?.location.reload()
      });
      resolve();
    });

    iframe.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Failed to load Privy embedded wallet iframe"));
    });
  });
}

async function getExistingUser() {
  try {
    const { user } = await privy.user.get();
    return user;
  } catch {
    return null;
  }
}

async function refreshCurrentUser() {
  const refreshed = await getExistingUser();
  if (!refreshed) {
    throw new Error("Privy session is unavailable");
  }
  return refreshed;
}

async function ensureWallet(user: any) {
  if (hostedAuthConfig.allowedChainId.startsWith("eip155:")) {
    if (getUserEmbeddedEthereumWallet(user)) {
      return refreshCurrentUser();
    }
    await privy.embeddedWallet.create({
      idempotencyKey: `celeris-hosted-auth:${hostedAuthConfig.loginRequestId}`,
      solanaAccount: getUserEmbeddedSolanaWallet(user) ?? undefined
    });
    return refreshCurrentUser();
  }

  if (hostedAuthConfig.allowedChainId.startsWith("solana:")) {
    if (getUserEmbeddedSolanaWallet(user)) {
      return refreshCurrentUser();
    }
    await privy.embeddedWallet.createSolana();
    return refreshCurrentUser();
  }

  throw new Error(`Unsupported hosted auth chain: ${hostedAuthConfig.allowedChainId}`);
}

async function completeHostedLogin(_user: any) {
  const privyAccessToken = await privy.getAccessToken();
  if (!privyAccessToken) {
    throw new Error("Privy access token is missing after login");
  }

  const callbackState = readStoredCallbackState();
  if (!callbackState) {
    throw new Error("Hosted login is missing callback state");
  }

  const tokenUrl = new URL("/v1/auth/token", hostedAuthConfig.authApiBaseUrl).toString();
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "privy_access_token",
      loginRequestId: hostedAuthConfig.loginRequestId,
      privyAccessToken
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Hosted login failed");
  }

  const redirectUrl = new URL(payload.redirectUri);
  redirectUrl.searchParams.set("code", payload.code);
  redirectUrl.searchParams.set("state", callbackState);
  clearStoredCallbackState();
  clearOAuthInProgress();
  window.location.assign(redirectUrl.toString());
}

function buildGoogleRedirectUrl() {
  const redirectUrl = new URL(window.location.href);
  redirectUrl.searchParams.delete("code");
  redirectUrl.searchParams.delete("state");
  redirectUrl.searchParams.delete("authorization_code");
  redirectUrl.searchParams.delete("state_code");
  return redirectUrl.toString();
}

function readGoogleOAuthCallback() {
  const params = new URL(window.location.href).searchParams;
  const authorizationCode =
    params.get("privy_oauth_code") ??
    params.get("authorization_code") ??
    params.get("code");
  const returnedStateCode =
    params.get("privy_oauth_state") ??
    params.get("state_code") ??
    params.get("oauth_state") ??
    params.get("state");
  if (!authorizationCode) {
    return null;
  }
  if (!returnedStateCode) {
    throw new Error("Google hosted auth callback is missing required parameters");
  }
  return {
    authorizationCode,
    returnedStateCode
  };
}

function captureCallbackStateFromRequest() {
  if (window.localStorage.getItem(callbackStateStorageKey)) {
    return;
  }
  const callbackState = new URL(window.location.href).searchParams.get("state");
  if (!callbackState) {
    return;
  }
  window.localStorage.setItem(callbackStateStorageKey, callbackState);
}

function readStoredCallbackState() {
  return window.localStorage.getItem(callbackStateStorageKey);
}

function clearStoredCallbackState() {
  window.localStorage.removeItem(callbackStateStorageKey);
}

function markOAuthInProgress() {
  window.localStorage.setItem(oauthProgressStorageKey, "true");
}

function readOAuthInProgress() {
  return window.localStorage.getItem(oauthProgressStorageKey) === "true";
}

function clearOAuthInProgress() {
  window.localStorage.removeItem(oauthProgressStorageKey);
}

function embeddedWalletLoginConfigForChain(allowedChainId: string) {
  if (allowedChainId.startsWith("eip155:")) {
    return {
      ethereum: {
        createOnLogin: "all-users" as const
      }
    };
  }
  if (allowedChainId.startsWith("solana:")) {
    return {
      solana: {
        createOnLogin: "all-users" as const
      }
    };
  }
  throw new Error(`Unsupported hosted auth chain: ${allowedChainId}`);
}

function setFeedback(message: string) {
  feedback.textContent = message;
}

function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
}
