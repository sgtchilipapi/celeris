const emailInput = document.getElementById("email-input");
const appSelect = document.getElementById("app-select");
const signInBtn = document.getElementById("sign-in-btn");
const buyCreditsBtn = document.getElementById("buy-credits-btn");
const mintItemBtn = document.getElementById("mint-item-btn");
const balanceEl = document.getElementById("balance-value");
const reservedEl = document.getElementById("reserved-value");
const resultOutput = document.getElementById("result-output");

const state = {
  token: null,
  userId: null,
  selectedAppId: null,
  selectedPackageId: null
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

function randomKey(prefix) {
  return `${prefix}-${createUuid()}`;
}

function setResult(value) {
  resultOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `request failed: ${path}`);
  }
  return payload;
}

async function loadApps() {
  const apps = await fetchJson("/apps");
  appSelect.innerHTML = "";
  for (const app of apps) {
    const option = document.createElement("option");
    option.value = app.appId;
    option.textContent = app.name;
    appSelect.appendChild(option);
  }

  if (apps.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No apps available";
    appSelect.appendChild(option);
    appSelect.disabled = true;
    return;
  }

  appSelect.disabled = false;
  state.selectedAppId = apps[0].appId;
  await selectApp(apps[0].appId);
}

async function selectApp(appId) {
  state.selectedAppId = appId;
  const setup = await fetchJson(`/apps/${encodeURIComponent(appId)}/setup`);
  state.selectedPackageId = setup.creditPackages[0]?.packageId ?? null;
  await refreshBalance();
}

async function refreshBalance() {
  if (!state.selectedAppId || !state.userId) {
    balanceEl.textContent = "0";
    reservedEl.textContent = "0";
    return;
  }

  const users = await fetchJson(`/users?appId=${encodeURIComponent(state.selectedAppId)}`);
  const record = users.find((user) => user.userId === state.userId);
  balanceEl.textContent = String(record?.balance ?? 0);
  reservedEl.textContent = String(record?.reserved ?? 0);
}

async function signIn() {
  const session = await fetchJson("/auth/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("demo-session")
    },
    body: JSON.stringify({
      provider: "dummy",
      email: emailInput.value
    })
  });

  state.token = session.token;
  state.userId = session.userId;
  buyCreditsBtn.disabled = false;
  mintItemBtn.disabled = false;
  await refreshBalance();
  setResult(session);
}

async function buyCredits() {
  if (!state.selectedAppId || !state.selectedPackageId || !state.userId) {
    throw new Error("sign in and choose an app first");
  }

  const checkout = await fetchJson("/checkout/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("demo-checkout")
    },
    body: JSON.stringify({
      appId: state.selectedAppId,
      userId: state.userId,
      packageId: state.selectedPackageId,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel"
    })
  });

  const payment = await fetchJson("/demo/checkout/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("demo-complete")
    },
    body: JSON.stringify({
      checkoutSessionId: checkout.checkoutSessionId
    })
  });

  await refreshBalance();
  setResult({ checkout, payment });
}

async function mintItem() {
  if (!state.selectedAppId || !state.token) {
    throw new Error("sign in first");
  }

  const result = await fetchJson("/actions/mint_item", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("demo-mint"),
      authorization: `Bearer ${state.token}`
    },
    body: JSON.stringify({
      appId: state.selectedAppId,
      payload: {
        itemDefId: "iron_sword"
      }
    })
  });

  await refreshBalance();
  setResult(result);
}

signInBtn.addEventListener("click", () => {
  signIn().catch((error) => setResult(error.message));
});

buyCreditsBtn.addEventListener("click", () => {
  buyCredits().catch((error) => setResult(error.message));
});

mintItemBtn.addEventListener("click", () => {
  mintItem().catch((error) => setResult(error.message));
});

appSelect.addEventListener("change", () => {
  selectApp(appSelect.value).catch((error) => setResult(error.message));
});

loadApps().catch((error) => setResult(error.message));
