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
const submitCreateAppBtn = document.getElementById("submit-create-app-btn");

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
const saveActionBtn = document.getElementById("save-action-btn");

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
  selectedSetup: null,
  editingActionType: null,
  editingAppId: null
};

const EDIT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm14.71-9.04a1 1 0 0 0 0-1.41l-1.5-1.5a1 1 0 0 0-1.41 0l-1.09 1.09 2.75 2.75 1.25-1.18Z" />
  </svg>
`;

const DELETE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 8h10l-1 13H8L7 8Z" />
  </svg>
`;

const COPY_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
  </svg>
`;

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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function getPresetActionTypes() {
  return [...actionTypeSelectEl.options]
    .filter((option) => option.value !== "custom")
    .map((option) => option.value);
}

function updateSessionSummary() {
  if (!state.session) {
    sessionSummaryEl.textContent = "";
    return;
  }
  sessionSummaryEl.innerHTML = `<strong>${escapeHtml(state.session.username)}</strong>`;
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
    const row = document.createElement("div");
    row.className = "list-row action-row";
    row.innerHTML = `
      <button type="button" class="app-item app-item-inline" data-open-app="${escapeHtml(app.appId)}">
        <strong>${escapeHtml(app.name)}</strong>
        <small>${escapeHtml(app.appId)}</small>
        <small>Created ${formatDate(app.createdAt)}</small>
      </button>
      <div class="icon-actions">
        <button class="icon-button" type="button" data-edit-app="${escapeHtml(app.appId)}" aria-label="Edit ${escapeHtml(app.name)}">
          ${EDIT_ICON}
        </button>
        <button class="icon-button" type="button" data-delete-app="${escapeHtml(app.appId)}" aria-label="Delete ${escapeHtml(app.name)}">
          ${DELETE_ICON}
        </button>
      </div>
    `;
    appListEl.appendChild(row);
  }

  for (const button of appListEl.querySelectorAll("[data-open-app]")) {
    button.addEventListener("click", () => {
      openAppOverview(button.dataset.openApp).catch((error) => {
        showFeedback(homeFeedbackEl, error.message);
      });
    });
  }

  for (const button of appListEl.querySelectorAll("[data-edit-app]")) {
    button.addEventListener("click", () => {
      openEditApp(button.dataset.editApp).catch((error) => {
        showFeedback(homeFeedbackEl, error.message);
      });
    });
  }

  for (const button of appListEl.querySelectorAll("[data-delete-app]")) {
    button.addEventListener("click", () => {
      deleteApp(button.dataset.deleteApp).catch((error) => {
        showFeedback(homeFeedbackEl, error.message);
      });
    });
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

function renderCopyValue(value) {
  const escapedValue = escapeHtml(value);
  const encodedValue = encodeURIComponent(value);
  return `
    <span class="copy-value">
      <code>${escapedValue}</code>
      <button class="icon-button copy-button" type="button" data-copy-value="${encodedValue}" aria-label="Copy ${escapedValue}">
        ${COPY_ICON}
      </button>
    </span>
  `;
}

function bindCopyButtons(scope) {
  for (const button of scope.querySelectorAll("[data-copy-value]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copyValue ?? ""));
      } catch {
        showFeedback(overviewFeedbackEl, "Copy failed.");
      }
    });
  }
}

function renderActions(actions) {
  if (actions.length === 0) {
    actionsListEl.innerHTML = '<div class="list-row"><strong>No actions added yet</strong><small>Add an on-chain action to define what players can do.</small></div>';
    return;
  }

  actionsListEl.innerHTML = actions
    .map(
      (action) => `
        <div class="list-row action-row">
          <div>
            <strong>${escapeHtml(action.actionType)}</strong>
            <small>${escapeHtml(`${action.cost} credits`)}</small>
          </div>
          <div class="icon-actions">
            <button class="icon-button" type="button" data-edit-action="${escapeHtml(action.actionType)}" aria-label="Edit ${escapeHtml(action.actionType)}">
              ${EDIT_ICON}
            </button>
            <button class="icon-button" type="button" data-delete-action="${escapeHtml(action.actionType)}" aria-label="Delete ${escapeHtml(action.actionType)}">
              ${DELETE_ICON}
            </button>
          </div>
        </div>
      `
    )
    .join("");

  for (const button of actionsListEl.querySelectorAll("[data-edit-action]")) {
    button.addEventListener("click", () => {
      const action = state.selectedSetup?.actions.find((entry) => entry.actionType === button.dataset.editAction);
      if (action) {
        openActionModal(action);
      }
    });
  }

  for (const button of actionsListEl.querySelectorAll("[data-delete-action]")) {
    button.addEventListener("click", () => {
      const actionType = button.dataset.deleteAction;
      if (actionType) {
        deleteOnchainAction(actionType).catch((error) => {
          showFeedback(overviewFeedbackEl, error.message);
        });
      }
    });
  }
}

function refreshOverviewSetup(setup) {
  state.selectedSetup = setup;
  const firstPackage = setup.creditPackages[0] ?? null;
  renderDetailList(setupListEl, [
    { label: "Webhook URL", value: setup.webhookUrl ? renderCopyValue(setup.webhookUrl) : "Not set" },
    {
      label: "Default package",
      value: firstPackage ? `${formatCurrency(firstPackage.priceCents)} for ${firstPackage.credits} credits` : "Not set"
    }
  ]);
  bindCopyButtons(setupListEl);
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
  overviewAppMetaEl.textContent = "";

  renderDetailList(identityListEl, [
    { label: "App name", value: escapeHtml(app.name) },
    { label: "App ID", value: renderCopyValue(app.appId) },
    { label: "API key", value: renderCopyValue(setup.apiKey) },
    { label: "Created", value: formatDate(app.createdAt) }
  ]);
  bindCopyButtons(identityListEl);
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

  const app = await fetchJson(state.editingAppId ? `/apps/${encodeURIComponent(state.editingAppId)}` : "/apps", {
    method: state.editingAppId ? "PUT" : "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      ...(state.editingAppId ? {} : { developerId: state.session.developerId }),
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
  submitCreateAppBtn.textContent = "Create app";
  state.editingAppId = null;
  await openAppOverview(app.appId);
}

async function openEditApp(appId) {
  const app = state.apps.find((entry) => entry.appId === appId);
  if (!app) {
    throw new Error("App not found.");
  }
  const setup = await fetchJson(`/apps/${encodeURIComponent(appId)}/setup`);
  state.editingAppId = appId;
  createAppNameEl.value = app.name;
  createAppCreditsPerDollarEl.value = formatNumber(setup.creditPackages[0]?.credits ?? 500);
  createAppWebhookEl.value = setup.webhookUrl ?? "";
  submitCreateAppBtn.textContent = "Save changes";
  showFeedback(createAppFeedbackEl, "");
  setView("create");
}

async function deleteApp(appId) {
  await fetchJson(`/apps/${encodeURIComponent(appId)}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-delete-${crypto.randomUUID()}`
    },
    body: JSON.stringify({})
  });
  if (state.selectedApp?.appId === appId) {
    state.selectedApp = null;
    state.selectedSetup = null;
  }
  await loadApps();
}

function openActionModal(existingAction = null) {
  showFeedback(actionFeedbackEl, "");
  state.editingActionType = existingAction?.actionType ?? null;
  const presetValues = getPresetActionTypes();
  const actionType = existingAction?.actionType ?? "";

  if (actionType && presetValues.includes(actionType)) {
    actionTypeSelectEl.value = actionType;
    customActionNameEl.value = "";
  } else {
    actionTypeSelectEl.value = "custom";
    customActionNameEl.value = actionType;
  }

  actionCostInputEl.value = existingAction ? formatNumber(existingAction.cost) : "";
  saveActionBtn.textContent = existingAction ? "Save changes" : "Save action";
  syncCustomActionField();
  if (supportsDialog()) {
    actionModalEl.showModal();
    return;
  }
  showFeedback(overviewFeedbackEl, "This browser does not support the action modal.");
}

function closeActionModal() {
  state.editingActionType = null;
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

  const idempotencyKey = `dashboard-action-${crypto.randomUUID()}`;
  if (state.editingActionType) {
    await fetchJson(
      `/apps/${encodeURIComponent(state.selectedApp.appId)}/actions/${encodeURIComponent(state.editingActionType)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          actionType,
          cost
        })
      }
    );
  } else {
    await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify({
        actionType,
        cost
      })
    });
  }

  const setup = await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/setup`);
  refreshOverviewSetup(setup);
  closeActionModal();
}

async function deleteOnchainAction(actionType) {
  if (!state.selectedApp) {
    throw new Error("Choose an app first.");
  }

  await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/actions/${encodeURIComponent(actionType)}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-action-delete-${crypto.randomUUID()}`
    },
    body: JSON.stringify({})
  });

  const setup = await fetchJson(`/apps/${encodeURIComponent(state.selectedApp.appId)}/setup`);
  refreshOverviewSetup(setup);
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
  state.editingAppId = null;
  submitCreateAppBtn.textContent = "Create app";
  createAppFormEl.reset();
  createAppNameEl.value = "My Demo Game";
  createAppCreditsPerDollarEl.value = formatNumber(500);
  createAppWebhookEl.value = "http://localhost:3001";
  setView("create");
});

cancelCreateAppBtn.addEventListener("click", () => {
  showFeedback(createAppFeedbackEl, "");
  state.editingAppId = null;
  submitCreateAppBtn.textContent = "Create app";
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
  actionCostInputEl.value = "";
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
