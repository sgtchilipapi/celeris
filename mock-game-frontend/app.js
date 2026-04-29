const loginViewEl = document.getElementById("login-view");
const gameViewEl = document.getElementById("game-view");
const homeViewEl = document.getElementById("home-view");
const charactersViewEl = document.getElementById("characters-view");
const questsViewEl = document.getElementById("quests-view");
const inventoryViewEl = document.getElementById("inventory-view");
const characterDetailViewEl = document.getElementById("character-detail-view");

const loginFormEl = document.getElementById("login-form");
const loginSubtitleEl = document.getElementById("login-subtitle");
const loginFeedbackEl = document.getElementById("login-feedback");
const usernameInputEl = document.getElementById("username-input");
const passwordInputEl = document.getElementById("password-input");
const signInBtn = document.getElementById("sign-in-btn");
const signUpBtn = document.getElementById("sign-up-btn");
const signOutBtn = document.getElementById("sign-out-btn");

const gameTitleEl = document.getElementById("game-title");
const gameFeedbackEl = document.getElementById("game-feedback");
const playerUsernameEl = document.getElementById("player-username");
const balanceEl = document.getElementById("balance-value");
const openCreditsModalBtn = document.getElementById("open-credits-modal-btn");

const charactersPanelBtn = document.getElementById("characters-panel-btn");
const questsPanelBtn = document.getElementById("quests-panel-btn");
const inventoryPanelBtn = document.getElementById("inventory-panel-btn");
const charactersBackBtn = document.getElementById("characters-back-btn");
const questsBackBtn = document.getElementById("quests-back-btn");
const inventoryBackBtn = document.getElementById("inventory-back-btn");
const charactersGridEl = document.getElementById("characters-grid");
const questsListEl = document.getElementById("quests-list");
const inventoryGoldTotalEl = document.getElementById("inventory-gold-total");
const inventoryItemsTotalEl = document.getElementById("inventory-items-total");
const inventoryListEl = document.getElementById("inventory-list");

const detailCharacterNameEl = document.getElementById("detail-character-name");
const characterDetailBackBtn = document.getElementById("character-detail-back-btn");
const detailPortraitIconEl = document.getElementById("detail-portrait-icon");
const characterStatsListEl = document.getElementById("character-stats-list");
const characterEquipmentListEl = document.getElementById("character-equipment-list");
const questPanelTitleEl = document.getElementById("quest-panel-title");
const questListStateEl = document.getElementById("quest-list-state");
const questActiveStateEl = document.getElementById("quest-active-state");
const questCompleteStateEl = document.getElementById("quest-complete-state");
const questEventTextEl = document.getElementById("quest-event-text");
const questProgressTextEl = document.getElementById("quest-progress-text");
const enemyStatsListEl = document.getElementById("enemy-stats-list");
const questRewardsListEl = document.getElementById("quest-rewards-list");
const fightBtn = document.getElementById("fight-btn");
const runBtn = document.getElementById("run-btn");
const abandonQuestBtn = document.getElementById("abandon-quest-btn");
const questCompleteTextEl = document.getElementById("quest-complete-text");
const questExperienceGainedEl = document.getElementById("quest-experience-gained");
const questCompleteRewardsListEl = document.getElementById("quest-complete-rewards-list");
const claimRewardsBtn = document.getElementById("claim-rewards-btn");

const creditsModalEl = document.getElementById("credits-modal");
const creditsFormEl = document.getElementById("credits-form");
const closeCreditsModalBtn = document.getElementById("close-credits-modal-btn");
const creditsAppNameEl = document.getElementById("credits-app-name");
const creditsPackageAmountEl = document.getElementById("credits-package-amount");
const creditsPackagePriceEl = document.getElementById("credits-package-price");
const creditsFeedbackEl = document.getElementById("credits-feedback");
const continueCheckoutBtn = document.getElementById("continue-checkout-btn");

const characterModalEl = document.getElementById("character-modal");
const characterFormEl = document.getElementById("character-form");
const closeCharacterModalBtn = document.getElementById("close-character-modal-btn");
const characterNameInputEl = document.getElementById("character-name-input");
const characterClassSelectEl = document.getElementById("character-class-select");
const characterPortraitIconEl = document.getElementById("character-portrait-icon");
const characterFeedbackEl = document.getElementById("character-feedback");
const createCharacterBtn = document.getElementById("create-character-btn");

const sessionStorageKey = "mock-game-frontend-session";
const checkoutStorageKey = "mock-game-frontend-checkout";
const charactersStorageKey = "mock-game-frontend-characters";

const classIcons = {
  fighter: '<svg viewBox="0 0 24 24"><path d="M14.5 3 21 9.5l-2 2-1.5-1.5-3 3L17 15.5 8.5 24 7 22.5l2.5-2.5-3-3L5 18.5 0 13.5 8.5 5l2.5 2.5 3-3L12.5 3h2Z" /></svg>',
  ranger: '<svg viewBox="0 0 24 24"><path d="M20.5 3A8.5 8.5 0 0 0 12 11.5v1.09L2.29 22.29l1.42 1.42L7 20.41V23h2v-4.59L12 15.41V18h2v-4.59L17 10.41V13h2V8.41A8.47 8.47 0 0 0 20.5 3Zm0 2A6.5 6.5 0 1 1 14 11.5 6.5 6.5 0 0 1 20.5 5Z" /></svg>',
  mage: '<svg viewBox="0 0 24 24"><path d="m12 2 2.4 4.86L20 7.67l-4 3.9.94 5.52L12 14.77 7.06 17.1 8 11.57l-4-3.9 5.6-.81L12 2Zm-5 17h10v2H7v-2Z" /></svg>'
};

const classDefinitions = {
  fighter: {
    label: "Fighter",
    hp: 160,
    mana: 30,
    stamina: 120,
    resilience: 10,
    manaCost: 2,
    staminaCost: 14,
    equipment: {
      headgear: "Cloth Cap",
      armor: "Leather Armor",
      weapon: "Crude Sword"
    }
  },
  ranger: {
    label: "Ranger",
    hp: 120,
    mana: 55,
    stamina: 150,
    resilience: 7,
    manaCost: 8,
    staminaCost: 12,
    equipment: {
      headgear: "Cloth Cap",
      armor: "Leather Armor",
      weapon: "Crude Bow"
    }
  },
  mage: {
    label: "Mage",
    hp: 95,
    mana: 165,
    stamina: 90,
    resilience: 5,
    manaCost: 14,
    staminaCost: 8,
    equipment: {
      headgear: "Cloth Cap",
      armor: "Leather Armor",
      weapon: "Crude Staff"
    }
  }
};

const questDefinitions = {
  "dragon-dungeon": {
    title: "Dragon Dungeon",
    description: "Descend into a volcanic keep where drakes, wyrms, and a wyvern guard the hoard.",
    experience: 620,
    rewards: [
      "Gold: 420",
      "Armor (1) (Unidentified)",
      "Sword (1) (Unidentified)",
      "Headgear (1) (Unidentified)",
      "Dragon Scale (3)"
    ],
    enemies: [
      { name: "Cinder Bat", text: "A Cinder Bat sweeps down from the cavern roof. What do you do?", hp: 42, attack: 14, magicPressure: 1, staminaPressure: 5 },
      { name: "Ash Drakeling", text: "An Ash Drakeling snaps its jaws and rushes your flank. What do you do?", hp: 58, attack: 18, magicPressure: 2, staminaPressure: 7 },
      { name: "Basalt Wyrmguard", text: "A Basalt Wyrmguard blocks the bridge with molten armor. What do you do?", hp: 74, attack: 22, magicPressure: 3, staminaPressure: 9 },
      { name: "Silver Wyvern", text: "A Silver Wyvern appeared. What do you do?", hp: 92, attack: 25, magicPressure: 4, staminaPressure: 10 },
      { name: "Ember Dragon", text: "The Ember Dragon crashes into the chamber and exhales flame. What do you do?", hp: 118, attack: 30, magicPressure: 7, staminaPressure: 13 }
    ]
  },
  "monster-plains": {
    title: "Monster Plains",
    description: "Cross the hunting fields where roaming beasts and raiders gather in waves.",
    experience: 430,
    rewards: [
      "Gold: 260",
      "Armor (1) (Unidentified)",
      "Sword (1) (Unidentified)",
      "Headgear (1) (Unidentified)",
      "Monster Claw (4)"
    ],
    enemies: [
      { name: "Horned Boar", text: "A Horned Boar lowers its tusks and charges. What do you do?", hp: 38, attack: 12, magicPressure: 0, staminaPressure: 5 },
      { name: "Dust Lynx", text: "A Dust Lynx circles through the grass with blinding speed. What do you do?", hp: 46, attack: 15, magicPressure: 1, staminaPressure: 6 },
      { name: "Stoneback Ram", text: "A Stoneback Ram pounds the ground and closes the gap. What do you do?", hp: 64, attack: 19, magicPressure: 1, staminaPressure: 8 },
      { name: "Plains Marauder", text: "A Plains Marauder draws steel and demands tribute. What do you do?", hp: 72, attack: 21, magicPressure: 2, staminaPressure: 9 },
      { name: "Alpha Basilisk", text: "The Alpha Basilisk fixes you with a petrifying stare. What do you do?", hp: 98, attack: 26, magicPressure: 5, staminaPressure: 11 }
    ]
  },
  "ghost-marsh": {
    title: "Ghost Marsh",
    description: "Push through cursed bogs where spirits and drowned revenants rise without warning.",
    experience: 540,
    rewards: [
      "Gold: 340",
      "Armor (1) (Unidentified)",
      "Sword (1) (Unidentified)",
      "Headgear (1) (Unidentified)",
      "Spectral Resin (2)"
    ],
    enemies: [
      { name: "Bog Wisp", text: "A Bog Wisp flickers over the water and lures you forward. What do you do?", hp: 34, attack: 11, magicPressure: 4, staminaPressure: 3 },
      { name: "Mire Stalker", text: "A Mire Stalker slips from the reeds with poisoned claws. What do you do?", hp: 52, attack: 17, magicPressure: 2, staminaPressure: 7 },
      { name: "Drowned Knight", text: "A Drowned Knight drags its rusted blade through the mud. What do you do?", hp: 70, attack: 20, magicPressure: 3, staminaPressure: 8 },
      { name: "Pale Banshee", text: "A Pale Banshee wails and the marsh answers in echoes. What do you do?", hp: 78, attack: 23, magicPressure: 6, staminaPressure: 7 },
      { name: "Grave Matron", text: "The Grave Matron rises from the black water and calls the dead to her side. What do you do?", hp: 104, attack: 28, magicPressure: 8, staminaPressure: 10 }
    ]
  }
};

const state = {
  token: null,
  userId: null,
  username: null,
  appId: null,
  appName: null,
  packageId: null,
  itemDefId: null,
  packageCredits: null,
  packageAmountCents: null,
  pendingCheckout: null,
  currentView: "home",
  characters: [],
  selectedCharacterId: null
};

const changeIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm14.71-9.04a1 1 0 0 0 0-1.41l-1.5-1.5a1 1 0 0 0-1.41 0l-1.09 1.09 2.75 2.75 1.25-1.18Z" />
  </svg>
`;

function randomKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
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

function setView(name) {
  loginViewEl.hidden = name !== "login";
  gameViewEl.hidden = name !== "game";
}

function setGameView(name) {
  state.currentView = name;
  homeViewEl.hidden = name !== "home";
  charactersViewEl.hidden = name !== "characters";
  questsViewEl.hidden = name !== "quests";
  inventoryViewEl.hidden = name !== "inventory";
  characterDetailViewEl.hidden = name !== "character-detail";
}

function supportsCreditsDialog() {
  return typeof creditsModalEl?.showModal === "function";
}

function supportsCharacterDialog() {
  return typeof characterModalEl?.showModal === "function";
}

function formatCurrency(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
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

function getCredentials(input = null) {
  const username = (input?.username ?? usernameInputEl.value).trim();
  const password = input?.password ?? passwordInputEl.value;
  if (!username || !password) {
    throw new Error("Username and password are required.");
  }
  return { username, password };
}

function persistSession() {
  localStorage.setItem(
    sessionStorageKey,
    JSON.stringify({
      token: state.token,
      userId: state.userId,
      username: state.username
    })
  );
}

function clearSession() {
  state.token = null;
  state.userId = null;
  state.username = null;
  localStorage.removeItem(sessionStorageKey);
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
    state.username = session.username ?? null;
  } catch {
    clearSession();
    return false;
  }

  if (!state.token || !state.userId || !state.username) {
    clearSession();
    return false;
  }

  usernameInputEl.value = state.username;
  playerUsernameEl.textContent = state.username;
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

function getCharactersKey() {
  if (!state.appId || !state.userId) {
    return null;
  }
  return `${charactersStorageKey}:${state.appId}:${state.userId}`;
}

function normalizeCharacter(record) {
  const classType = classDefinitions[record?.classType] ? record.classType : "fighter";
  const definition = classDefinitions[classType];
  const activeQuest = normalizeActiveQuest(record?.activeQuest, definition);
  const questHistory = normalizeQuestHistory(record?.questHistory);

  return {
    id: record?.id ?? crypto.randomUUID(),
    name: record?.name ?? "Adventurer",
    classType,
    experience: Number(record?.experience ?? 0),
    gold: Number(record?.gold ?? 0),
    inventory: Array.isArray(record?.inventory) ? record.inventory : [],
    equipment: {
      headgear: record?.equipment?.headgear ?? definition.equipment.headgear,
      armor: record?.equipment?.armor ?? definition.equipment.armor,
      weapon: record?.equipment?.weapon ?? definition.equipment.weapon
    },
    activeQuest,
    questHistory
  };
}

function normalizeActiveQuest(activeQuest, definition) {
  if (!activeQuest || !questDefinitions[activeQuest.questId]) {
    return null;
  }

  const quest = questDefinitions[activeQuest.questId];
  const enemyIndex = Math.min(Math.max(Number(activeQuest.enemyIndex ?? 0), 0), quest.enemies.length - 1);
  return {
    questId: activeQuest.questId,
    enemyIndex,
    currentHp: Number(activeQuest.currentHp ?? definition.hp),
    currentMana: Number(activeQuest.currentMana ?? definition.mana),
    currentStamina: Number(activeQuest.currentStamina ?? definition.stamina),
    completed: Boolean(activeQuest.completed)
  };
}

function normalizeQuestHistory(questHistory) {
  if (!Array.isArray(questHistory)) {
    return [];
  }

  return questHistory
    .filter((entry) => questDefinitions[entry?.questId])
    .map((entry) => ({
      questId: entry.questId,
      status: entry.status === "claimed" ? "claimed" : entry.status === "completed" ? "completed" : "active"
    }));
}

function restoreCharacters() {
  const key = getCharactersKey();
  if (!key) {
    state.characters = [];
    return;
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    state.characters = [];
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.characters = Array.isArray(parsed) ? parsed.map((entry) => normalizeCharacter(entry)) : [];
  } catch {
    state.characters = [];
  }
}

function persistCharacters() {
  const key = getCharactersKey();
  if (!key) {
    return;
  }
  localStorage.setItem(key, JSON.stringify(state.characters));
}

function createCharacterRecord(name, classType) {
  const definition = classDefinitions[classType];
  return {
    id: crypto.randomUUID(),
    name,
    classType,
    experience: 0,
    gold: 0,
    inventory: [],
    equipment: { ...definition.equipment },
    activeQuest: null,
    questHistory: []
  };
}

function getClassLabel(classType) {
  return classDefinitions[classType]?.label ?? "Adventurer";
}

function getClassIcon(classType) {
  return classIcons[classType] ?? classIcons.fighter;
}

function renderKeyValueList(element, items) {
  element.innerHTML = items
    .map(
      (item) => `
        <div class="detail-row">
          <dt>${item.label}</dt>
          <dd>${item.value}</dd>
        </div>
      `
    )
    .join("");
}

function renderRewardList(element, rewards) {
  element.innerHTML = rewards
    .map((reward) => `<div class="reward-item">${reward}</div>`)
    .join("");
}

function renderEquipmentList(element, items) {
  element.innerHTML = items
    .map(
      (item) => `
        <div class="detail-row detail-row-equipment">
          <dt>${item.label}</dt>
          <dd class="detail-row-action">
            <span>${item.value}</span>
            <button class="icon-button icon-button-mini" type="button" aria-label="Change ${item.label}">
              ${changeIcon}
            </button>
          </dd>
        </div>
      `
    )
    .join("");
}

function getSelectedCharacter() {
  return state.characters.find((character) => character.id === state.selectedCharacterId) ?? null;
}

function getQuestHistoryEntry(character, questId) {
  return character.questHistory.find((entry) => entry.questId === questId) ?? null;
}

function upsertQuestHistoryEntry(character, questId, status) {
  const existing = getQuestHistoryEntry(character, questId);
  if (existing) {
    existing.status = status;
    return existing;
  }

  const created = { questId, status };
  character.questHistory.push(created);
  return created;
}

function getQuestLogEntries() {
  return state.characters.flatMap((character) =>
    character.questHistory.map((entry) => ({
      characterId: character.id,
      characterName: character.name,
      questId: entry.questId,
      questTitle: questDefinitions[entry.questId].title,
      status: entry.status
    }))
  );
}

function getClaimedInventoryEntries() {
  return state.characters.flatMap((character) =>
    character.inventory.map((item, index) => ({
      key: `${character.id}:${index}:${item}`,
      characterName: character.name,
      item
    }))
  );
}

function getDisplayedStats(character) {
  const definition = classDefinitions[character.classType];
  if (!character.activeQuest) {
    return {
      hp: definition.hp,
      mana: definition.mana,
      stamina: definition.stamina
    };
  }

  return {
    hp: character.activeQuest.currentHp,
    mana: character.activeQuest.currentMana,
    stamina: character.activeQuest.currentStamina
  };
}

function renderCharacters() {
  charactersGridEl.innerHTML = "";

  for (const character of state.characters) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card character-tile";
    card.innerHTML = `
      <div class="character-portrait">
        <span class="portrait-icon" aria-hidden="true">${getClassIcon(character.classType)}</span>
      </div>
      <div class="character-copy">
        <strong>${character.name}</strong>
        <small>${getClassLabel(character.classType)}</small>
      </div>
    `;
    card.addEventListener("click", () => {
      openCharacterDetail(character.id);
    });
    charactersGridEl.appendChild(card);
  }

  const createCard = document.createElement("button");
  createCard.type = "button";
  createCard.className = "card character-tile create-character-tile";
  createCard.innerHTML = `
    <div class="character-portrait">
      <span class="portrait-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M11 5h2v14h-2V5Zm-6 6h14v2H5v-2Z" /></svg>
      </span>
    </div>
    <div class="character-copy">
      <strong>Create character</strong>
      <small>Add a new hero to your roster.</small>
    </div>
  `;
  createCard.addEventListener("click", () => {
    openCharacterModal();
  });
  charactersGridEl.appendChild(createCard);
}

function renderQuestsView() {
  const entries = getQuestLogEntries();
  if (entries.length === 0) {
    questsListEl.innerHTML = `
      <article class="card empty-state-card">
        <strong>No quest activity yet</strong>
        <small>Start a quest from a character page to see it here.</small>
      </article>
    `;
    return;
  }

  questsListEl.innerHTML = entries
    .map(
      (entry) => `
        <article class="card quest-log-card">
          <div class="quest-log-copy">
            <strong>${entry.questTitle}</strong>
            <small>${entry.characterName}</small>
            <small>Status: ${entry.status === "completed" ? "Completed" : entry.status === "claimed" ? "Claimed" : "Active"}</small>
          </div>
          <div class="quest-log-actions">
            <button class="button button-secondary" type="button" data-view-quest="${entry.characterId}">View</button>
            ${
              entry.status === "completed"
                ? `<button class="button button-primary" type="button" data-claim-quest="${entry.characterId}:${entry.questId}">Claim Rewards</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");

  for (const button of questsListEl.querySelectorAll("[data-view-quest]")) {
    button.addEventListener("click", () => {
      openCharacterDetail(button.getAttribute("data-view-quest"));
    });
  }

  for (const button of questsListEl.querySelectorAll("[data-claim-quest]")) {
    button.addEventListener("click", () => {
      const [characterId, questId] = button.getAttribute("data-claim-quest").split(":");
      claimQuestRewards(characterId, questId);
    });
  }
}

function renderInventoryView() {
  const items = getClaimedInventoryEntries();
  const totalGold = state.characters.reduce((sum, character) => sum + character.gold, 0);
  inventoryGoldTotalEl.textContent = `Gold: ${totalGold}`;
  inventoryItemsTotalEl.textContent = `${items.length} claimed items`;

  if (items.length === 0) {
    inventoryListEl.innerHTML = `
      <article class="card empty-state-card">
        <strong>No claimed rewards yet</strong>
        <small>Claim quest rewards to move items into inventory.</small>
      </article>
    `;
    return;
  }

  inventoryListEl.innerHTML = items
    .map(
      (entry) => `
        <article class="card inventory-item-card">
          <strong>${entry.item}</strong>
          <small>Claimed by ${entry.characterName}</small>
        </article>
      `
    )
    .join("");
}

function renderQuestList(character) {
  questListStateEl.hidden = false;
  questActiveStateEl.hidden = true;
  questCompleteStateEl.hidden = true;
  questPanelTitleEl.textContent = "Quests";

  questListStateEl.innerHTML = Object.entries(questDefinitions)
    .map(
      ([questId, quest]) => `
        <button class="quest-list-item" type="button" data-quest-id="${questId}">
          <strong>${quest.title}</strong>
          <small>${quest.description}</small>
        </button>
      `
    )
    .join("");

  for (const button of questListStateEl.querySelectorAll("[data-quest-id]")) {
    button.addEventListener("click", () => {
      startQuest(character.id, button.getAttribute("data-quest-id"));
    });
  }
}

function renderActiveQuest(character, quest) {
  const activeQuest = character.activeQuest;
  const enemy = quest.enemies[activeQuest.enemyIndex];

  questListStateEl.hidden = true;
  questActiveStateEl.hidden = false;
  questCompleteStateEl.hidden = true;
  questPanelTitleEl.textContent = quest.title;
  questEventTextEl.textContent = enemy.text;
  questProgressTextEl.textContent = `Enemy ${activeQuest.enemyIndex + 1} of ${quest.enemies.length}: ${enemy.name}`;

  renderKeyValueList(enemyStatsListEl, [
    { label: "Name", value: enemy.name },
    { label: "HP", value: String(enemy.hp) },
    { label: "Attack", value: String(enemy.attack) },
    { label: "Magic Pressure", value: String(enemy.magicPressure) },
    { label: "Stamina Pressure", value: String(enemy.staminaPressure) }
  ]);

  renderRewardList(questRewardsListEl, quest.rewards);
}

function renderCompletedQuest(quest) {
  questListStateEl.hidden = true;
  questActiveStateEl.hidden = true;
  questCompleteStateEl.hidden = false;
  questPanelTitleEl.textContent = quest.title;
  questCompleteTextEl.textContent = `${quest.title} is complete. The route is secure and the reward chest is yours to claim.`;
  questExperienceGainedEl.textContent = `${quest.experience} XP`;
  renderRewardList(questCompleteRewardsListEl, quest.rewards);
}

function renderCharacterDetail() {
  const character = getSelectedCharacter();
  if (!character) {
    setGameView("characters");
    return;
  }

  const stats = getDisplayedStats(character);
  const definition = classDefinitions[character.classType];

  detailCharacterNameEl.textContent = character.name;
  detailPortraitIconEl.innerHTML = getClassIcon(character.classType);

  renderKeyValueList(characterStatsListEl, [
    { label: "Name", value: character.name },
    { label: "Class", value: definition.label },
    { label: "HP", value: String(stats.hp) },
    { label: "Mana", value: String(stats.mana) },
    { label: "Stamina", value: String(stats.stamina) }
  ]);

  renderEquipmentList(characterEquipmentListEl, [
    { label: "Headgear", value: character.equipment.headgear },
    { label: "Armor", value: character.equipment.armor },
    { label: "Weapon", value: character.equipment.weapon }
  ]);

  if (!character.activeQuest) {
    renderQuestList(character);
  } else {
    const quest = questDefinitions[character.activeQuest.questId];
    if (character.activeQuest.completed) {
      renderCompletedQuest(quest);
    } else {
      renderActiveQuest(character, quest);
    }
  }
}

function openCharacterDetail(characterId) {
  state.selectedCharacterId = characterId;
  renderCharacterDetail();
  setGameView("character-detail");
}

function updateCharacterPortrait() {
  characterPortraitIconEl.innerHTML = getClassIcon(characterClassSelectEl.value);
}

function openCharacterModal() {
  showFeedback(characterFeedbackEl, "");
  characterFormEl.reset();
  characterClassSelectEl.value = "fighter";
  updateCharacterPortrait();
  if (supportsCharacterDialog()) {
    characterModalEl.showModal();
    return;
  }
  showFeedback(gameFeedbackEl, "This browser does not support the character modal.");
}

function closeCharacterModal() {
  showFeedback(characterFeedbackEl, "");
  if (supportsCharacterDialog() && characterModalEl.open) {
    characterModalEl.close();
  }
}

function createCharacter() {
  const name = characterNameInputEl.value.trim();
  const classType = characterClassSelectEl.value;
  if (!name) {
    throw new Error("Character name is required.");
  }

  state.characters.push(createCharacterRecord(name, classType));
  persistCharacters();
  renderCharacters();
  closeCharacterModal();
  showFeedback(gameFeedbackEl, `${name} created.`);
  setGameView("characters");
}

function startQuest(characterId, questId) {
  const character = state.characters.find((entry) => entry.id === characterId);
  const definition = classDefinitions[character.classType];
  character.activeQuest = {
    questId,
    enemyIndex: 0,
    currentHp: definition.hp,
    currentMana: definition.mana,
    currentStamina: definition.stamina,
    completed: false
  };
  upsertQuestHistoryEntry(character, questId, "active");
  persistCharacters();
  renderCharacterDetail();
  renderQuestsView();
  showFeedback(gameFeedbackEl, `${questDefinitions[questId].title} started.`);
}

function fightQuest() {
  const character = getSelectedCharacter();
  if (!character?.activeQuest || character.activeQuest.completed) {
    return;
  }

  const definition = classDefinitions[character.classType];
  const quest = questDefinitions[character.activeQuest.questId];
  const enemy = quest.enemies[character.activeQuest.enemyIndex];

  const hpLoss = Math.max(6, enemy.attack - definition.resilience);
  const manaLoss = Math.min(character.activeQuest.currentMana, definition.manaCost + enemy.magicPressure);
  const staminaLoss = Math.min(character.activeQuest.currentStamina, definition.staminaCost + enemy.staminaPressure);

  character.activeQuest.currentHp = Math.max(0, character.activeQuest.currentHp - hpLoss);
  character.activeQuest.currentMana = Math.max(0, character.activeQuest.currentMana - manaLoss);
  character.activeQuest.currentStamina = Math.max(0, character.activeQuest.currentStamina - staminaLoss);

  if (character.activeQuest.currentHp === 0) {
    upsertQuestHistoryEntry(character, character.activeQuest.questId, "active");
    character.activeQuest = null;
    persistCharacters();
    renderCharacterDetail();
    renderQuestsView();
    showFeedback(gameFeedbackEl, `${character.name} was overwhelmed by ${enemy.name} and withdrew from the quest.`);
    return;
  }

  character.activeQuest.enemyIndex += 1;
  if (character.activeQuest.enemyIndex >= quest.enemies.length) {
    character.activeQuest.enemyIndex = quest.enemies.length - 1;
    character.activeQuest.completed = true;
    upsertQuestHistoryEntry(character, character.activeQuest.questId, "completed");
    persistCharacters();
    renderCharacterDetail();
    renderQuestsView();
    showFeedback(gameFeedbackEl, `${character.name} cleared ${quest.title}. Rewards are ready to claim.`);
    return;
  }

  upsertQuestHistoryEntry(character, character.activeQuest.questId, "active");
  persistCharacters();
  renderCharacterDetail();
  renderQuestsView();
  showFeedback(gameFeedbackEl, `${character.name} defeated ${enemy.name}.`);
}

function runQuest() {
  const character = getSelectedCharacter();
  if (!character?.activeQuest || character.activeQuest.completed) {
    return;
  }

  character.activeQuest.currentStamina = Math.max(0, character.activeQuest.currentStamina - 8);
  persistCharacters();
  renderCharacterDetail();
  renderQuestsView();

  const quest = questDefinitions[character.activeQuest.questId];
  const enemy = quest.enemies[character.activeQuest.enemyIndex];
  showFeedback(gameFeedbackEl, `${character.name} falls back from ${enemy.name}, but the encounter is still active.`);
}

function abandonQuest() {
  const character = getSelectedCharacter();
  if (!character?.activeQuest) {
    return;
  }

  const questTitle = questDefinitions[character.activeQuest.questId].title;
  upsertQuestHistoryEntry(character, character.activeQuest.questId, "active");
  character.activeQuest = null;
  persistCharacters();
  renderCharacterDetail();
  renderQuestsView();
  showFeedback(gameFeedbackEl, `${questTitle} abandoned.`);
}

function claimQuestRewards(characterId = state.selectedCharacterId, questId = null) {
  const character = state.characters.find((entry) => entry.id === characterId);
  if (!character) {
    return;
  }

  const resolvedQuestId = questId ?? character.activeQuest?.questId;
  const historyEntry = resolvedQuestId ? getQuestHistoryEntry(character, resolvedQuestId) : null;
  if (!resolvedQuestId || historyEntry?.status !== "completed") {
    return;
  }

  const quest = questDefinitions[resolvedQuestId];
  character.experience += quest.experience;
  character.gold += Number(quest.rewards[0].replace(/[^\d]/g, "")) || 0;
  character.inventory.push(...quest.rewards.slice(1));
  historyEntry.status = "claimed";
  if (character.activeQuest?.questId === resolvedQuestId) {
    character.activeQuest = null;
  }
  persistCharacters();
  renderCharacterDetail();
  renderQuestsView();
  renderInventoryView();
  showFeedback(gameFeedbackEl, `${quest.title} rewards claimed.`);
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
  creditsAppNameEl.textContent = state.appName;
  creditsPackageAmountEl.textContent = `${state.packageCredits ?? 0} credits`;
  creditsPackagePriceEl.textContent = formatCurrency(state.packageAmountCents ?? 0);
}

async function refreshBalance() {
  if (!state.appId || !state.userId) {
    balanceEl.textContent = "0";
    return;
  }

  const users = await fetchApi(`/users?appId=${encodeURIComponent(state.appId)}`);
  const record = users.find((user) => user.userId === state.userId);
  balanceEl.textContent = String(record?.balance ?? 0);
}

async function signIn(input = null) {
  const { username, password } = getCredentials(input);

  signInBtn.disabled = true;
  signUpBtn.disabled = true;
  try {
    const session = await fetchApi("/player/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    state.token = session.token;
    state.userId = session.userId;
    state.username = username;
    playerUsernameEl.textContent = username;
    persistSession();
    restoreCharacters();
    renderCharacters();
    renderQuestsView();
    renderInventoryView();
    await refreshBalance();
    setView("game");
    setGameView("home");
  } finally {
    signInBtn.disabled = false;
    signUpBtn.disabled = false;
  }
}

async function signUp() {
  const { username, password } = getCredentials();

  signInBtn.disabled = true;
  signUpBtn.disabled = true;
  try {
    const session = await fetchApi("/player/sign-up", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomKey("player-sign-up")
      },
      body: JSON.stringify({ username, password })
    });

    state.token = session.token;
    state.userId = session.userId;
    state.username = username;
    playerUsernameEl.textContent = username;
    persistSession();
    restoreCharacters();
    renderCharacters();
    renderQuestsView();
    renderInventoryView();
    await refreshBalance();
    setView("game");
    setGameView("home");
  } finally {
    signInBtn.disabled = false;
    signUpBtn.disabled = false;
  }
}

function signOut() {
  clearSession();
  clearPendingCheckout();
  state.characters = [];
  state.selectedCharacterId = null;
  playerUsernameEl.textContent = "-";
  balanceEl.textContent = "0";
  passwordInputEl.value = "";
  showFeedback(loginFeedbackEl, "");
  showFeedback(gameFeedbackEl, "");
  showFeedback(creditsFeedbackEl, "");
  showFeedback(characterFeedbackEl, "");
  if (supportsCreditsDialog() && creditsModalEl.open) {
    creditsModalEl.close();
  }
  if (supportsCharacterDialog() && characterModalEl.open) {
    characterModalEl.close();
  }
  setView("login");
  setGameView("home");
}

function openCreditsModal() {
  if (!state.userId) {
    showFeedback(gameFeedbackEl, "Sign in first.");
    return;
  }
  showFeedback(creditsFeedbackEl, "");
  if (supportsCreditsDialog()) {
    creditsModalEl.showModal();
    return;
  }
  showFeedback(gameFeedbackEl, "This browser does not support the credits modal.");
}

function closeCreditsModal() {
  showFeedback(creditsFeedbackEl, "");
  if (supportsCreditsDialog() && creditsModalEl.open) {
    creditsModalEl.close();
  }
}

async function buyCredits() {
  if (!state.appId || !state.packageId || !state.userId) {
    throw new Error("Sign in first.");
  }

  continueCheckoutBtn.disabled = true;
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
    closeCreditsModal();
    window.location.assign(checkout.checkoutUrl);
  } finally {
    continueCheckoutBtn.disabled = false;
  }
}

async function completeReturnedCheckout(checkoutSessionId) {
  await fetchApi("/demo/checkout/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomKey("frontend-complete")
    },
    body: JSON.stringify({
      checkoutSessionId
    })
  });

  clearPendingCheckout();
  await refreshBalance();
  showFeedback(gameFeedbackEl, "Credits added successfully.");
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get("checkout");
  if (!checkoutStatus) {
    return;
  }

  if (checkoutStatus === "cancel") {
    clearPendingCheckout();
    showFeedback(gameFeedbackEl, "Checkout cancelled.");
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

loginFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(loginFeedbackEl, "");
  signIn().catch((error) => {
    showFeedback(loginFeedbackEl, error.message);
  });
});

signUpBtn.addEventListener("click", () => {
  showFeedback(loginFeedbackEl, "");
  signUp().catch((error) => {
    showFeedback(loginFeedbackEl, error.message);
  });
});

signOutBtn.addEventListener("click", () => {
  signOut();
});

charactersPanelBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  renderCharacters();
  setGameView("characters");
});

questsPanelBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  renderQuestsView();
  setGameView("quests");
});

inventoryPanelBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  renderInventoryView();
  setGameView("inventory");
});

charactersBackBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  setGameView("home");
});

questsBackBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  setGameView("home");
});

inventoryBackBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  setGameView("home");
});

characterDetailBackBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  setGameView("characters");
});

fightBtn.addEventListener("click", () => {
  fightQuest();
});

runBtn.addEventListener("click", () => {
  runQuest();
});

abandonQuestBtn.addEventListener("click", () => {
  abandonQuest();
});

claimRewardsBtn.addEventListener("click", () => {
  claimQuestRewards();
});

openCreditsModalBtn.addEventListener("click", () => {
  showFeedback(gameFeedbackEl, "");
  openCreditsModal();
});

closeCreditsModalBtn.addEventListener("click", () => {
  closeCreditsModal();
});

closeCharacterModalBtn.addEventListener("click", () => {
  closeCharacterModal();
});

characterClassSelectEl.addEventListener("change", () => {
  updateCharacterPortrait();
});

creditsFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(creditsFeedbackEl, "");
  buyCredits().catch((error) => {
    showFeedback(creditsFeedbackEl, error.message);
  });
});

characterFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  showFeedback(characterFeedbackEl, "");
  createCharacterBtn.disabled = true;
  try {
    createCharacter();
  } catch (error) {
    showFeedback(characterFeedbackEl, error.message);
  } finally {
    createCharacterBtn.disabled = false;
  }
});

async function boot() {
  setView("login");
  setGameView("home");
  restorePendingCheckout();
  await loadConfig();
  const hasSession = restoreSession();
  if (hasSession) {
    restoreCharacters();
    renderCharacters();
    renderQuestsView();
    renderInventoryView();
    await refreshBalance();
    setView("game");
  }
  await handleCheckoutReturn();
}

boot().catch((error) => {
  showFeedback(loginFeedbackEl, error.message);
  showFeedback(gameFeedbackEl, error.message);
});
