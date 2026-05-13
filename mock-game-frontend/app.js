import { createBrowserClient } from "/sdk/browser-client.ts";

const loginViewEl = document.getElementById("login-view");
const appViewEl = document.getElementById("app-view");
const heroTitleEl = document.getElementById("hero-title");
const heroSubtitleEl = document.getElementById("hero-subtitle");
const loginSubtitleEl = document.getElementById("login-subtitle");
const loginFeedbackEl = document.getElementById("login-feedback");
const appFeedbackEl = document.getElementById("app-feedback");
const signInBtn = document.getElementById("sign-in-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const walletAddressEl = document.getElementById("wallet-address");
const walletChainEl = document.getElementById("wallet-chain");
const creditBalanceEl = document.getElementById("credit-balance");
const creditPackageEl = document.getElementById("credit-package");
const programIdEl = document.getElementById("program-id");
const programClusterEl = document.getElementById("program-cluster");
const actionCostEl = document.getElementById("action-cost");
const appNameChipEl = document.getElementById("app-name-chip");
const purchaseCreditsBtn = document.getElementById("purchase-credits-btn");
const sayHelloFormEl = document.getElementById("say-hello-form");
const usernameInputEl = document.getElementById("username-input");
const sayHelloBtn = document.getElementById("say-hello-btn");
const refreshFeedBtn = document.getElementById("refresh-feed-btn");
const transactionsEmptyEl = document.getElementById("transactions-empty");
const transactionsListEl = document.getElementById("transactions-list");

const checkoutStorageKey = "mock-game-frontend-checkout";

const state = {
  config: null,
  sdk: null,
  session: null,
  me: null,
  catalog: null,
  balance: null,
  transactions: [],
  checkout: null,
  pendingAction: false
};

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

function setFeedback(element, message) {
  if (!message) {
    element.hidden = true;
    element.textContent = "";
    return;
  }

  element.hidden = false;
  element.textContent = message;
}

function setAuthenticatedView(isAuthenticated) {
  loginViewEl.hidden = isAuthenticated;
  appViewEl.hidden = !isAuthenticated;
}

function formatWallet(walletAddress) {
  if (!walletAddress) {
    return "-";
  }
  if (walletAddress.length <= 14) {
    return walletAddress;
  }
  return `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`;
}

function formatCurrency(amountCents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((amountCents ?? 0) / 100);
}

function formatTimestamp(value) {
  if (!value) {
    return "Pending confirmation";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function getConfiguredAction() {
  return state.catalog?.actions?.find((action) => action.actionType === "say_hello") ?? null;
}

function getConfiguredPackage() {
  return state.catalog?.creditPackages?.[0] ?? null;
}

function updateButtons() {
  const hasSession = Boolean(state.session);
  const action = getConfiguredAction();
  const creditPackage = getConfiguredPackage();
  const username = usernameInputEl.value.trim();

  purchaseCreditsBtn.disabled = !hasSession || !creditPackage;
  sayHelloBtn.disabled = !hasSession || !action || username.length === 0 || state.pendingAction;
}

function renderSummary() {
  const action = getConfiguredAction();
  const creditPackage = getConfiguredPackage();
  const registeredProgram = state.catalog?.registeredProgram ?? null;
  const balance = state.balance?.balance ?? 0;
  const reserved = state.balance?.reserved ?? 0;

  heroTitleEl.textContent = state.catalog?.name ?? state.config?.appName ?? "Hello Celeris";
  loginSubtitleEl.textContent = `Use the Celeris-hosted auth gateway for ${state.catalog?.name ?? state.config?.appName ?? "this app"}.`;
  appNameChipEl.textContent = `App: ${state.catalog?.name ?? state.config?.appName ?? "-"}`;

  creditBalanceEl.textContent = String(balance);
  creditPackageEl.textContent = creditPackage
    ? `${creditPackage.credits} credits for ${formatCurrency(creditPackage.priceCents)}${reserved > 0 ? ` • ${reserved} reserved` : ""}`
    : "No credit package configured";

  actionCostEl.textContent = action ? `Action cost: ${action.cost} credits` : "Action cost: not configured";

  if (registeredProgram) {
    programIdEl.textContent = registeredProgram.programId;
    programClusterEl.textContent = `${registeredProgram.chainFamily} ${registeredProgram.cluster} • state ${registeredProgram.statePda}`;
  } else {
    programIdEl.textContent = "Unregistered";
    programClusterEl.textContent = "Solana devnet";
  }

  if (state.me) {
    walletAddressEl.textContent = state.me.walletAddress;
    walletChainEl.textContent = `${formatWallet(state.me.walletAddress)} • ${state.me.chainId}`;
  } else {
    walletAddressEl.textContent = "-";
    walletChainEl.textContent = "-";
  }

  updateButtons();
}

function renderTransactions() {
  const transactions = Array.isArray(state.transactions) ? state.transactions : [];
  transactionsListEl.replaceChildren();
  transactionsEmptyEl.hidden = transactions.length > 0;

  for (const transaction of transactions) {
    const card = document.createElement("article");
    card.className = "transaction-card";

    const header = document.createElement("header");

    const message = document.createElement("p");
    message.className = "transaction-message";
    message.textContent = transaction.message || `${transaction.actionId} submitted`;

    const status = document.createElement("span");
    status.className = `status-badge status-${transaction.status}`;
    status.textContent = transaction.status;

    header.append(message, status);

    const meta = document.createElement("div");
    meta.className = "transaction-meta";

    const wallet = document.createElement("span");
    wallet.textContent = `${transaction.username ?? "Unknown"} • ${formatWallet(transaction.walletAddress)}`;

    const timestamp = document.createElement("span");
    timestamp.textContent = transaction.confirmedAt
      ? `Confirmed ${formatTimestamp(transaction.confirmedAt)}`
      : `Submitted ${formatTimestamp(transaction.submittedAt)}`;

    meta.append(wallet, timestamp);
    card.append(header, meta);

    const signature = document.createElement("div");
    signature.className = "transaction-meta";

    const signatureText = document.createElement("span");
    signatureText.textContent = `Signature: ${transaction.providerTxId}`;
    signature.append(signatureText);

    if (transaction.explorerUrl) {
      const link = document.createElement("a");
      link.href = transaction.explorerUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open in Explorer";
      signature.append(link);
    }

    card.append(signature);
    transactionsListEl.append(card);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `request failed for ${url}`);
  }
  return payload;
}

function persistCheckout(checkout) {
  state.checkout = checkout;
  localStorage.setItem(checkoutStorageKey, JSON.stringify(checkout));
}

function clearCheckout() {
  state.checkout = null;
  localStorage.removeItem(checkoutStorageKey);
}

function restoreCheckout() {
  const raw = localStorage.getItem(checkoutStorageKey);
  if (!raw) {
    return;
  }

  try {
    state.checkout = JSON.parse(raw);
  } catch {
    clearCheckout();
  }
}

function resolveRedirectUri(config) {
  try {
    const redirectUrl = new URL(config.redirectUri);
    if (redirectUrl.origin === window.location.origin) {
      return redirectUrl.toString();
    }
  } catch {
    return `${window.location.origin}/auth/callback`;
  }

  return `${window.location.origin}/auth/callback`;
}

async function loadConfig() {
  const config = await fetchJson("/config.json");
  if (!config?.appId) {
    throw new Error("Mock game frontend is missing an appId configuration.");
  }

  state.config = {
    appId: config.appId,
    appName: config.appName ?? "Hello Celeris",
    apiOrigin: config.apiOrigin ?? "/api",
    hostedAuthOrigin: config.hostedAuthOrigin ?? window.location.origin,
    redirectUri: resolveRedirectUri(config)
  };

  state.sdk = createBrowserClient({
    apiBaseUrl: state.config.apiOrigin,
    appId: state.config.appId,
    auth: {
      hostedAuthOrigin: state.config.hostedAuthOrigin,
      redirectUri: state.config.redirectUri
    }
  });

  heroTitleEl.textContent = state.config.appName;
  heroSubtitleEl.textContent = "Sign in, buy credits, and submit a real sponsored `say_hello` transaction.";
  loginSubtitleEl.textContent = `Use the Celeris-hosted auth gateway for ${state.config.appName}.`;
}

async function refreshAuthenticatedState() {
  if (!state.sdk || !state.session) {
    throw new Error("player session is required");
  }

  const [me, catalog, balance, transactions] = await Promise.all([
    state.sdk.me.get(),
    state.sdk.catalog.get(),
    state.sdk.credits.getBalance(),
    state.sdk.transactions.list()
  ]);

  state.me = me;
  state.catalog = catalog;
  state.balance = balance;
  state.transactions = transactions;
  renderSummary();
  renderTransactions();
  setAuthenticatedView(true);
}

function resetAppState() {
  state.session = null;
  state.me = null;
  state.catalog = null;
  state.balance = null;
  state.transactions = [];
  state.pendingAction = false;
  usernameInputEl.value = "";
  setFeedback(loginFeedbackEl, "");
  setFeedback(appFeedbackEl, "");
  renderSummary();
  renderTransactions();
  setAuthenticatedView(false);
}

async function connect() {
  signInBtn.disabled = true;
  setFeedback(loginFeedbackEl, "");

  try {
    const session = await state.sdk.auth.login();
    state.session = session;
    await refreshAuthenticatedState();
  } finally {
    signInBtn.disabled = false;
    updateButtons();
  }
}

function signOut() {
  state.sdk?.auth.logout();
  clearCheckout();
  resetAppState();
}

async function purchaseCredits() {
  const creditPackage = getConfiguredPackage();
  if (!state.sdk || !creditPackage) {
    throw new Error("Checkout is not configured for this app.");
  }

  purchaseCreditsBtn.disabled = true;
  setFeedback(appFeedbackEl, "");

  try {
    const checkout = await state.sdk.payments.createCheckoutSession({
      packageId: creditPackage.packageId,
      successUrl: `${window.location.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${window.location.origin}/?checkout=cancel`,
      idempotencyKey: `frontend-checkout-${createUuid()}`
    });

    persistCheckout(checkout);
    window.location.assign(checkout.checkoutUrl);
  } finally {
    purchaseCreditsBtn.disabled = false;
    updateButtons();
  }
}

async function submitSayHello() {
  const action = getConfiguredAction();
  if (!state.sdk || !action) {
    throw new Error("say_hello is not configured for this app.");
  }

  const username = usernameInputEl.value.trim();
  if (!username) {
    throw new Error("Username is required.");
  }

  state.pendingAction = true;
  updateButtons();
  setFeedback(appFeedbackEl, "");

  try {
    const result = await state.sdk.actions.execute(
      "say_hello",
      { username },
      { idempotencyKey: `say-hello-${createUuid()}` }
    );

    await refreshAuthenticatedState();
    usernameInputEl.value = "";
    setFeedback(
      appFeedbackEl,
      result?.explorerUrl
        ? `Greeting submitted. Explorer: ${result.explorerUrl}`
        : "Greeting submitted."
    );
  } finally {
    state.pendingAction = false;
    updateButtons();
  }
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get("checkout");
  if (!checkoutStatus) {
    return;
  }

  if (checkoutStatus === "cancel") {
    clearCheckout();
    setFeedback(appFeedbackEl, "Checkout cancelled.");
    window.history.replaceState({}, "", window.location.pathname);
    return;
  }

  if (checkoutStatus === "success") {
    clearCheckout();
    if (state.session) {
      await refreshAuthenticatedState();
    }
    setFeedback(appFeedbackEl, "Credits added successfully.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

async function handleAuthCallback() {
  if (!state.sdk) {
    return false;
  }

  const session = await state.sdk.auth.handleCallback();
  if (!session) {
    return false;
  }

  state.session = session;
  await refreshAuthenticatedState();
  return true;
}

async function restoreSession() {
  const session = state.sdk?.auth.getSession() ?? null;
  if (!session) {
    return false;
  }

  state.session = session;
  await refreshAuthenticatedState();
  return true;
}

signInBtn.addEventListener("click", () => {
  connect().catch((error) => {
    setFeedback(loginFeedbackEl, error.message);
  });
});

signOutBtn.addEventListener("click", () => {
  signOut();
});

purchaseCreditsBtn.addEventListener("click", () => {
  purchaseCredits().catch((error) => {
    setFeedback(appFeedbackEl, error.message);
  });
});

sayHelloFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSayHello().catch((error) => {
    if (error.message === "insufficient credits") {
      setFeedback(appFeedbackEl, "Not enough credits for say_hello. Purchase credits to continue.");
      return;
    }
    setFeedback(appFeedbackEl, error.message);
  });
});

usernameInputEl.addEventListener("input", () => {
  updateButtons();
});

refreshFeedBtn.addEventListener("click", () => {
  if (!state.session) {
    return;
  }

  refreshFeedBtn.disabled = true;
  Promise.all([state.sdk.transactions.list(), state.sdk.credits.getBalance()])
    .then(([transactions, balance]) => {
      state.transactions = transactions;
      state.balance = balance;
      renderSummary();
      renderTransactions();
    })
    .catch((error) => {
      setFeedback(appFeedbackEl, error.message);
    })
    .finally(() => {
      refreshFeedBtn.disabled = false;
    });
});

async function boot() {
  restoreCheckout();
  resetAppState();
  await loadConfig();

  try {
    const handledCallback = await handleAuthCallback();
    if (!handledCallback) {
      await restoreSession().catch(() => {
        signOut();
      });
    }
    await handleCheckoutReturn();
  } catch (error) {
    signOut();
    setFeedback(loginFeedbackEl, error.message);
  }
}

boot().catch((error) => {
  setFeedback(loginFeedbackEl, error.message);
});
