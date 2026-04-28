const loginViewEl = document.getElementById("login-view");
const homeViewEl = document.getElementById("home-view");
const createAppViewEl = document.getElementById("create-app-view");
const overviewViewEl = document.getElementById("overview-view");
const metricsViewEl = document.getElementById("metrics-view");
const appHeaderEl = document.getElementById("app-header");

const authFormEl = document.getElementById("auth-form");
const authUsernameEl = document.getElementById("auth-username");
const authPasswordEl = document.getElementById("auth-password");
const authFeedbackEl = document.getElementById("auth-feedback");
const signUpBtn = document.getElementById("sign-up-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const sessionSummaryEl = document.getElementById("session-summary");

const appListEl = document.getElementById("app-list");
const homeEmptyStateEl = document.getElementById("home-empty-state");
const homeCreateAppBtn = document.getElementById("home-create-app-btn");
const homeFeedbackEl = document.getElementById("home-feedback");

const createAppFormEl = document.getElementById("create-app-form");
const createAppNameEl = document.getElementById("create-app-name");
const createAppCreditsPerDollarEl = document.getElementById("create-app-credits-per-dollar");
const createAppWebhookEl = document.getElementById("create-app-webhook");
const createAppFeedbackEl = document.getElementById("create-app-feedback");
const cancelCreateAppBtn = document.getElementById("cancel-create-app-btn");

const overviewAppNameEl = document.getElementById("overview-app-name");
const overviewAppMetaEl = document.getElementById("overview-app-meta");
const identityListEl = document.getElementById("identity-list");
const setupListEl = document.getElementById("setup-list");
const overviewFeedbackEl = document.getElementById("overview-feedback");
const overviewBackBtn = document.getElementById("overview-back-btn");
const viewMetricsBtn = document.getElementById("view-metrics-btn");
const actionsListEl = document.getElementById("actions-list");
const addOnchainActionBtn = document.getElementById("add-onchain-action-btn");
const actionModalEl = document.getElementById("action-modal");
const actionFormEl = document.getElementById("action-form");
const closeActionModalBtn = document.getElementById("close-action-modal-btn");
const actionTypeSelectEl = document.getElementById("action-type-select");
const customActionFieldEl = document.getElementById("custom-action-field");
const customActionNameEl = document.getElementById("custom-action-name");
const actionCostInputEl = document.getElementById("action-cost-input");
const actionFeedbackEl = document.getElementById("action-feedback");

const metricsAppNameEl = document.getElementById("metrics-app-name");
const metricsBackBtn = document.getElementById("metrics-back-btn");
const metricsFeedbackEl = document.getElementById("metrics-feedback");
const metricGridEl = document.getElementById("metric-grid");
const transactionListEl = document.getElementById("transaction-list");
const userListEl = document.getElementById("user-list");

const ACCOUNT_STORAGE_KEY = "celeris-dashboard-accounts";
const SESSION_STORAGE_KEY = "celeris-dashboard-session";

const state = {
  session: null,
  apps: [],
  selectedApp: null,
  selectedSetup: null
};

async function fetchJson(path, init = undefined) {
  const response = await fetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `request failed: ${path}`);
  }
  return response.json();
}

function loadAccounts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
}

function loadStoredSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function showFeedback(element, message) {
  if (!message) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.hidden = false;
  element.textContent = message;
}

function supportsDialog() {
  return typeof actionModalEl?.showModal === "function";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function setView(name) {
  loginViewEl.hidden = name !== "login";
  homeViewEl.hidden = name !== "home";
  createAppViewEl.hidden = name !== "create";
  overviewViewEl.hidden = name !== "overview";
  metricsViewEl.hidden = name !== "metrics";
  appHeaderEl.hidden = name === "login";
}

function syncCustomActionField() {
  customActionFieldEl.hidden = actionTypeSelectEl.value !== "custom";
}

function updateSessionSummary() {
  if (!state.session) {
    sessionSummaryEl.textContent = "";
    return;
  }
  sessionSummaryEl.innerHTML = `<strong>${escapeHtml(state.session.username)}</strong><br /><span>${escapeHtml(state.session.email)}</span>`;
}

function formatCurrency(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function parseWholeNumber(value) {
  const digits = String(value).replaceAll(",", "").replace(/\D/g, "");
  if (!digits) {
    return NaN;
  }
  return Number(digits);
}

function requireCredentials() {
  const username = authUsernameEl.value.trim();
  const password = authPasswordEl.value;
  if (!username || !password) {
    throw new Error("Username and password are required.");
  }
  return { username, password };
}

async function createOrRestoreDeveloper(developerId) {
  return fetchJson("/demo/developer/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ developerId })
  });
}

async function signIn() {
  const { username, password } = requireCredentials();
  const accounts = loadAccounts();
  const account = accounts[username];
  if (!account || account.password !== password) {
    throw new Error("Invalid username or password.");
  }

  const backendSession = await createOrRestoreDeveloper(account.developerId);
  state.session = {
    username,
    developerId: backendSession.developerId,
    email: backendSession.email
  };
  saveStoredSession(state.session);
  updateSessionSummary();
  await loadApps();
  setView("home");
}

async function signUp() {
  const { username, password } = requireCredentials();
  const accounts = loadAccounts();
  if (accounts[username]) {
    throw new Error("Username already exists. Sign in instead.");
  }

  const developerId = `dev-${crypto.randomUUID()}`;
  const backendSession = await createOrRestoreDeveloper(developerId);
  accounts[username] = { developerId: backendSession.developerId, password };
  saveAccounts(accounts);

  state.session = {
    username,
    developerId: backendSession.developerId,
    email: backendSession.email
  };
  saveStoredSession(state.session);
  updateSessionSummary();
  await loadApps();
  setView("home");
}

function signOut() {
  state.session = null;
  state.apps = [];
  state.selectedApp = null;
  state.selectedSetup = null;
  clearStoredSession();
  updateSessionSummary();
  showFeedback(authFeedbackEl, "");
  showFeedback(homeFeedbackEl, "");
  showFeedback(overviewFeedbackEl, "");
  showFeedback(metricsFeedbackEl, "");
  showFeedback(createAppFeedbackEl, "");
  showFeedback(actionFeedbackEl, "");
  if (supportsDialog() && actionModalEl.open) {
    actionModalEl.close();
  }
  authFormEl.reset();
  appListEl.innerHTML = "";
  setView("login");
}

function renderHome() {
  const apps = state.apps;
  homeEmptyStateEl.hidden = apps.length > 0;
  appListEl.innerHTML = "";

  if (apps.length === 0) {
    appListEl.innerHTML = '<div class="list-row"><strong>No apps available</strong><small>Create your first app to continue.</small></div>';
    return;
  }

  for (const app of apps) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "app-item";
    button.innerHTML = `
      <strong>${escapeHtml(app.name)}</strong>
      <small>${escapeHtml(app.appId)}</small>
      <small>Created ${formatDate(app.createdAt)}</small>
    `;
    button.addEventListener("click", () => {
      openAppOverview(app.appId).catch((error) => {
        showFeedback(homeFeedbackEl, error.message);
      });
    });
    appListEl.appendChild(button);
  }
}

async function loadApps() {
  if (!state.session) {
    return;
  }
  state.apps = await fetchJson(`/apps?developerId=${encodeURIComponent(state.session.developerId)}`);
  renderHome();
}

function renderDetailList(element, items) {
  element.innerHTML = items
    .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${item.value}</dd>`)
    .join("");
}

function renderActions(actions) {
  if (actions.length === 0) {
    actionsListEl.innerHTML = '<div class="list-row"><strong>No actions added yet</strong><small>Add an on-chain action to define what players can do.</small></div>';
    return;
  }

  actionsListEl.innerHTML = actions
    .map(
      (action) => `
        <div class="list-row">
          <strong>${escapeHtml(action.actionType)}</strong>
          <small>${escapeHtml(`${action.cost} credits`)}</small>
        </div>
      `
    )
    .join("");
}

function refreshOverviewSetup(setup) {
  state.selectedSetup = setup;
  const firstPackage = setup.creditPackages[0] ?? null;
  renderDetailList(setupListEl, [
    { label: "Webhook URL", value: setup.webhookUrl ? `<code>${escapeHtml(setup.webhookUrl)}</code>` : "Not set" },
    {
      label: "Default package",
      value: firstPackage ? `${formatCurrency(firstPackage.priceCents)} for ${firstPackage.credits} credits` : "Not set"
    },
    {
      label: "Configured actions",
      value:
        setup.actions.length > 0
          ? escapeHtml(setup.actions.map((action) => `${action.actionType} (${action.cost} credits)`).join(", "))
          : "No actions configured"
    }
  ]);
  renderActions(setup.actions);
}

async function openAppOverview(appId) {
  const app = state.apps.find((entry) => entry.appId === appId);
  if (!app) {
    throw new Error("App not found.");
  }

  const setup = await fetchJson(`/apps/${encodeURIComponent(appId)}/setup`);
  state.selectedApp = app;
  state.selectedSetup = setup;

  overviewAppNameEl.textContent = app.name;
  overviewAppMetaEl.textContent = `App ${app.appId}`;

  renderDetailList(identityListEl, [
    { label: "App name", value: escapeHtml(app.name) },
    { label: "App ID", value: `<code>${escapeHtml(app.appId)}</code>` },
    { label: "API key", value: `<code>${escapeHtml(setup.apiKey)}</code>` },
    { label: "Created", value: formatDate(app.createdAt) }
  ]);
  refreshOverviewSetup(setup);

  setView("overview");
}

function renderMetrics(metrics, transactions, users) {
  const cards = [
    { label: "Total users", value: metrics.totalUsers },
    { label: "Revenue", value: formatCurrency(metrics.totalRevenueCents) },
    { label: "Credits purchased", value: metrics.creditsPurchased },
    { label: "Credits spent", value: metrics.creditsSpent },
    { label: "Successful tx", value: metrics.successfulTransactions },
    { label: "Failed tx", value: metrics.failedTransactions }
  ];

  metricGridEl.innerHTML = cards
    .map(
      (card) => `
        <div class="metric-card">
          <div class="metric-label">${card.label}</div>
          <div class="metric-value">${card.value}</div>
        </div>
      `
    )
    .join("");

  if (transactions.length === 0) {
    transactionListEl.innerHTML = '<div class="list-row"><strong>No transactions yet</strong></div>';
  } else {
    transactionListEl.innerHTML = transactions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map(
        (tx) => `
          <div class="list-row">
            <strong>${tx.summary.actionType} · ${tx.status}</strong>
            <small>${escapeHtml(tx.userId)}</small>
            <small>${formatDate(tx.createdAt)}</small>
          </div>
        `
      )
      .join("");
  }

  if (users.length === 0) {
    userListEl.innerHTML = '<div class="list-row"><strong>No users yet</strong></div>';
  } else {
    userListEl.innerHTML = users
      .slice(0, 8)
      .map(
        (user) => `
          <div class="list-row">
            <strong>${escapeHtml(user.userId)}</strong>
            <small>Balance ${user.balance}</small>
            <small>Reserved ${user.reserved}</small>
          </div>
        `
      )
      .join("");
  }
}

async function openMetricsView() {
  if (!state.selectedApp) {
    throw new Error("Choose an app first.");
  }

  const appId = state.selectedApp.appId;
  const [metrics, transactions, users] = await Promise.all([
    fetchJson(`/metrics?appId=${encodeURIComponent(appId)}`),
    fetchJson(`/transactions?appId=${encodeURIComponent(appId)}`),
    fetchJson(`/users?appId=${encodeURIComponent(appId)}`)
  ]);

  metricsAppNameEl.textContent = `${state.selectedApp.name} activity`;
  renderMetrics(metrics, transactions, users);
  setView("metrics");
}

async function createApp() {
  if (!state.session) {
    throw new Error("Sign in first.");
  }

  const appName = createAppNameEl.value.trim();
  const credits = parseWholeNumber(createAppCreditsPerDollarEl.value);
  const webhookUrl = createAppWebhookEl.value.trim();

  if (!appName) {
    throw new Error("App name is required.");
  }
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new Error("Credits per $1 must be a positive whole number.");
  }
  if (!webhookUrl) {
    throw new Error("Webhook URL is required.");
  }

  const app = await fetchJson("/apps", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      developerId: state.session.developerId,
      name: appName,
      priceCents: 100,
      credits,
      webhookUrl
    })
  });

  await loadApps();
  createAppFormEl.reset();
  createAppNameEl.value = "My Demo Game";
  createAppCreditsPerDollarEl.value = formatNumber(500);
  createAppWebhookEl.value = "http://localhost:3001";
  await openAppOverview(app.appId);
}

function openActionModal() {
  showFeedback(actionFeedbackEl, "");
  actionTypeSelectEl.value = "custom";
  customActionNameEl.value = "";
  actionCostInputEl.value = formatNumber(50);
  syncCustomActionField();
  if (supportsDialog()) {
    actionModalEl.showModal();
    return;
  }
  showFeedback(overviewFeedbackEl, "This browser does not support the action modal.");
}

function closeActionModal() {
  if (supportsDialog() && actionModalEl.open) {
    actionModalEl.close();
  }
}

function getSelectedActionType() {
  if (actionTypeSelectEl.value === "custom") {
    const customName = customActionNameEl.value.trim();
    if (!customName) {
      throw new Error("Custom action name is required.");
    }
    return customName;
  }
  return actionTypeSelectEl.value;
}

async function createOnchainAction() {
  if (!state.selectedApp) {
    throw new Error("Choose an app first.");
  }

  const actionType = getSelectedActionType();
  const cost = parseWholeNumber(actionCostInputEl.value);
  if (!Number.isInteger(cost) || cost <= 0) {
    throw new Error("Credit cost must be a positive whole number.");
  }

  await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-action-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      actionType,
      cost
    })
  });

  const setup = await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/setup`);
  refreshOverviewSetup(setup);
  closeActionModal();
}

async function restoreSession() {
  const stored = loadStoredSession();
  if (!stored?.username || !stored?.developerId) {
    return false;
  }

  const backendSession = await createOrRestoreDeveloper(stored.developerId);
  state.session = {
    username: stored.username,
    developerId: backendSession.developerId,
    email: backendSession.email
  };
  updateSessionSummary();
  await loadApps();
  setView("home");
  return true;
}

authFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(authFeedbackEl, "");
  signIn().catch((error) => {
    showFeedback(authFeedbackEl, error.message);
  });
});

signUpBtn.addEventListener("click", () => {
  showFeedback(authFeedbackEl, "");
  signUp().catch((error) => {
    showFeedback(authFeedbackEl, error.message);
  });
});

signOutBtn.addEventListener("click", () => {
  signOut();
});

homeCreateAppBtn.addEventListener("click", () => {
  showFeedback(homeFeedbackEl, "");
  showFeedback(createAppFeedbackEl, "");
  setView("create");
});

cancelCreateAppBtn.addEventListener("click", () => {
  showFeedback(createAppFeedbackEl, "");
  setView("home");
});

createAppFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(createAppFeedbackEl, "");
  createApp().catch((error) => {
    showFeedback(createAppFeedbackEl, error.message);
  });
});

createAppCreditsPerDollarEl.addEventListener("input", () => {
  const credits = parseWholeNumber(createAppCreditsPerDollarEl.value);
  createAppCreditsPerDollarEl.value = Number.isFinite(credits) ? formatNumber(credits) : "";
});

actionTypeSelectEl.addEventListener("change", () => {
  syncCustomActionField();
});

actionCostInputEl.addEventListener("input", () => {
  const cost = parseWholeNumber(actionCostInputEl.value);
  actionCostInputEl.value = Number.isFinite(cost) ? formatNumber(cost) : "";
});

overviewBackBtn.addEventListener("click", () => {
  showFeedback(overviewFeedbackEl, "");
  setView("home");
});

addOnchainActionBtn.addEventListener("click", () => {
  showFeedback(overviewFeedbackEl, "");
  openActionModal();
});

closeActionModalBtn.addEventListener("click", () => {
  closeActionModal();
});

actionFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(actionFeedbackEl, "");
  createOnchainAction().catch((error) => {
    showFeedback(actionFeedbackEl, error.message);
  });
});

viewMetricsBtn.addEventListener("click", () => {
  showFeedback(overviewFeedbackEl, "");
  openMetricsView().catch((error) => {
    showFeedback(overviewFeedbackEl, error.message);
  });
});

metricsBackBtn.addEventListener("click", () => {
  showFeedback(metricsFeedbackEl, "");
  setView("overview");
});

async function boot() {
  createAppCreditsPerDollarEl.value = formatNumber(500);
  actionCostInputEl.value = formatNumber(50);
  syncCustomActionField();
  setView("login");
  try {
    const restored = await restoreSession();
    if (!restored) {
      updateSessionSummary();
      setView("login");
    }
  } catch {
    clearStoredSession();
    state.session = null;
    updateSessionSummary();
    setView("login");
  }
}

boot();
