type HostedAuthConfig = {
  loginRequestId: string;
  googleClientId: string;
  googleIssuer: string;
  googleAuthorizeUrl: string;
  googleCallbackUrl: string;
  zkLoginNonce: string;
  zkLoginMaxEpoch: number;
  hostedAuthOrigin: string;
  authApiBaseUrl: string;
  allowedChainId: string;
};

declare global {
  interface Window {
    CELERIS_HOSTED_AUTH_CONFIG?: HostedAuthConfig;
  }
}

const loginButton = requireElement<HTMLButtonElement>("login-button");
const feedback = requireElement<HTMLParagraphElement>("feedback");

void initialize();

function getHostedAuthConfig() {
  return window.CELERIS_HOSTED_AUTH_CONFIG ?? null;
}

function requireElement<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing hosted auth element: ${id}`);
  }
  return element as T;
}

async function initialize() {
  const hostedAuthConfig = getHostedAuthConfig();
  setBusy(loginButton, false);
  const callback = readGoogleCallback();
  if (!callback) {
    if (!hostedAuthConfig) {
      throw new Error("Celeris hosted auth config is missing");
    }
    captureCallbackStateFromRequest(hostedAuthConfig.loginRequestId);
    loginButton.textContent = "Continue with Google";
    return;
  }

  setBusy(loginButton, true);
  try {
    await completeHostedLogin(callback.loginRequestId, callback.googleIdToken);
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Hosted login failed");
  } finally {
    setBusy(loginButton, false);
  }
}

loginButton.addEventListener("click", async () => {
  const hostedAuthConfig = getHostedAuthConfig();
  if (!hostedAuthConfig) {
    throw new Error("Celeris hosted auth config is missing");
  }
  setBusy(loginButton, true);
  setFeedback("");
  try {
    window.location.assign(buildGoogleAuthorizationUrl(hostedAuthConfig).toString());
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Hosted login failed");
    setBusy(loginButton, false);
  }
});

function buildGoogleAuthorizationUrl(hostedAuthConfig: HostedAuthConfig) {
  const authorizeUrl = new URL(hostedAuthConfig.googleAuthorizeUrl);
  authorizeUrl.searchParams.set("client_id", hostedAuthConfig.googleClientId);
  authorizeUrl.searchParams.set("redirect_uri", hostedAuthConfig.googleCallbackUrl);
  authorizeUrl.searchParams.set("response_type", "id_token");
  authorizeUrl.searchParams.set("response_mode", "fragment");
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("nonce", hostedAuthConfig.zkLoginNonce);
  authorizeUrl.searchParams.set("state", hostedAuthConfig.loginRequestId);
  authorizeUrl.searchParams.set("prompt", "select_account");
  return authorizeUrl;
}

async function completeHostedLogin(loginRequestId: string, googleIdToken: string) {
  const callbackState = readStoredCallbackState(loginRequestId);
  if (!callbackState) {
    throw new Error("Hosted login is missing callback state");
  }

  const tokenUrl = new URL("/v1/auth/token", window.location.origin).toString();
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "google_identity_token",
      loginRequestId,
      googleIdToken
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Hosted login failed");
  }

  const redirectUrl = new URL(payload.redirectUri);
  redirectUrl.searchParams.set("code", payload.code);
  redirectUrl.searchParams.set("state", callbackState);
  clearStoredCallbackState(loginRequestId);
  window.location.assign(redirectUrl.toString());
}

function readGoogleCallback() {
  const url = new URL(window.location.href);
  const params = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")) : url.searchParams;
  const googleIdToken = params.get("id_token") ?? params.get("google_id_token");
  const loginRequestId = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  if (error) {
    throw new Error(errorDescription || error);
  }
  if (!googleIdToken || !loginRequestId) {
    return null;
  }
  if (url.hash) {
    window.history.replaceState({}, "", url.pathname);
  }
  return { googleIdToken, loginRequestId };
}

function callbackStateStorageKey(loginRequestId: string) {
  return `celeris-hosted-auth:${loginRequestId}:callback-state`;
}

function captureCallbackStateFromRequest(loginRequestId: string) {
  const url = new URL(window.location.href);
  const state = url.searchParams.get("state");
  if (!state) {
    return;
  }
  sessionStorage.setItem(callbackStateStorageKey(loginRequestId), state);
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
}

function readStoredCallbackState(loginRequestId: string) {
  return sessionStorage.getItem(callbackStateStorageKey(loginRequestId));
}

function clearStoredCallbackState(loginRequestId: string) {
  sessionStorage.removeItem(callbackStateStorageKey(loginRequestId));
}

function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  if (busy) {
    button.textContent = "Continuing...";
  }
}

function setFeedback(message: string) {
  feedback.textContent = message;
}
