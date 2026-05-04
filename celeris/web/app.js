const loginViewEl = document.getElementById("login-view");
const homeViewEl = document.getElementById("home-view");
const createAppViewEl = document.getElementById("create-app-view");
const overviewViewEl = document.getElementById("overview-view");
const programViewEl = document.getElementById("program-view");
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
const createAppAllowedChainIdEl = document.getElementById("create-app-allowed-chain-id");
const createAppFeedbackEl = document.getElementById("create-app-feedback");
const cancelCreateAppBtn = document.getElementById("cancel-create-app-btn");
const submitCreateAppBtn = document.getElementById("submit-create-app-btn");

const overviewAppNameEl = document.getElementById("overview-app-name");
const overviewAppMetaEl = document.getElementById("overview-app-meta");
const identityListEl = document.getElementById("identity-list");
const setupListEl = document.getElementById("setup-list");
const frontendOriginTagsEl = document.getElementById("frontend-origin-tags");
const frontendOriginFormEl = document.getElementById("frontend-origin-form");
const frontendOriginInputEl = document.getElementById("frontend-origin-input");
const redirectUriTagsEl = document.getElementById("redirect-uri-tags");
const redirectUriFormEl = document.getElementById("redirect-uri-form");
const redirectUriInputEl = document.getElementById("redirect-uri-input");
const programsListEl = document.getElementById("programs-list");
const overviewFeedbackEl = document.getElementById("overview-feedback");
const overviewBackBtn = document.getElementById("overview-back-btn");
const viewMetricsBtn = document.getElementById("view-metrics-btn");
const addProgramBtn = document.getElementById("add-program-btn");

const programPageTitleEl = document.getElementById("program-page-title");
const programPageMetaEl = document.getElementById("program-page-meta");
const programDetailListEl = document.getElementById("program-detail-list");
const programActionsListEl = document.getElementById("program-actions-list");
const addProgramActionBtn = document.getElementById("add-program-action-btn");
const programBackBtn = document.getElementById("program-back-btn");
const programFeedbackPageEl = document.getElementById("program-feedback-page");

const programModalEl = document.getElementById("program-modal");
const programFormEl = document.getElementById("program-form");
const closeProgramModalBtn = document.getElementById("close-program-modal-btn");
const programIdInputEl = document.getElementById("program-id-input");
const programNetworkSelectEl = document.getElementById("program-network-select");
const programAliasInputEl = document.getElementById("program-alias-input");
const programFeedbackEl = document.getElementById("program-feedback");
const saveProgramBtn = document.getElementById("save-program-btn");

const actionModalEl = document.getElementById("action-modal");
const actionFormEl = document.getElementById("action-form");
const closeActionModalBtn = document.getElementById("close-action-modal-btn");
const actionTypeSelectEl = document.getElementById("action-type-select");
const customActionFieldEl = document.getElementById("custom-action-field");
const customActionNameEl = document.getElementById("custom-action-name");
const actionCostInputEl = document.getElementById("action-cost-input");
const actionExecutionModeSelectEl = document.getElementById("action-execution-mode-select");
const actionFeedbackEl = document.getElementById("action-feedback");
const saveActionBtn = document.getElementById("save-action-btn");

const metricsAppNameEl = document.getElementById("metrics-app-name");
const metricsBackBtn = document.getElementById("metrics-back-btn");
const metricsFeedbackEl = document.getElementById("metrics-feedback");
const metricGridEl = document.getElementById("metric-grid");
const transactionListEl = document.getElementById("transaction-list");
const userListEl = document.getElementById("user-list");

const SESSION_STORAGE_KEY = "celeris-dashboard-session";
const APP_UI_STORAGE_KEY = "celeris-dashboard-app-ui";

const state = {
  session: null,
  apps: [],
  selectedApp: null,
  selectedSetup: null,
  selectedProgramId: null,
  editingAppId: null,
  editingProgramId: null,
  editingProgramActionId: null,
  appUi: loadStoredAppUi()
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

async function fetchJson(path, init = undefined) {
  const response = await fetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `request failed: ${path}`);
  }
  return response.json();
}

function requireDeveloperSession() {
  if (!state.session?.accessToken) {
    throw new Error("Developer session is required.");
  }
  return state.session;
}

async function fetchDeveloperJson(path, init = undefined) {
  const session = requireDeveloperSession();
  const headers = new Headers(init?.headers ?? {});
  headers.set("authorization", `Bearer ${session.accessToken}`);
  return fetchJson(path, {
    ...init,
    headers
  });
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

function loadStoredAppUi() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_UI_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredAppUi() {
  localStorage.setItem(APP_UI_STORAGE_KEY, JSON.stringify(state.appUi));
}

function readDemoBootstrap() {
  const params = new URLSearchParams(window.location.search);
  const username = params.get("demoUsername");
  const password = params.get("demoPassword");
  const developerId = params.get("developerId");
  const appId = params.get("appId");

  if (!username || !password) {
    return null;
  }

  return { username, password, developerId, appId };
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

function supportsDialog(dialog) {
  return typeof dialog?.showModal === "function";
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
  programViewEl.hidden = name !== "program";
  metricsViewEl.hidden = name !== "metrics";
  appHeaderEl.hidden = name === "login";
}

function updateSessionSummary() {
  sessionSummaryEl.innerHTML = state.session ? `<strong>${escapeHtml(state.session.username)}</strong>` : "";
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

function getCredentials(input = null) {
  if (input?.username && input?.password) {
    return {
      username: String(input.username).trim(),
      password: String(input.password)
    };
  }
  return requireCredentials();
}

function ensureAppUi(appId) {
  if (!state.appUi[appId]) {
    state.appUi[appId] = {
      programs: []
    };
  }
  if (!Array.isArray(state.appUi[appId].programs)) {
    state.appUi[appId].programs = [];
  }
  state.appUi[appId].programs = state.appUi[appId].programs.map(normalizeProgramRecord);
  return state.appUi[appId];
}

function canonicalProgramActionId(actionType) {
  if (actionType === "Claim Rewards") {
    return "claim_rewards";
  }
  if (actionType === "First Time Claim") {
    return "first_time_claim";
  }
  return String(actionType)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProgramActionRecord(action) {
  return {
    id: action?.id ?? createUuid(),
    actionType: action?.actionType ?? "Custom action",
    actionId: action?.actionId ?? canonicalProgramActionId(action?.actionType ?? "custom"),
    cost: Number(action?.cost ?? 0),
    executionMode: action?.executionMode ?? "managed"
  };
}

const backendMirroredActionIds = new Set(["claim_rewards", "first_time_claim"]);

function normalizeProgramRecord(program) {
  return {
    id: program?.id ?? createUuid(),
    programId: program?.programId ?? "",
    network: program?.network ?? "mainnet",
    alias: program?.alias ?? "Program",
    actions: Array.isArray(program?.actions) ? program.actions.map(normalizeProgramActionRecord) : []
  };
}

function getSelectedAppUi() {
  if (!state.selectedApp) {
    return null;
  }
  return ensureAppUi(state.selectedApp.appId);
}

function getSelectedProgram() {
  const appUi = getSelectedAppUi();
  if (!appUi || !state.selectedProgramId) {
    return null;
  }
  return appUi.programs.find((program) => program.id === state.selectedProgramId) ?? null;
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

function bindCopyButtons(scope, feedbackTarget = overviewFeedbackEl) {
  for (const button of scope.querySelectorAll("[data-copy-value]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copyValue ?? ""));
      } catch {
        showFeedback(feedbackTarget, "Copy failed.");
      }
    });
  }
}

async function signIn(credentials = null) {
  const { username, password } = getCredentials(credentials);
  const backendSession = await fetchJson("/v1/developer/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  state.session = {
    username,
    developerId: backendSession.developerId,
    email: backendSession.email,
    accessToken: backendSession.accessToken,
    expiresAt: backendSession.expiresAt
  };
  saveStoredSession(state.session);
  updateSessionSummary();
  await loadApps();
  setView("home");
}

async function signUp(credentials = null) {
  const { username, password } = getCredentials(credentials);
  const backendSession = await fetchJson("/v1/developer/sign-up", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-sign-up-${createUuid()}`
    },
    body: JSON.stringify({
      username,
      password,
      developerId: credentials?.developerId
    })
  });
  state.session = {
    username,
    developerId: backendSession.developerId,
    email: backendSession.email,
    accessToken: backendSession.accessToken,
    expiresAt: backendSession.expiresAt
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
  state.selectedProgramId = null;
  state.editingAppId = null;
  state.editingProgramId = null;
  state.editingProgramActionId = null;
  clearStoredSession();
  updateSessionSummary();
  showFeedback(authFeedbackEl, "");
  showFeedback(homeFeedbackEl, "");
  showFeedback(overviewFeedbackEl, "");
  showFeedback(programFeedbackPageEl, "");
  showFeedback(metricsFeedbackEl, "");
  showFeedback(createAppFeedbackEl, "");
  showFeedback(programFeedbackEl, "");
  showFeedback(actionFeedbackEl, "");
  if (supportsDialog(programModalEl) && programModalEl.open) {
    programModalEl.close();
  }
  if (supportsDialog(actionModalEl) && actionModalEl.open) {
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
  state.apps = await fetchDeveloperJson("/v1/developer/apps");
  renderHome();
}

function renderSetupSummary(setup) {
  const firstPackage = setup.creditPackages[0] ?? null;
  renderDetailList(setupListEl, [
    {
      label: "Default package",
      value: firstPackage ? `${formatCurrency(firstPackage.priceCents)} for ${firstPackage.credits} credits` : "Not set"
    }
  ]);
  bindCopyButtons(setupListEl);
}

function renderClosableTags({
  element,
  values,
  emptyTitle,
  emptyCopy,
  dataAttribute,
  removeHandler
}) {
  if (values.length === 0) {
    element.innerHTML = `<div class="list-row"><strong>${escapeHtml(emptyTitle)}</strong><small>${escapeHtml(emptyCopy)}</small></div>`;
    return;
  }

  element.innerHTML = values
    .map(
      (value) => `
        <span class="tag">
          <code>${escapeHtml(value)}</code>
          <button class="tag-close" type="button" ${dataAttribute}="${encodeURIComponent(value)}" aria-label="Remove ${escapeHtml(value)}">×</button>
        </span>
      `
    )
    .join("");

  for (const button of element.querySelectorAll(`[${dataAttribute}]`)) {
    button.addEventListener("click", () => {
      removeHandler(decodeURIComponent(button.getAttribute(dataAttribute) ?? "")).catch((error) => {
        showFeedback(overviewFeedbackEl, error.message);
      });
    });
  }
}

function renderAllowedFrontendOrigins() {
  renderClosableTags({
    element: frontendOriginTagsEl,
    values: state.selectedSetup?.playerPolicy?.allowedFrontendOrigins ?? [],
    emptyTitle: "No allowed frontend origins",
    emptyCopy: "Add one to enable hosted login from a frontend.",
    dataAttribute: "data-remove-origin",
    removeHandler: removeAllowedFrontendOrigin
  });
}

function renderAllowedRedirectUris() {
  renderClosableTags({
    element: redirectUriTagsEl,
    values: state.selectedSetup?.playerPolicy?.allowedRedirectUris ?? [],
    emptyTitle: "No redirect URIs",
    emptyCopy: "Add one callback URL for hosted auth completion.",
    dataAttribute: "data-remove-redirect-uri",
    removeHandler: removeAllowedRedirectUri
  });
}

function renderPrograms() {
  const appUi = getSelectedAppUi();
  if (!appUi || appUi.programs.length === 0) {
    programsListEl.innerHTML =
      '<div class="list-row"><strong>No programs added yet</strong><small>Add a program to organize on-chain actions under it.</small></div>';
    return;
  }

  programsListEl.innerHTML = appUi.programs
    .map(
      (program) => `
        <div class="list-row action-row">
          <button type="button" class="app-item app-item-inline" data-open-program="${escapeHtml(program.id)}">
            <strong>${escapeHtml(program.alias)}</strong>
            <small>${escapeHtml(program.network)}</small>
            <small>${escapeHtml(program.programId)}</small>
          </button>
          <div class="icon-actions">
            <button class="icon-button" type="button" data-edit-program="${escapeHtml(program.id)}" aria-label="Edit ${escapeHtml(program.alias)}">
              ${EDIT_ICON}
            </button>
            <button class="icon-button" type="button" data-delete-program="${escapeHtml(program.id)}" aria-label="Delete ${escapeHtml(program.alias)}">
              ${DELETE_ICON}
            </button>
          </div>
        </div>
      `
    )
    .join("");

  for (const button of programsListEl.querySelectorAll("[data-open-program]")) {
    button.addEventListener("click", () => {
      openProgramView(button.dataset.openProgram);
    });
  }

  for (const button of programsListEl.querySelectorAll("[data-edit-program]")) {
    button.addEventListener("click", () => {
      openProgramModal(button.dataset.editProgram);
    });
  }

  for (const button of programsListEl.querySelectorAll("[data-delete-program]")) {
    button.addEventListener("click", () => {
      deleteProgram(button.dataset.deleteProgram);
    });
  }
}

function refreshOverview() {
  if (!state.selectedApp || !state.selectedSetup) {
    return;
  }

  overviewAppNameEl.textContent = state.selectedApp.name;
  overviewAppMetaEl.textContent = "Review setup details and the programs attached to this app.";
  renderDetailList(identityListEl, [
    { label: "App name", value: escapeHtml(state.selectedApp.name) },
    { label: "App ID", value: renderCopyValue(state.selectedApp.appId) },
    { label: "API key", value: renderCopyValue(state.selectedSetup.apiKey) },
    { label: "Created", value: formatDate(state.selectedApp.createdAt) }
  ]);
  bindCopyButtons(identityListEl);
  renderSetupSummary(state.selectedSetup);
  renderAllowedFrontendOrigins();
  renderAllowedRedirectUris();
  renderPrograms();
}

function normalizeOriginInput(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("Enter a valid frontend origin.");
  }
}

function normalizeRedirectUriInput(redirectUri) {
  try {
    return new URL(redirectUri).toString();
  } catch {
    throw new Error("Enter a valid redirect URI.");
  }
}

async function updateSelectedAppPlayerPolicy({ allowedFrontendOrigins, allowedRedirectUris }) {
  if (!state.selectedApp || !state.selectedSetup) {
    throw new Error("Choose an app first.");
  }

  const creditPackage = state.selectedSetup.creditPackages[0];
  if (!creditPackage) {
    throw new Error("Default credit package is missing.");
  }

  const updated = await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(state.selectedApp.appId)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-policy-${createUuid()}`
    },
    body: JSON.stringify({
      name: state.selectedApp.name,
      priceCents: creditPackage.priceCents,
      credits: creditPackage.credits,
      allowedChainId: state.selectedSetup.playerPolicy.allowedChainId,
      allowedFrontendOrigins: allowedFrontendOrigins ?? state.selectedSetup.playerPolicy.allowedFrontendOrigins,
      allowedRedirectUris: allowedRedirectUris ?? state.selectedSetup.playerPolicy.allowedRedirectUris
    })
  });

  const setup = await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(updated.appId)}`);
  state.selectedSetup = setup;
  const refreshedApp = state.apps.find((entry) => entry.appId === updated.appId);
  if (refreshedApp) {
    state.selectedApp = refreshedApp;
  }
  refreshOverview();
}

async function addAllowedFrontendOrigin() {
  const rawOrigin = frontendOriginInputEl.value.trim();
  if (!rawOrigin) {
    throw new Error("Frontend origin is required.");
  }

  const nextOrigin = normalizeOriginInput(rawOrigin);
  const currentOrigins = state.selectedSetup?.playerPolicy?.allowedFrontendOrigins ?? [];
  if (currentOrigins.includes(nextOrigin)) {
    frontendOriginInputEl.value = "";
    return;
  }

  await updateSelectedAppPlayerPolicy({
    allowedFrontendOrigins: [...currentOrigins, nextOrigin]
  });
  frontendOriginInputEl.value = "";
  showFeedback(overviewFeedbackEl, "");
}

async function removeAllowedFrontendOrigin(origin) {
  const currentOrigins = state.selectedSetup?.playerPolicy?.allowedFrontendOrigins ?? [];
  if (!currentOrigins.includes(origin)) {
    return;
  }

  if (currentOrigins.length === 1) {
    throw new Error("At least one allowed frontend origin is required.");
  }

  await updateSelectedAppPlayerPolicy({
    allowedFrontendOrigins: currentOrigins.filter((entry) => entry !== origin)
  });
  showFeedback(overviewFeedbackEl, "");
}

async function addAllowedRedirectUri() {
  const rawRedirectUri = redirectUriInputEl.value.trim();
  if (!rawRedirectUri) {
    throw new Error("Redirect URI is required.");
  }

  const nextRedirectUri = normalizeRedirectUriInput(rawRedirectUri);
  const currentRedirectUris = state.selectedSetup?.playerPolicy?.allowedRedirectUris ?? [];
  if (currentRedirectUris.includes(nextRedirectUri)) {
    redirectUriInputEl.value = "";
    return;
  }

  await updateSelectedAppPlayerPolicy({
    allowedRedirectUris: [...currentRedirectUris, nextRedirectUri]
  });
  redirectUriInputEl.value = "";
  showFeedback(overviewFeedbackEl, "");
}

async function removeAllowedRedirectUri(redirectUri) {
  const currentRedirectUris = state.selectedSetup?.playerPolicy?.allowedRedirectUris ?? [];
  if (!currentRedirectUris.includes(redirectUri)) {
    return;
  }

  if (currentRedirectUris.length === 1) {
    throw new Error("At least one redirect URI is required.");
  }

  await updateSelectedAppPlayerPolicy({
    allowedRedirectUris: currentRedirectUris.filter((entry) => entry !== redirectUri)
  });
  showFeedback(overviewFeedbackEl, "");
}

async function openAppOverview(appId) {
  const app = state.apps.find((entry) => entry.appId === appId);
  if (!app) {
    throw new Error("App not found.");
  }

  const setup = await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}`);
  state.selectedApp = app;
  state.selectedSetup = setup;
  state.selectedProgramId = null;
  ensureAppUi(appId);
  saveStoredAppUi();
  refreshOverview();
  setView("overview");
}

function renderProgramActions(program) {
  if (program.actions.length === 0) {
    programActionsListEl.innerHTML =
      '<div class="list-row"><strong>No actions added yet</strong><small>Add a program action to define what this program supports.</small></div>';
    return;
  }

  programActionsListEl.innerHTML = program.actions
    .map(
      (action) => `
        <div class="list-row action-row">
          <div>
            <strong>${escapeHtml(action.actionType)}</strong>
            <small>${escapeHtml(`${action.cost} credits`)}</small>
            <small>${escapeHtml(`mode: ${action.executionMode}`)}</small>
          </div>
          <div class="icon-actions">
            <button class="icon-button" type="button" data-edit-program-action="${escapeHtml(action.id)}" aria-label="Edit ${escapeHtml(action.actionType)}">
              ${EDIT_ICON}
            </button>
            <button class="icon-button" type="button" data-delete-program-action="${escapeHtml(action.id)}" aria-label="Delete ${escapeHtml(action.actionType)}">
              ${DELETE_ICON}
            </button>
          </div>
        </div>
      `
    )
    .join("");

  for (const button of programActionsListEl.querySelectorAll("[data-edit-program-action]")) {
    button.addEventListener("click", () => {
      openActionModal(button.dataset.editProgramAction);
    });
  }

  for (const button of programActionsListEl.querySelectorAll("[data-delete-program-action]")) {
    button.addEventListener("click", () => {
      deleteProgramAction(button.dataset.deleteProgramAction).catch((error) => {
        showFeedback(programFeedbackPageEl, error.message);
      });
    });
  }
}

function openProgramView(programId) {
  const program = getSelectedAppUi()?.programs.find((entry) => entry.id === programId);
  if (!program) {
    showFeedback(overviewFeedbackEl, "Program not found.");
    return;
  }

  state.selectedProgramId = programId;
  programPageTitleEl.textContent = program.alias;
  programPageMetaEl.textContent = `${program.network} · ${program.programId}`;
  renderDetailList(programDetailListEl, [
    { label: "Alias", value: escapeHtml(program.alias) },
    { label: "Program ID", value: renderCopyValue(program.programId) },
    { label: "Network", value: escapeHtml(program.network) },
    { label: "Actions", value: String(program.actions.length) }
  ]);
  bindCopyButtons(programDetailListEl, programFeedbackPageEl);
  renderProgramActions(program);
  setView("program");
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

  transactionListEl.innerHTML =
    transactions.length === 0
      ? '<div class="list-row"><strong>No transactions yet</strong></div>'
      : transactions
          .slice()
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 8)
          .map(
            (tx) => `
              <div class="list-row">
                <strong>${tx.summary.actionType} · ${tx.status}</strong>
                <small>${escapeHtml(tx.walletAddress)} · ${escapeHtml(tx.chainId)}</small>
                <small>${formatDate(tx.createdAt)}</small>
              </div>
            `
          )
          .join("");

  userListEl.innerHTML =
    users.length === 0
      ? '<div class="list-row"><strong>No users yet</strong></div>'
      : users
          .slice(0, 8)
          .map(
            (user) => `
              <div class="list-row">
                <strong>${escapeHtml(user.walletAddress)}</strong>
                <small>${escapeHtml(user.chainId)}</small>
                <small>Balance ${user.balance}</small>
                <small>Reserved ${user.reserved}</small>
              </div>
            `
          )
          .join("");
}

async function openMetricsView() {
  if (!state.selectedApp) {
    throw new Error("Choose an app first.");
  }

  const appId = state.selectedApp.appId;
  const [metrics, transactions, users] = await Promise.all([
    fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}/metrics`),
    fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}/transactions`),
    fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}/players`)
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
  const allowedChainId = createAppAllowedChainIdEl.value;

  if (!appName) {
    throw new Error("App name is required.");
  }
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new Error("Credits per $1 must be a positive whole number.");
  }
  if (!allowedChainId) {
    throw new Error("Allowed chain ID is required.");
  }

  const app = await fetchDeveloperJson(
    state.editingAppId ? `/v1/developer/apps/${encodeURIComponent(state.editingAppId)}` : "/v1/developer/apps",
    {
    method: state.editingAppId ? "PUT" : "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-${createUuid()}`
    },
    body: JSON.stringify({
      name: appName,
      priceCents: 100,
      credits,
      allowedChainId
    })
    }
  );

  await loadApps();
  resetCreateAppForm();
  await openAppOverview(app.appId);
}

function resetCreateAppForm() {
  createAppFormEl.reset();
  createAppNameEl.value = "My Demo Game";
  createAppCreditsPerDollarEl.value = formatNumber(500);
  createAppAllowedChainIdEl.value = "solana:103";
  submitCreateAppBtn.textContent = "Create app";
  state.editingAppId = null;
}

async function openEditApp(appId) {
  const app = state.apps.find((entry) => entry.appId === appId);
  if (!app) {
    throw new Error("App not found.");
  }
  const setup = await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}`);
  state.editingAppId = appId;
  createAppNameEl.value = app.name;
  createAppCreditsPerDollarEl.value = formatNumber(setup.creditPackages[0]?.credits ?? 500);
  createAppAllowedChainIdEl.value = setup.playerPolicy.allowedChainId;
  submitCreateAppBtn.textContent = "Save changes";
  showFeedback(createAppFeedbackEl, "");
  setView("create");
}

async function deleteApp(appId) {
  await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `dashboard-app-delete-${createUuid()}`
    },
    body: JSON.stringify({})
  });

  delete state.appUi[appId];
  saveStoredAppUi();

  if (state.selectedApp?.appId === appId) {
    state.selectedApp = null;
    state.selectedSetup = null;
    state.selectedProgramId = null;
  }
  await loadApps();
}

function openProgramModal(programId = null) {
  const program = programId ? getSelectedAppUi()?.programs.find((entry) => entry.id === programId) : null;
  state.editingProgramId = program?.id ?? null;
  programIdInputEl.value = program?.programId ?? "";
  programNetworkSelectEl.value = program?.network ?? "mainnet";
  programAliasInputEl.value = program?.alias ?? "";
  saveProgramBtn.textContent = program ? "Save program" : "Add program";
  showFeedback(programFeedbackEl, "");

  if (supportsDialog(programModalEl)) {
    programModalEl.showModal();
    return;
  }
  showFeedback(overviewFeedbackEl, "This browser does not support the program modal.");
}

function closeProgramModal() {
  state.editingProgramId = null;
  if (supportsDialog(programModalEl) && programModalEl.open) {
    programModalEl.close();
  }
}

function saveProgram() {
  const appUi = getSelectedAppUi();
  if (!appUi) {
    throw new Error("Choose an app first.");
  }

  const programId = programIdInputEl.value.trim();
  const network = programNetworkSelectEl.value;
  const alias = programAliasInputEl.value.trim();

  if (!programId) {
    throw new Error("Program ID is required.");
  }
  if (!alias) {
    throw new Error("Alias is required.");
  }

  if (state.editingProgramId) {
    const program = appUi.programs.find((entry) => entry.id === state.editingProgramId);
    if (!program) {
      throw new Error("Program not found.");
    }
    program.programId = programId;
    program.network = network;
    program.alias = alias;
  } else {
    appUi.programs.push({
      id: createUuid(),
      programId,
      network,
      alias,
      actions: []
    });
  }

  saveStoredAppUi();
  refreshOverview();
  closeProgramModal();
}

function deleteProgram(programId) {
  const appUi = getSelectedAppUi();
  if (!appUi) {
    return;
  }
  appUi.programs = appUi.programs.filter((entry) => entry.id !== programId);
  if (state.selectedProgramId === programId) {
    state.selectedProgramId = null;
    setView("overview");
  }
  saveStoredAppUi();
  refreshOverview();
}

function syncCustomActionField() {
  customActionFieldEl.hidden = actionTypeSelectEl.value !== "custom";
}

function openActionModal(actionId = null) {
  const program = getSelectedProgram();
  if (!program) {
    showFeedback(programFeedbackPageEl, "Program not found.");
    return;
  }

  const action = actionId ? program.actions.find((entry) => entry.id === actionId) : null;
  state.editingProgramActionId = action?.id ?? null;

  if (action) {
    const presetActionTypes = ["Claim Rewards", "First Time Claim"];
    if (presetActionTypes.includes(action.actionType)) {
      actionTypeSelectEl.value = action.actionType;
      customActionNameEl.value = "";
    } else {
      actionTypeSelectEl.value = "custom";
      customActionNameEl.value = action.actionType;
    }
    actionCostInputEl.value = formatNumber(action.cost);
    actionExecutionModeSelectEl.value = action.executionMode ?? "managed";
  } else {
    actionTypeSelectEl.value = "custom";
    customActionNameEl.value = "";
    actionCostInputEl.value = "";
    actionExecutionModeSelectEl.value = "managed";
  }

  saveActionBtn.textContent = action ? "Save action" : "Add action";
  showFeedback(actionFeedbackEl, "");
  syncCustomActionField();

  if (supportsDialog(actionModalEl)) {
    actionModalEl.showModal();
    return;
  }
  showFeedback(programFeedbackPageEl, "This browser does not support the action modal.");
}

function closeActionModal() {
  state.editingProgramActionId = null;
  if (supportsDialog(actionModalEl) && actionModalEl.open) {
    actionModalEl.close();
  }
}

function getSelectedActionType() {
  if (actionTypeSelectEl.value === "custom") {
    const customAction = customActionNameEl.value.trim();
    if (!customAction) {
      throw new Error("Custom action name is required.");
    }
    return customAction;
  }
  return actionTypeSelectEl.value;
}

async function syncBackendProgramAction(nextAction, previousActionId = null) {
  if (!state.selectedApp) {
    throw new Error("Choose an app first.");
  }

  const appId = state.selectedApp.appId;
  const requestHeaders = {
    "content-type": "application/json",
    "idempotency-key": `dashboard-program-action-${createUuid()}`
  };

  if (previousActionId && backendMirroredActionIds.has(previousActionId) && previousActionId !== nextAction.actionId) {
    await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(previousActionId)}`, {
      method: "DELETE",
      headers: requestHeaders,
      body: JSON.stringify({})
    });
  }

  if (backendMirroredActionIds.has(nextAction.actionId)) {
    await fetchDeveloperJson(`/v1/developer/apps/${encodeURIComponent(appId)}/actions`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        actionType: nextAction.actionId,
        cost: nextAction.cost,
        executionMode: nextAction.executionMode
      })
    });
  }
}

async function saveProgramAction() {
  const program = getSelectedProgram();
  if (!program) {
    throw new Error("Choose a program first.");
  }

  const actionType = getSelectedActionType();
  const actionId = canonicalProgramActionId(actionType);
  const cost = parseWholeNumber(actionCostInputEl.value);
  const executionMode = actionExecutionModeSelectEl.value;
  if (!Number.isInteger(cost) || cost < 0) {
    throw new Error("Credit consumption must be zero or a positive whole number.");
  }
  if (!executionMode) {
    throw new Error("Execution mode is required.");
  }

  if (state.editingProgramActionId) {
    const action = program.actions.find((entry) => entry.id === state.editingProgramActionId);
    if (!action) {
      throw new Error("Action not found.");
    }
    const previousActionId = action.actionId ?? canonicalProgramActionId(action.actionType);
    action.actionType = actionType;
    action.actionId = actionId;
    action.cost = cost;
    action.executionMode = executionMode;
    await syncBackendProgramAction(action, previousActionId);
  } else {
    const action = {
      id: createUuid(),
      actionType,
      actionId,
      cost,
      executionMode
    };
    program.actions.push(action);
    await syncBackendProgramAction(action);
  }

  saveStoredAppUi();
  openProgramView(program.id);
  closeActionModal();
}

async function deleteProgramAction(actionId) {
  const program = getSelectedProgram();
  if (!program) {
    return;
  }
  const removedAction = program.actions.find((entry) => entry.id === actionId);
  program.actions = program.actions.filter((entry) => entry.id !== actionId);
  if (removedAction?.actionId && backendMirroredActionIds.has(removedAction.actionId) && state.selectedApp) {
    await fetchDeveloperJson(
      `/v1/developer/apps/${encodeURIComponent(state.selectedApp.appId)}/actions/${encodeURIComponent(removedAction.actionId)}`,
      {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `dashboard-program-action-delete-${createUuid()}`
      },
      body: JSON.stringify({})
      }
    );
  }
  saveStoredAppUi();
  openProgramView(program.id);
}

async function restoreSession() {
  const stored = loadStoredSession();
  if (!stored?.username || !stored?.developerId || !stored?.accessToken) {
    return false;
  }

  state.session = stored;
  try {
    updateSessionSummary();
    await loadApps();
    setView("home");
    return true;
  } catch (error) {
    state.session = null;
    clearStoredSession();
    if (error instanceof Error && /authorization|session/i.test(error.message)) {
      return false;
    }
    throw error;
  }
}

function applyDemoBootstrap() {
  const bootstrap = readDemoBootstrap();
  if (!bootstrap) {
    return null;
  }

  authUsernameEl.value = bootstrap.username;
  authPasswordEl.value = bootstrap.password;
  return bootstrap;
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
  resetCreateAppForm();
  setView("create");
});

cancelCreateAppBtn.addEventListener("click", () => {
  resetCreateAppForm();
  showFeedback(createAppFeedbackEl, "");
  setView("home");
});

createAppCreditsPerDollarEl.addEventListener("input", () => {
  const parsed = parseWholeNumber(createAppCreditsPerDollarEl.value);
  if (!Number.isNaN(parsed)) {
    createAppCreditsPerDollarEl.value = formatNumber(parsed);
  }
});

createAppFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(createAppFeedbackEl, "");
  createApp().catch((error) => {
    showFeedback(createAppFeedbackEl, error.message);
  });
});

frontendOriginFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(overviewFeedbackEl, "");
  addAllowedFrontendOrigin().catch((error) => {
    showFeedback(overviewFeedbackEl, error.message);
  });
});

redirectUriFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(overviewFeedbackEl, "");
  addAllowedRedirectUri().catch((error) => {
    showFeedback(overviewFeedbackEl, error.message);
  });
});

overviewBackBtn.addEventListener("click", () => {
  setView("home");
});

viewMetricsBtn.addEventListener("click", () => {
  showFeedback(metricsFeedbackEl, "");
  openMetricsView().catch((error) => {
    showFeedback(metricsFeedbackEl, error.message);
  });
});

metricsBackBtn.addEventListener("click", () => {
  setView("overview");
});

addProgramBtn.addEventListener("click", () => {
  openProgramModal();
});

closeProgramModalBtn.addEventListener("click", () => {
  closeProgramModal();
});

programFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(programFeedbackEl, "");
  try {
    saveProgram();
  } catch (error) {
    showFeedback(programFeedbackEl, error.message);
  }
});

programBackBtn.addEventListener("click", () => {
  setView("overview");
});

actionTypeSelectEl.addEventListener("change", syncCustomActionField);

addProgramActionBtn.addEventListener("click", () => {
  openActionModal();
});

closeActionModalBtn.addEventListener("click", () => {
  closeActionModal();
});

actionFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFeedback(actionFeedbackEl, "");
  try {
    await saveProgramAction();
  } catch (error) {
    showFeedback(actionFeedbackEl, error.message);
  }
});

(async function init() {
  const bootstrap = applyDemoBootstrap();
  const restored = await restoreSession().catch(() => false);

  if (!restored && bootstrap) {
    try {
      await signUp(bootstrap);
      if (bootstrap.appId) {
        await openAppOverview(bootstrap.appId);
      }
      return;
    } catch (error) {
      showFeedback(authFeedbackEl, error.message);
    }
  }

  if (!restored) {
    setView("login");
  }
})();
