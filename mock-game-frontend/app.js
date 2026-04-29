const loginViewEl = document.getElementById("login-view");
const gameViewEl = document.getElementById("game-view");
const loginFormEl = document.getElementById("login-form");
const loginSubtitleEl = document.getElementById("login-subtitle");
const loginFeedbackEl = document.getElementById("login-feedback");
const emailInput = document.getElementById("email-input");
const signInBtn = document.getElementById("sign-in-btn");
const gameTitleEl = document.getElementById("game-title");
const gameSubtitleEl = document.getElementById("game-subtitle");
const playerEmailEl = document.getElementById("player-email");
const buyCreditsBtn = document.getElementById("buy-credits-btn");
const mintItemBtn = document.getElementById("mint-item-btn");
const balanceEl = document.getElementById("balance-value");
const reservedEl = document.getElementById("reserved-value");
const resultOutput = document.getElementById("result-output");

const sessionStorageKey = "mock-game-frontend-session";
const checkoutStorageKey = "mock-game-frontend-checkout";

const state = {
  token: null,
  userId: null,
  email: null,
  appId: null,
  appName: null,
  packageId: null,
  itemDefId: null,
  packageCredits: null,
  packageAmountCents: null,
  pendingCheckout: null
};

function randomKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function setResult(value) {
  resultOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function showLoginFeedback(message) {
  if (!message) {
    loginFeedbackEl.hidden = true;
    loginFeedbackEl.textContent = "";
    return;
  }
  loginFeedbackEl.hidden = false;
  loginFeedbackEl.textContent = message;
}

function setView(name) {
  loginViewEl.hidden = name !== "login";
  gameViewEl.hidden = name !== "game";
}

function fetchJson(path, init = {}) {
  return fetch(path, init).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `request failed: ${path}`);
    }
    return payload;
  });
}

function fetchApi(path, init = {}) {
  return fetchJson(`/api${path}`, init);
}

function persistSession() {
  localStorage.setItem(
    sessionStorageKey,
    JSON.stringify({
      token: state.token,
      userId: state.userId,
      email: state.email
    })
  );
}

function restoreSession() {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) {
    return false;
  }

  try {
    const session = JSON.parse(raw);
    state.token = session.token ?? null;
    state.userId = session.userId ?? null;
    state.email = session.email ?? null;
  } catch {
    localStorage.removeItem(sessionStorageKey);
    return false;
  }

  if (!state.token || !state.userId || !state.email) {
    localStorage.removeItem(sessionStorageKey);
    return false;
  }

  emailInput.value = state.email;
  playerEmailEl.textContent = state.email;
  setView("game");
  return true;
}

function persistPendingCheckout(checkout) {
  state.pendingCheckout = checkout;
  localStorage.setItem(checkoutStorageKey, JSON.stringify(checkout));
}

function restorePendingCheckout() {
  const raw = localStorage.getItem(checkoutStorageKey);
  if (!raw) {
    return;
  }

  try {
    state.pendingCheckout = JSON.parse(raw);
  } catch {
    localStorage.removeItem(checkoutStorageKey);
    state.pendingCheckout = null;
  }
}

function clearPendingCheckout() {
  state.pendingCheckout = null;
  localStorage.removeItem(checkoutStorageKey);
}

async function loadConfig() {
  const config = await fetchJson("/config.json");
  if (!config.appId) {
    throw new Error("Mock game frontend is missing an appId configuration.");
  }

  state.appId = config.appId;
  state.itemDefId = config.itemDefId || "iron_sword";

  const setup = await fetchApi(`/apps/${encodeURIComponent(state.appId)}/setup`);
  const selectedPackage = setup.creditPackages[0] ?? null;
  state.packageId = selectedPackage?.packageId ?? null;
  state.packageCredits = selectedPackage?.credits ?? null;
  state.packageAmountCents = selectedPackage?.priceCents ?? null;

  const apps = await fetchApi("/apps");
  const app = apps.find((entry) => entry.appId === state.appId);
  state.appName = app?.name ?? "Configured Game";

  loginSubtitleEl.textContent = `Enter ${state.appName}.`;
  gameTitleEl.textContent = state.appName;
  gameSubtitleEl.textContent = `Buy credits and trigger ${state.itemDefId}.`;
}

async function refreshBalance() {
  if (!state.appId || !state.userId) {
    balanceEl.textContent = "0";
    reservedEl.textContent = "0";
    return;
  }

  const users = await fetchApi(`/users?appId=${encodeURIComponent(state.appId)}`);
  const record = users.find((user) => user.userId === state.userId);
  balanceEl.textContent = String(record?.balance ?? 0);
  reservedEl.textContent = String(record?.reserved ?? 0);
}

async function signIn() {
  const email = emailInput.value.trim();
  if (!email) {
    throw new Error("Email is required.");
  }

  signInBtn.disabled = true;
  try {
    const session = await fetchApi("/auth/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomKey("frontend-session")
      },
      body: JSON.stringify({
        provider: "dummy",
        email
      })
    });

    state.token = session.token;
    state.userId = session.userId;
    state.email = email;
    playerEmailEl.textContent = email;
    persistSession();
    await refreshBalance();
    setResult(session);
    setView("game");
  } finally {
    signInBtn.disabled = false;
  }
}

async function buyCredits() {
  if (!state.appId || !state.packageId || !state.userId) {
    throw new Error("Sign in first.");
  }

  buyCreditsBtn.disabled = true;
  try {
    const checkout = await fetchApi("/checkout/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomKey("frontend-checkout")
      },
      body: JSON.stringify({
        appId: state.appId,
        userId: state.userId,
        packageId: state.packageId,
        successUrl: `${window.location.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/?checkout=cancel`
      })
    });

    persistPendingCheckout(checkout);
    window.location.assign(checkout.checkoutUrl);
  } finally {
    buyCreditsBtn.disabled = false;
  }
}

async function completeReturnedCheckout(checkoutSessionId) {
  const payment = await fetchApi("/demo/checkout/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("frontend-complete")
    },
    body: JSON.stringify({
      checkoutSessionId
    })
  });

  const checkout = state.pendingCheckout;
  clearPendingCheckout();
  await refreshBalance();
  setResult({ checkout, payment });
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get("checkout");
  if (!checkoutStatus) {
    return;
  }

  if (checkoutStatus === "cancel") {
    clearPendingCheckout();
    setResult("Checkout cancelled.");
    window.history.replaceState({}, "", window.location.pathname);
    return;
  }

  if (checkoutStatus !== "success") {
    return;
  }

  const checkoutSessionId = params.get("session_id") || state.pendingCheckout?.checkoutSessionId;
  if (!checkoutSessionId) {
    throw new Error("Stripe Checkout returned without a session id.");
  }

  if (!state.userId) {
    throw new Error("Player session is missing after checkout redirect.");
  }

  await completeReturnedCheckout(checkoutSessionId);
  window.history.replaceState({}, "", window.location.pathname);
}

async function mintItem() {
  if (!state.appId || !state.token) {
    throw new Error("Sign in first.");
  }

  const result = await fetchApi("/actions/mint_item", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("frontend-mint"),
      authorization: `Bearer ${state.token}`
    },
    body: JSON.stringify({
      appId: state.appId,
      payload: {
        itemDefId: state.itemDefId
      }
    })
  });

  await refreshBalance();
  setResult(result);
}

loginFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showLoginFeedback("");
  signIn().catch((error) => {
    showLoginFeedback(error.message);
  });
});

buyCreditsBtn.addEventListener("click", () => {
  buyCredits().catch((error) => setResult(error.message));
});

mintItemBtn.addEventListener("click", () => {
  mintItem().catch((error) => setResult(error.message));
});

async function boot() {
  setView("login");
  restorePendingCheckout();
  await loadConfig();
  const hasSession = restoreSession();
  if (hasSession) {
    await refreshBalance();
    setResult("Ready.");
  }
  await handleCheckoutReturn();
}

boot().catch((error) => {
  showLoginFeedback(error.message);
  setResult(error.message);
});
