const appListEl = document.getElementById("app-list");
const appNameEl = document.getElementById("app-name");
const appMetaEl = document.getElementById("app-meta");
const metricGridEl = document.getElementById("metric-grid");
const creditFlowChartEl = document.getElementById("credit-flow-chart");
const transactionChartEl = document.getElementById("transaction-chart");
const userTableEl = document.getElementById("user-table");

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`request failed: ${path}`);
  }
  return response.json();
}

function centsToDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderMetrics(metrics) {
  const cards = [
    { label: "Total Users", value: metrics.totalUsers },
    { label: "Total Revenue", value: centsToDollars(metrics.totalRevenueCents) },
    { label: "Credits Purchased", value: metrics.creditsPurchased },
    { label: "Credits Spent", value: metrics.creditsSpent },
    { label: "Action Count", value: metrics.mintItemCount },
    { label: "TX Success", value: metrics.successfulTransactions },
    { label: "TX Failed", value: metrics.failedTransactions }
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
}

function renderBars(container, series) {
  const max = Math.max(...series.map((item) => item.value), 1);
  container.innerHTML = series
    .map(
      (item) => `
        <div class="bar-row">
          <div class="bar-label">${item.label}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(item.value / max) * 100}%"></div>
          </div>
          <div class="bar-value">${item.value}</div>
        </div>
      `
    )
    .join("");
}

function renderUsers(metrics) {
  if (metrics.users.length === 0) {
    userTableEl.innerHTML = '<div class="empty-state">No activity yet.</div>';
    return;
  }

  userTableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Balance</th>
          <th>Reserved</th>
          <th>Events</th>
        </tr>
      </thead>
      <tbody>
        ${metrics.users
          .map(
            (user) => `
              <tr>
                <td><code>${user.userId}</code></td>
                <td>${user.balance}</td>
                <td>${user.reserved}</td>
                <td>${user.activityEvents}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function selectApp(app) {
  const metrics = await fetchJson(`/metrics?appId=${encodeURIComponent(app.appId)}`);
  appNameEl.textContent = app.name;
  appMetaEl.textContent = `App ${app.appId}`;
  renderMetrics(metrics);
  renderBars(creditFlowChartEl, metrics.chartSeries.creditFlow);
  renderBars(transactionChartEl, metrics.chartSeries.transactionOutcomes);
  renderUsers(metrics);

  for (const button of appListEl.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.appId === app.appId);
  }
}

async function boot() {
  const apps = await fetchJson("/apps");
  if (apps.length === 0) {
    appListEl.innerHTML = '<div class="empty-state">No apps created yet.</div>';
    metricGridEl.innerHTML = "";
    creditFlowChartEl.innerHTML = "";
    transactionChartEl.innerHTML = "";
    userTableEl.innerHTML = "";
    return;
  }

  appListEl.innerHTML = "";
  for (const app of apps) {
    const button = document.createElement("button");
    button.className = "app-list-item";
    button.dataset.appId = app.appId;
    button.innerHTML = `<span>${app.name}</span><small>${new Date(app.createdAt).toISOString().slice(0, 10)}</small>`;
    button.addEventListener("click", () => void selectApp(app));
    appListEl.appendChild(button);
  }

  await selectApp(apps[0]);
}

boot().catch((error) => {
  appNameEl.textContent = "Dashboard unavailable";
  appMetaEl.textContent = error.message;
});
