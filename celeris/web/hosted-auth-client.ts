type HostedAuthConfig = {
  loginRequestId: string;
  googleClientId: string;
  googleIssuer: string;
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

const hostedAuthConfig = getHostedAuthConfig();

const loginButton = requireElement<HTMLButtonElement>("login-button");
const feedback = requireElement<HTMLParagraphElement>("feedback");
const callbackStateStorageKey = `celeris-hosted-auth:${hostedAuthConfig.loginRequestId}:callback-state`;

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
  setBusy(loginButton, false);
  captureCallbackStateFromRequest();
  const callback = readGoogleCallback();
  if (!callback) {
    loginButton.textContent = "Continue with Google";
    return;
  }

  setBusy(loginButton, true);
  try {
    await completeHostedLogin(callback.googleIdToken);
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Hosted login failed");
  } finally {
    setBusy(loginButton, false);
  }
}

loginButton.addEventListener("click", async () => {
  setBusy(loginButton, true);
  setFeedback("");
  try {
    const response = await fetch(new URL("/v1/auth/google/dev-token", hostedAuthConfig.authApiBaseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        loginRequestId: hostedAuthConfig.loginRequestId
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.googleIdToken) {
      throw new Error(payload?.error || "Failed to start Google sign-in");
    }

    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.set("google_id_token", payload.googleIdToken);
    window.location.assign(redirectUrl.toString());
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Hosted login failed");
    setBusy(loginButton, false);
  }
});

async function completeHostedLogin(googleIdToken: string) {
  const callbackState = readStoredCallbackState();
  if (!callbackState) {
    throw new Error("Hosted login is missing callback state");
  }

  const tokenUrl = new URL("/v1/auth/token", hostedAuthConfig.authApiBaseUrl).toString();
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "google_identity_token",
      loginRequestId: hostedAuthConfig.loginRequestId,
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
  clearStoredCallbackState();
  window.location.assign(redirectUrl.toString());
}

function readGoogleCallback() {
  const params = new URL(window.location.href).searchParams;
  const googleIdToken = params.get("google_id_token");
  if (!googleIdToken) {
    return null;
  }
  return { googleIdToken };
}

function captureCallbackStateFromRequest() {
  const url = new URL(window.location.href);
  const state = url.searchParams.get("state");
  if (!state) {
    return;
  }
  sessionStorage.setItem(callbackStateStorageKey, state);
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
}

function readStoredCallbackState() {
  return sessionStorage.getItem(callbackStateStorageKey);
}

function clearStoredCallbackState() {
  sessionStorage.removeItem(callbackStateStorageKey);
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
