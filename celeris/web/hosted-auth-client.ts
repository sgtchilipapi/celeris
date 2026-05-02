import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getUserEmbeddedSolanaWallet
} from "@privy-io/js-sdk-core";

type HostedAuthConfig = {
  loginRequestId: string;
  privyAppId: string;
  privyClientId?: string | null;
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
const emailStep = requireElement<HTMLDivElement>("email-step");
const emailInput = requireElement<HTMLInputElement>("email-input");
const sendCodeButton = requireElement<HTMLButtonElement>("send-code-button");
const codeStep = requireElement<HTMLDivElement>("code-step");
const codeInput = requireElement<HTMLInputElement>("code-input");
const verifyCodeButton = requireElement<HTMLButtonElement>("verify-code-button");
const feedback = requireElement<HTMLParagraphElement>("feedback");

const privy = new Privy({
  appId: hostedAuthConfig.privyAppId,
  ...(hostedAuthConfig.privyClientId ? { clientId: hostedAuthConfig.privyClientId } : {}),
  storage: new LocalStorage()
});

let submittedEmail = "";
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
    await privy.initialize();
    await initializeEmbeddedWalletIframe();
    initialized = true;

    const existingUser = await getExistingUser();
    if (existingUser) {
      loginButton.textContent = "Continue with existing Privy session";
    } else {
      emailStep.hidden = false;
      loginButton.textContent = "Use a different Privy session";
    }
  } catch (error) {
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
      emailStep.hidden = false;
      emailInput.focus();
      return;
    }

    const ensuredUser = await ensureWallet(existingUser);
    await completeHostedLogin(ensuredUser);
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Privy login failed");
  } finally {
    setBusy(loginButton, false);
  }
});

sendCodeButton.addEventListener("click", async () => {
  if (!initialized) {
    return;
  }

  const email = emailInput.value.trim();
  if (!email) {
    setFeedback("Email is required");
    emailInput.focus();
    return;
  }

  setBusy(sendCodeButton, true);
  setFeedback("");
  try {
    await privy.auth.email.sendCode(email);
    submittedEmail = email;
    codeStep.hidden = false;
    codeInput.focus();
    setFeedback("Verification code sent");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Failed to send verification code");
  } finally {
    setBusy(sendCodeButton, false);
  }
});

verifyCodeButton.addEventListener("click", async () => {
  if (!initialized) {
    return;
  }

  const code = codeInput.value.trim();
  if (!submittedEmail) {
    setFeedback("Send a verification code first");
    return;
  }
  if (!code) {
    setFeedback("Verification code is required");
    codeInput.focus();
    return;
  }

  setBusy(verifyCodeButton, true);
  setFeedback("");
  try {
    const { user } = await privy.auth.email.loginWithCode(submittedEmail, code);
    const ensuredUser = await ensureWallet(user);
    await completeHostedLogin(ensuredUser);
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Failed to verify code");
  } finally {
    setBusy(verifyCodeButton, false);
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
  if (!window.opener) {
    throw new Error("login opener not available");
  }

  window.opener.postMessage(
    {
      type: "celeris-auth-complete",
      code: payload.code,
      projectId: payload.projectId,
      redirectUri: payload.redirectUri,
      player: payload.player
    },
    payload.origin
  );

  window.close();
}

function setFeedback(message: string) {
  feedback.textContent = message;
}

function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
}
