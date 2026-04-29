// Taskbar Garden - frontend logic. Pure DOM + Canvas. No bundler.

const tauri = window.__TAURI__ || null;
const invoke = tauri?.core?.invoke ?? (() => Promise.resolve());
const listen = tauri?.event?.listen ?? (() => () => {});

const SAVE_KEY = "taskbar-garden:save:v2";
const SETTINGS_KEY = "taskbar-garden:settings:v1";

const COLS_MAX = 4;
const ROWS_MAX = 4;
const CANVAS_PX = 240;
const TICK_MS = 1000;
const ANIM_MS = 220;

const SOIL_STANDARD = "standard";
const SOIL_RICH = "rich";

const SEEDS = {
  daisy:    { name: "Daisy",     cost: 5,  reward: 12, growMs: 60_000,  petal: "#ffffff", center: "#f4d35e", soil: SOIL_STANDARD },
  poppy:    { name: "Poppy",     cost: 8,  reward: 18, growMs: 90_000,  petal: "#d94c3a", center: "#3a2418", soil: SOIL_STANDARD },
  tulip:    { name: "Tulip",     cost: 12, reward: 30, growMs: 150_000, petal: "#e8a4c9", center: "#c95a8d", soil: SOIL_STANDARD },
  bluebell: { name: "Bluebell",  cost: 18, reward: 45, growMs: 220_000, petal: "#7da7e8", center: "#3a5a8a", soil: SOIL_RICH },
  lavender: { name: "Lavender",  cost: 22, reward: 55, growMs: 260_000, petal: "#b48be0", center: "#5a3d8a", soil: SOIL_RICH },
  sunflower:{ name: "Sunflower", cost: 25, reward: 70, growMs: 300_000, petal: "#f4d35e", center: "#8b5a3c", soil: SOIL_RICH },
};

const VISITOR_NAMES = ["Hazel", "Pip", "Mara", "Otis", "Wren", "Juno", "Fern", "Bram"];
const VISITOR_GREETINGS = [
  "Got any {{flower}}? My table is bare.",
  "Quick stop - {{qty}} {{flower}}, please.",
  "{{flower}} would brighten my window.",
  "Heard you grow lovely {{flower}}.",
  "{{qty}} {{flower}} for the festival?",
  "Trading {{qty}} {{flower}}? I'll pay well.",
];

const LEVELS = [
  { rows: 2, cols: 2, threshold: 0  },
  { rows: 2, cols: 3, threshold: 5  },
  { rows: 3, cols: 3, threshold: 15 },
  { rows: 3, cols: 4, threshold: 30 },
  { rows: 4, cols: 4, threshold: 50 },
];

const STAGE = { EMPTY: 0, SEED: 1, SPROUT: 2, BUD: 3, BLOOM: 4 };
const TOOL_PLANT = "plant";
const TOOL_WATER = "water";
const TOOL_COMPOST = "compost";

const COMPOST_COST = 30;

const DEFAULT_SETTINGS = { sound: true, anchor: "tray", size: "medium" };

function emptyPlot() {
  return { stage: STAGE.EMPTY, seed: null, plantedAt: 0, growthMs: 0, water: 0, soil: SOIL_STANDARD, weed: false };
}

function defaultBunny() {
  return { happy: 5, fedAt: 0, pettedAt: 0, lastDecayAt: Date.now() };
}

function defaultQuests() {
  return { gen: 0, items: [], rolledAt: 0 };
}

function defaultSave() {
  return {
    coins: 30,
    plots: Array.from({ length: COLS_MAX * ROWS_MAX }, () => emptyPlot()),
    inventory: { daisy: 3, compost: 0 },
    selectedSeed: "daisy",
    tool: TOOL_PLANT,
    customer: null,
    customerCooldown: 90_000,
    totalHarvests: 0,
    weather: null,
    weatherCooldown: 5 * 60_000,
    bunny: defaultBunny(),
    quests: defaultQuests(),
    weedCheckCooldown: 90_000,
    combo: { count: 0, until: 0 },
    stats: { planted: 0, watered: 0, sold: 0, harvested: 0, weedsPulled: 0 },
  };
}

const QUEST_TEMPLATES = [
  { id: "plant",   text: "Plant {n} seeds",     min: 3, max: 6,  reward: 25, statKey: "planted" },
  { id: "harvest", text: "Harvest {n} flowers", min: 4, max: 8,  reward: 40, statKey: "harvested" },
  { id: "water",   text: "Water plots {n}x",    min: 6, max: 10, reward: 20, statKey: "watered" },
  { id: "sell",    text: "Sell to {n} visitor", min: 1, max: 2,  reward: 60, statKey: "sold" },
  { id: "weeds",   text: "Pull {n} weeds",      min: 2, max: 4,  reward: 30, statKey: "weedsPulled" },
];
const QUEST_RESET_MS = 24 * 60 * 60 * 1000;
const COMBO_WINDOW_MS = 10_000;
const BUNNY_DECAY_MS = 4 * 60 * 1000; // -1 happy every 4 min if untended
const ADJACENCY_BONUS_PCT = 0.2;

const RAIN_DROPS = 14;
const AMBIENT_COUNT = 4;
const CLOUD_COUNT = 2;
const clouds = [];
const ambient = []; // transient, not persisted
const rainDrops = [];
const particles = []; // sparkles + hearts on harvest/water

const mascot = {
  x: 120,
  y: 200,
  vx: 0,
  vy: 0,
  facing: 1, // 1=right, -1=left
  hp: 3,
  hpMax: 3,
  invulnUntil: 0,
  dashUntil: 0,
  dashCdUntil: 0,
  mood: "idle",
  moodUntil: 0,
  blinkUntil: 0,
  nextBlinkAt: 0,
};

const PLAYER_SPEED = 1.6;
const DASH_SPEED = 4.5;
const DASH_DUR = 180;
const DASH_CD = 700;
const INVULN_MS = 900;

const pests = [];
const projectiles = [];
const drops = [];

const PEST_TYPES = {
  slug: { hp: 2, speed: 0.35, r: 6, color: "#7a5a3a", dmg: 1, coin: 4 },
  beetle: { hp: 3, speed: 0.55, r: 6, color: "#3a2a18", dmg: 1, coin: 7 },
  rat: { hp: 4, speed: 0.8, r: 7, color: "#5a4a3a", dmg: 1, coin: 12 },
};

let wave = 1;
let waveTimer = 30_000;
let waveSpawnedThisRound = 0;
let nextSpawnAt = 0;
let gameOver = false;
let respawnAt = 0;
let score = 0;

const keys = Object.create(null);

let state = sanitize(load(SAVE_KEY, defaultSave()));
let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };
let canvas = null;
let ctx = null;
let hoverIdx = -1;
let tickHandle = null;
let rafHandle = null;
let audio = null;
let lastLevel = currentLevel();
let lastTickAt = Date.now();
let persistCounter = 0;
let lastFrameAt = Date.now();

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: storage may be disabled or full
  }
}

function persist() {
  saveJSON(SAVE_KEY, state);
  saveJSON(SETTINGS_KEY, settings);
}

function sanitize(s) {
  const base = defaultSave();
  if (!s || typeof s !== "object") return base;
  const out = { ...base, ...s };
  if (!Array.isArray(out.plots) || out.plots.length !== COLS_MAX * ROWS_MAX) {
    out.plots = base.plots;
  } else {
    out.plots = out.plots.map((p) => {
      const merged = { ...emptyPlot(), ...(p || {}) };
      merged.water = Number(merged.water) || 0;
      merged.growthMs = Number(merged.growthMs) || 0;
      merged.plantedAt = Number(merged.plantedAt) || 0;
      if (!SEEDS[merged.seed]) merged.seed = null;
      if (merged.soil !== SOIL_RICH) merged.soil = SOIL_STANDARD;
      return merged;
    });
  }
  if (!out.inventory || typeof out.inventory !== "object") {
    out.inventory = { ...base.inventory };
  } else {
    const inv = {};
    for (const k of Object.keys(out.inventory)) {
      inv[k] = Number(out.inventory[k]) || 0;
    }
    out.inventory = inv;
  }
  if (!SEEDS[out.selectedSeed]) out.selectedSeed = "daisy";
  if (![TOOL_PLANT, TOOL_WATER, TOOL_COMPOST].includes(out.tool)) out.tool = TOOL_PLANT;
  if (typeof out.coins !== "number" || !Number.isFinite(out.coins)) out.coins = 0;
  if (typeof out.totalHarvests !== "number" || !Number.isFinite(out.totalHarvests)) out.totalHarvests = 0;
  if (out.customer) {
    const c = out.customer;
    if (typeof c !== "object" || !SEEDS[c.want] || !Number.isFinite(c.expiresAt) || !Number.isFinite(c.qty) || !Number.isFinite(c.bonus)) {
      out.customer = null;
    }
  }
  if (!Number.isFinite(out.customerCooldown)) out.customerCooldown = 90_000;
  if (!Number.isFinite(out.weatherCooldown)) out.weatherCooldown = 5 * 60_000;
  if (out.weather && (typeof out.weather !== "object" || !Number.isFinite(out.weather.untilMs))) {
    out.weather = null;
  }
  if (!out.bunny || typeof out.bunny !== "object") out.bunny = defaultBunny();
  else {
    out.bunny.happy = Math.max(0, Math.min(10, Number(out.bunny.happy) || 5));
    out.bunny.fedAt = Number(out.bunny.fedAt) || 0;
    out.bunny.pettedAt = Number(out.bunny.pettedAt) || 0;
    out.bunny.lastDecayAt = Number(out.bunny.lastDecayAt) || Date.now();
  }
  if (!out.quests || typeof out.quests !== "object") out.quests = defaultQuests();
  if (!Array.isArray(out.quests.items)) out.quests.items = [];
  if (!Number.isFinite(out.weedCheckCooldown)) out.weedCheckCooldown = 90_000;
  if (!out.combo || typeof out.combo !== "object") out.combo = { count: 0, until: 0 };
  if (!out.stats || typeof out.stats !== "object") out.stats = { planted: 0, watered: 0, sold: 0, harvested: 0, weedsPulled: 0 };
  return out;
}

// ---------- Levels ----------

function currentLevel() {
  let lv = 1;
  for (let i = 0; i < LEVELS.length; i++) {
    if (state.totalHarvests >= LEVELS[i].threshold) lv = i + 1;
  }
  return lv;
}

function shape() {
  return LEVELS[currentLevel() - 1];
}

function isUnlocked(idx) {
  const r = Math.floor(idx / COLS_MAX);
  const c = idx % COLS_MAX;
  const sh = shape();
  return r < sh.rows && c < sh.cols;
}

function tileMetrics() {
  const sh = shape();
  const max = Math.max(sh.rows, sh.cols);
  const tile = Math.floor(CANVAS_PX / max);
  const offX = Math.floor((CANVAS_PX - tile * sh.cols) / 2);
  const offY = Math.floor((CANVAS_PX - tile * sh.rows) / 2);
  return { tile, offX, offY, sh };
}

// ---------- Game tick ----------

function tick() {
  const now = Date.now();
  const rawDt = now - lastTickAt;
  const dt = rawDt > 0 ? Math.min(rawDt, TICK_MS * 5) : 0;
  lastTickAt = now;
  const growthMult = bunnyGrowthMult();
  for (let i = 0; i < state.plots.length; i++) {
    const p = state.plots[i];
    if (!isUnlocked(i)) continue;
    if (p.stage === STAGE.EMPTY || p.stage === STAGE.BLOOM) continue;
    const seed = SEEDS[p.seed];
    if (!seed) {
      Object.assign(p, emptyPlot());
      continue;
    }
    p.water = Math.max(0, p.water - 0.05);
    if (p.water <= 0) continue;
    if (p.weed) continue; // weeds block growth
    p.growthMs = (p.growthMs || 0) + dt * growthMult;
    const ratio = Math.min(1, p.growthMs / seed.growMs);
    if (ratio >= 1) p.stage = STAGE.BLOOM;
    else if (ratio >= 0.66) p.stage = STAGE.BUD;
    else if (ratio >= 0.33) p.stage = STAGE.SPROUT;
    else p.stage = STAGE.SEED;
  }
  tickBunny(now);
  maybeSpawnWeed();
  if (state.combo.count > 0 && now > state.combo.until) state.combo = { count: 0, until: 0 };

  state.customerCooldown = Math.max(0, (state.customerCooldown || 0) - TICK_MS);
  if (!state.customer && state.customerCooldown <= 0 && state.totalHarvests > 0) {
    spawnCustomer();
  }
  if (state.customer && state.customer.expiresAt < now) {
    state.customer = null;
    state.customerCooldown = 60_000;
  }

  updateWeather(now);
  updateAmbient();

  renderTopbar();
  renderCustomer();
  if (++persistCounter % 5 === 0) persist();
}

function updateWeather(now) {
  if (state.weather && state.weather.untilMs <= now) {
    state.weather = null;
    state.weatherCooldown = (10 + Math.random() * 10) * 60_000;
  }
  if (!state.weather) {
    state.weatherCooldown = Math.max(0, (state.weatherCooldown || 0) - TICK_MS);
    if (state.weatherCooldown <= 0 && Math.random() < 0.3) {
      state.weather = { type: "rain", untilMs: now + 60_000 };
      // rain gives plots a free drink at start
      for (let i = 0; i < state.plots.length; i++) {
        if (!isUnlocked(i)) continue;
        if (state.plots[i].stage !== STAGE.EMPTY) state.plots[i].water = 10;
      }
      seedRainDrops();
    } else if (state.weatherCooldown <= 0) {
      // rolled no rain - try again sooner
      state.weatherCooldown = 2 * 60_000;
    }
  } else if (state.weather.type === "rain") {
    // top up plots while raining
    for (let i = 0; i < state.plots.length; i++) {
      if (!isUnlocked(i)) continue;
      const p = state.plots[i];
      if (p.stage !== STAGE.EMPTY && p.water < 10) p.water = Math.min(10, p.water + 0.4);
    }
  }
}

function seedRainDrops() {
  rainDrops.length = 0;
  for (let i = 0; i < RAIN_DROPS; i++) {
    rainDrops.push({
      x: Math.random() * CANVAS_PX,
      y: Math.random() * CANVAS_PX,
      v: 4 + Math.random() * 3,
    });
  }
}

function updateAmbient() {
  if (state.weather && state.weather.type === "rain") {
    ambient.length = 0;
    return;
  }
  while (ambient.length < AMBIENT_COUNT) {
    ambient.push(spawnAmbient());
  }
}

function spawnAmbient() {
  const h = new Date().getHours();
  const isNight = h >= 21 || h < 6;
  // weighted pick
  const pool = isNight
    ? ["firefly", "firefly", "firefly", "snail"]
    : ["bee", "butterfly", "butterfly", "ladybug", "frog", "snail", "bird"];
  const kind = pool[Math.floor(Math.random() * pool.length)];
  const base = {
    kind,
    x: Math.random() * CANVAS_PX,
    y: 20 + Math.random() * (CANVAS_PX - 40),
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.4,
    vy: 0,
    timer: 0,
    state: "idle",
  };
  if (kind === "ladybug") { base.y = CANVAS_PX - 14; base.speed = 0.18 + Math.random() * 0.12; }
  if (kind === "snail")   { base.y = CANVAS_PX - 12; base.speed = 0.05 + Math.random() * 0.04; }
  if (kind === "frog")    { base.y = CANVAS_PX - 18; base.speed = 0; base.timer = 1500 + Math.random() * 2500; }
  if (kind === "bird")    { base.y = 10 + Math.random() * 30; base.speed = 1.3 + Math.random() * 0.6; }
  if (kind === "firefly") { base.speed = 0.2 + Math.random() * 0.2; }
  return base;
}

function spawnCloud(x) {
  return {
    x: x ?? Math.random() * CANVAS_PX,
    y: 6 + Math.random() * 30,
    w: 28 + Math.random() * 24,
    speed: 0.08 + Math.random() * 0.08,
  };
}

function startTicks() {
  if (tickHandle == null) {
    lastTickAt = Date.now();
    tickHandle = setInterval(tick, TICK_MS);
  }
  if (rafHandle == null) {
    lastFrameAt = Date.now();
    const loop = () => {
      render();
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }
}

function stopTicks() {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
    persist();
  }
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

// ---------- Quests ----------

function rollQuests() {
  const pool = [...QUEST_TEMPLATES];
  const items = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const tIdx = Math.floor(Math.random() * pool.length);
    const t = pool.splice(tIdx, 1)[0];
    const target = t.min + Math.floor(Math.random() * (t.max - t.min + 1));
    items.push({
      id: t.id,
      text: t.text.replace("{n}", target),
      target,
      progress: 0,
      reward: t.reward,
      statKey: t.statKey,
      claimed: false,
    });
  }
  state.quests = { gen: state.quests.gen + 1, items, rolledAt: Date.now() };
}

function ensureQuestsFresh() {
  const now = Date.now();
  if (!state.quests.items.length || now - state.quests.rolledAt > QUEST_RESET_MS) {
    rollQuests();
  }
}

function bumpStat(key, n = 1) {
  state.stats[key] = (state.stats[key] || 0) + n;
  for (const q of state.quests.items) {
    if (q.statKey === key && !q.claimed && q.progress < q.target) {
      q.progress = Math.min(q.target, q.progress + n);
    }
  }
}

function claimQuest(idx) {
  const q = state.quests.items[idx];
  if (!q || q.claimed || q.progress < q.target) return;
  q.claimed = true;
  state.coins += q.reward;
  arpeggio([523.25, 659.25, 783.99], 0.05, "triangle");
  toast("+" + q.reward + "c quest!");
  refreshAll();
}

// ---------- Bunny ----------

function tickBunny(now) {
  const b = state.bunny;
  if (now - b.lastDecayAt >= BUNNY_DECAY_MS) {
    b.happy = Math.max(0, b.happy - 1);
    b.lastDecayAt = now;
  }
}

function petBunny() {
  const b = state.bunny;
  const now = Date.now();
  if (now - b.pettedAt < 1500) return; // limit
  b.pettedAt = now;
  b.happy = Math.min(10, b.happy + 0.5);
  mascot.mood = "happy";
  mascot.moodUntil = now + 1500;
  // sparkle hearts above bunny
  for (let i = 0; i < 4; i++) spawnHeart(mascot.x + (i - 2) * 3, mascot.y - 8);
  voice({ freq: 880, dur: 0.06, type: "sine", volume: 0.04, release: 0.12 });
  voice({ freq: 1174.66, dur: 0.06, type: "triangle", volume: 0.025, release: 0.14, when: 0.05 });
  setHint("Mochi loves it ♡");
  refreshAll();
}

function feedBunny(flowerKey) {
  const b = state.bunny;
  if ((state.inventory[flowerKey] || 0) <= 0) return false;
  state.inventory[flowerKey] -= 1;
  b.happy = Math.min(10, b.happy + 2);
  b.fedAt = Date.now();
  mascot.mood = "happy";
  mascot.moodUntil = Date.now() + 2200;
  arpeggio([523.25, 659.25, 783.99], 0.05, "sine");
  toast("Mochi is happy ♡");
  refreshAll();
  return true;
}

function bunnyGrowthMult() {
  return 1 + (state.bunny.happy / 10) * 0.15; // up to +15%
}

// ---------- Weeds ----------

function maybeSpawnWeed() {
  state.weedCheckCooldown = Math.max(0, state.weedCheckCooldown - TICK_MS);
  if (state.weedCheckCooldown > 0) return;
  state.weedCheckCooldown = 60_000 + Math.random() * 90_000;
  // pick growing plot without weed
  const candidates = [];
  for (let i = 0; i < state.plots.length; i++) {
    if (!isUnlocked(i)) continue;
    const p = state.plots[i];
    if (p.stage > STAGE.EMPTY && p.stage < STAGE.BLOOM && !p.weed) candidates.push(i);
  }
  if (!candidates.length) return;
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  state.plots[idx].weed = true;
  setHint("A weed sprouted! Pull it ♡");
  voice({ freq: 220, dur: 0.12, type: "sawtooth", volume: 0.025, release: 0.18 });
}

function pullWeed(idx) {
  const p = state.plots[idx];
  if (!p?.weed) return false;
  p.weed = false;
  state.coins += 3;
  bumpStat("weedsPulled", 1);
  voice({ freq: 660, dur: 0.05, type: "sine", volume: 0.04, release: 0.1 });
  voice({ freq: 880, dur: 0.05, type: "triangle", volume: 0.025, release: 0.12, when: 0.04 });
  toast("+3c");
  setHint("Weed pulled ♡");
  refreshAll();
  return true;
}

// ---------- Adjacency ----------

function adjacencyBonus(idx, seedId) {
  const r = Math.floor(idx / COLS_MAX);
  const c = idx % COLS_MAX;
  let same = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= ROWS_MAX || nc >= COLS_MAX) continue;
    const np = state.plots[nr * COLS_MAX + nc];
    if (np && np.seed === seedId) same++;
  }
  return same;
}

// ---------- Customers ----------

function hasRichSoil() {
  for (let i = 0; i < state.plots.length; i++) {
    if (isUnlocked(i) && state.plots[i].soil === SOIL_RICH) return true;
  }
  return false;
}

function spawnCustomer() {
  const allIds = Object.keys(SEEDS);
  const richOk = hasRichSoil();
  const eligible = allIds.filter((id) => SEEDS[id].soil === SOIL_STANDARD || richOk);
  const seedIds = eligible.length ? eligible : allIds;
  const want = seedIds[Math.floor(Math.random() * seedIds.length)];
  const qty = 1 + Math.floor(Math.random() * 2);
  const bonus = Math.round(SEEDS[want].reward * qty * (1.4 + Math.random() * 0.4));
  const name = VISITOR_NAMES[Math.floor(Math.random() * VISITOR_NAMES.length)];
  const greetingTpl = VISITOR_GREETINGS[Math.floor(Math.random() * VISITOR_GREETINGS.length)];
  const greeting = greetingTpl
    .replace("{{flower}}", SEEDS[want].name)
    .replace("{{qty}}", String(qty));
  state.customer = { want, qty, bonus, name, greeting, expiresAt: Date.now() + 120_000 };
}

// ---------- Canvas wiring ----------

function setupCanvas() {
  canvas = document.getElementById("garden");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("mousemove", onCanvasMove);
  canvas.addEventListener("mouseleave", () => {
    hoverIdx = -1;
    render();
  });
}

function pointToIdx(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * CANVAS_PX;
  const py = ((clientY - rect.top) / rect.height) * CANVAS_PX;
  const { tile, offX, offY, sh } = tileMetrics();
  if (px < offX || py < offY) return -1;
  const c = Math.floor((px - offX) / tile);
  const r = Math.floor((py - offY) / tile);
  if (c < 0 || c >= sh.cols || r < 0 || r >= sh.rows) return -1;
  return r * COLS_MAX + c;
}

function onCanvasClick(e) {
  // start ambient pad on first user gesture (browser autoplay policy)
  if (settings.sound && !padNodes) startAmbientPad();
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * CANVAS_PX;
  const py = ((e.clientY - rect.top) / rect.height) * CANVAS_PX;
  // bunny hit test
  const dx = px - mascot.x, dy = py - mascot.y - 4;
  if (Math.abs(dx) <= 10 && Math.abs(dy) <= 12) {
    petBunny();
    return;
  }
  const idx = pointToIdx(e.clientX, e.clientY);
  if (idx < 0 || !isUnlocked(idx)) return;
  if (state.plots[idx].weed) { pullWeed(idx); return; }
  if (state.tool === TOOL_PLANT) tryPlantOrHarvest(idx);
  else if (state.tool === TOOL_WATER) tryWater(idx, false);
  else if (state.tool === TOOL_COMPOST) tryCompost(idx);
}

function onCanvasMove(e) {
  const idx = pointToIdx(e.clientX, e.clientY);
  if (idx === hoverIdx) return;
  hoverIdx = idx;
  if (state.tool === TOOL_WATER && idx >= 0 && isUnlocked(idx)) {
    tryWater(idx, true);
  }
  render();
}

// ---------- Actions ----------

function tryPlantOrHarvest(idx) {
  const p = state.plots[idx];
  if (!p) return;
  if (p.weed) { pullWeed(idx); return; }
  if (p.stage === STAGE.BLOOM) {
    harvest(idx);
    return;
  }
  if (p.stage !== STAGE.EMPTY) {
    setHint("Still growing.");
    return;
  }
  const seedId = state.selectedSeed;
  const seed = SEEDS[seedId];
  if (!seed) return;
  if ((state.inventory[seedId] || 0) <= 0) {
    setHint("No " + seed.name + " seeds. Visit shop.");
    return;
  }
  if (seed.soil === SOIL_RICH && p.soil !== SOIL_RICH) {
    setHint(seed.name + " needs RICH soil. Apply compost first.");
    return;
  }
  state.inventory[seedId] -= 1;
  Object.assign(p, {
    stage: STAGE.SEED,
    seed: seedId,
    plantedAt: Date.now(),
    growthMs: 0,
    water: 6,
  });
  // soft plant chime — minor third up
  voice({ freq: 523.25, dur: 0.08, type: "sine", volume: 0.05, release: 0.15 });
  voice({ freq: 659.25, dur: 0.08, type: "triangle", volume: 0.03, release: 0.18, when: 0.04 });
  setHint("Planted " + seed.name + " ♡");
  mascot.mood = "happy";
  mascot.moodUntil = Date.now() + 1200;
  bumpStat("planted", 1);
  refreshAll();
}

function tryWater(idx, silent) {
  const p = state.plots[idx];
  if (!p || p.stage === STAGE.EMPTY) {
    if (!silent) setHint("Nothing here to water!");
    return;
  }
  if (p.water >= 9.5) return;
  p.water = 10;
  // heart particle at plot
  const { tile, offX, offY } = tileMetrics();
  const r = Math.floor(idx / COLS_MAX);
  const c = idx % COLS_MAX;
  spawnHeart(offX + c * tile + tile / 2, offY + r * tile + tile / 2 - 4);
  if (!silent) {
    // water drip — pitched noise burst
    noiseBurst({ dur: 0.06, volume: 0.02, type: "bandpass", freq: 1200 });
    voice({ freq: 880, dur: 0.05, type: "sine", volume: 0.025, release: 0.1 });
    setHint("Watered ♡");
    bumpStat("watered", 1);
  }
  render();
  persist();
}

function tryCompost(idx) {
  const p = state.plots[idx];
  if (!p) return;
  if (p.stage !== STAGE.EMPTY) {
    setHint("Plot must be empty.");
    return;
  }
  if (p.soil === SOIL_RICH) {
    setHint("Already RICH soil.");
    return;
  }
  if ((state.inventory.compost || 0) <= 0) {
    setHint("No compost. Buy from shop.");
    return;
  }
  state.inventory.compost -= 1;
  p.soil = SOIL_RICH;
  // earthy rumble + soft tone
  voice({ freq: 130, dur: 0.18, type: "triangle", volume: 0.06, release: 0.25 });
  voice({ freq: 196, dur: 0.12, type: "sine", volume: 0.03, release: 0.18, when: 0.05 });
  noiseBurst({ dur: 0.12, volume: 0.015, type: "lowpass", freq: 800 });
  setHint("Soil enriched. RICH seeds OK now.");
  refreshAll();
}

function harvest(idx) {
  const p = state.plots[idx];
  const seed = SEEDS[p.seed];
  if (!seed) return;
  // adjacency bonus
  const adj = adjacencyBonus(idx, p.seed);
  // combo
  const now = Date.now();
  if (now < state.combo.until) state.combo.count = Math.min(9, state.combo.count + 1);
  else state.combo.count = 1;
  state.combo.until = now + COMBO_WINDOW_MS;
  const comboMult = 1 + (state.combo.count - 1) * 0.1; // +10% per stack
  const adjMult = 1 + adj * ADJACENCY_BONUS_PCT;
  const finalReward = Math.round(seed.reward * adjMult * comboMult);
  state.coins += finalReward;
  state.totalHarvests += 1;
  const flowerType = p.seed;
  const keepSoil = p.soil;
  // sparkle burst at plot
  const { tile, offX, offY } = tileMetrics();
  const r = Math.floor(idx / COLS_MAX);
  const c = idx % COLS_MAX;
  const sx = offX + c * tile + tile / 2;
  const sy = offY + r * tile + tile / 2;
  spawnSparkles(sx, sy, 10 + adj * 3, seed.petal);
  spawnSparkles(sx, sy, 4 + state.combo.count, "#ffe28a");
  Object.assign(p, emptyPlot());
  p.soil = keepSoil;
  state.inventory["flower:" + flowerType] = (state.inventory["flower:" + flowerType] || 0) + 1;
  // C major arpeggio chime — pitched up by combo
  const baseFreqs = [523.25, 659.25, 783.99, 1046.5];
  const detune = (state.combo.count - 1) * 50;
  arpeggio(baseFreqs.map((f) => f * Math.pow(2, detune / 1200)), 0.05, "sine");
  let msg = "+" + finalReward + "c ♡";
  if (adj > 0) msg += " (×" + adjMult.toFixed(1) + " bond)";
  if (state.combo.count > 1) msg += " ×" + state.combo.count + " combo";
  toast(msg);
  setHint("Harvested " + seed.name + "! So pretty ♡");
  mascot.mood = "happy";
  mascot.moodUntil = Date.now() + 1800;
  bumpStat("harvested", 1);
  checkLevelUp();
  refreshAll();
}

function checkLevelUp() {
  const lv = currentLevel();
  if (lv > lastLevel) {
    lastLevel = lv;
    toast("LEVEL " + lv + " ♡ new plots!");
    arpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.08, "triangle");
    setTimeout(() => chord([523.25, 659.25, 783.99, 1046.5], 0.6, "sine"), 450);
    mascot.mood = "happy";
    mascot.moodUntil = Date.now() + 3000;
    // big sparkle burst around mascot
    for (let i = 0; i < 18; i++) spawnSparkles(mascot.x, mascot.y, 1, ["#ffe28a", "#ffb8d1", "#b8e0a3"][i % 3]);
  }
}

// ---------- Render canvas ----------

function render() {
  if (!ctx) return;
  const h = new Date().getHours();
  const isNight = h >= 21 || h < 6;
  const isDawn = h >= 6 && h < 9;
  const isDusk = h >= 18 && h < 21;

  // sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_PX);
  if (isNight) {
    sky.addColorStop(0, "#2a2347");
    sky.addColorStop(0.55, "#5a4a7a");
    sky.addColorStop(1, "#8a7aa0");
  } else if (isDawn) {
    sky.addColorStop(0, "#ffd6b0");
    sky.addColorStop(0.5, "#ffb8d1");
    sky.addColorStop(1, "#fff0d6");
  } else if (isDusk) {
    sky.addColorStop(0, "#ff9eb1");
    sky.addColorStop(0.5, "#ffc8a5");
    sky.addColorStop(1, "#ffe28a");
  } else {
    sky.addColorStop(0, "#bfe0ff");
    sky.addColorStop(0.6, "#fff0e0");
    sky.addColorStop(1, "#f9e4d4");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  drawSun();
  drawClouds();

  // ground band
  ctx.fillStyle = isNight ? "rgba(143, 203, 122, 0.4)" : "rgba(184, 224, 163, 0.55)";
  ctx.fillRect(0, CANVAS_PX - 50, CANVAS_PX, 50);

  // pastel flower border dots
  const borderPal = ["#ffb8d1", "#b8e0a3", "#ffe28a", "#d9c2ff"];
  for (let x = 0; x < CANVAS_PX; x += 12) {
    ctx.fillStyle = borderPal[((x / 12) | 0) % borderPal.length];
    ctx.fillRect(x, 0, 3, 3);
    ctx.fillRect(x + 4, CANVAS_PX - 3, 3, 3);
  }
  for (let y = 0; y < CANVAS_PX; y += 12) {
    ctx.fillStyle = borderPal[((y / 12) | 0) % borderPal.length];
    ctx.fillRect(0, y + 4, 3, 3);
    ctx.fillRect(CANVAS_PX - 3, y, 3, 3);
  }

  const { tile, offX, offY, sh } = tileMetrics();
  for (let r = 0; r < sh.rows; r++) {
    for (let c = 0; c < sh.cols; c++) {
      const idx = r * COLS_MAX + c;
      drawPlot(offX + c * tile, offY + r * tile, tile, state.plots[idx], idx);
    }
  }

  drawAmbient();
  drawWeather();
  drawParticles();
  drawMascot();
  drawNightOverlay();
  drawVignette();
}

function drawNightOverlay() {
  const h = new Date().getHours();
  if (h >= 21 || h < 6) {
    ctx.fillStyle = "rgba(58, 90, 138, 0.12)";
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
  }
}

function drawVignette() {
  const g = ctx.createRadialGradient(CANVAS_PX / 2, CANVAS_PX / 2, CANVAS_PX * 0.35, CANVAS_PX / 2, CANVAS_PX / 2, CANVAS_PX * 0.7);
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, "rgba(107, 61, 74, 0.22)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
}

function drawMascot() {
  const now = Date.now();
  if (mascot.mood !== "idle" && now > mascot.moodUntil) mascot.mood = "idle";
  if (now > mascot.nextBlinkAt) {
    mascot.blinkUntil = now + 140;
    mascot.nextBlinkAt = now + 2200 + Math.random() * 2400;
  }
  const blinking = now < mascot.blinkUntil;
  const bob = Math.sin(now / 600) * 1;
  const x = mascot.x;
  const y = mascot.y + bob;

  // shadow
  ctx.fillStyle = "rgba(107, 61, 74, 0.18)";
  ctx.fillRect(x - 8, y + 14, 18, 2);

  // body (white bunny)
  ctx.fillStyle = "#fff5f7";
  ctx.fillRect(x - 7, y, 14, 12);
  // belly tint
  ctx.fillStyle = "#ffe4ec";
  ctx.fillRect(x - 4, y + 6, 8, 5);

  // ears
  ctx.fillStyle = "#fff5f7";
  ctx.fillRect(x - 6, y - 8, 3, 9);
  ctx.fillRect(x + 3, y - 8, 3, 9);
  ctx.fillStyle = "#ffb8d1";
  ctx.fillRect(x - 5, y - 6, 1, 5);
  ctx.fillRect(x + 4, y - 6, 1, 5);

  // head outline accent
  ctx.fillStyle = "#f7d4dd";
  ctx.fillRect(x - 7, y, 14, 1);

  // cheeks
  ctx.fillStyle = "#ffb8d1";
  ctx.fillRect(x - 6, y + 5, 2, 2);
  ctx.fillRect(x + 4, y + 5, 2, 2);

  // eyes
  if (mascot.mood === "sleepy" || blinking) {
    ctx.fillStyle = "#6b3d4a";
    ctx.fillRect(x - 4, y + 4, 3, 1);
    ctx.fillRect(x + 1, y + 4, 3, 1);
  } else if (mascot.mood === "happy") {
    ctx.fillStyle = "#6b3d4a";
    // ^ ^ shape
    ctx.fillRect(x - 4, y + 4, 1, 1);
    ctx.fillRect(x - 3, y + 3, 1, 1);
    ctx.fillRect(x - 2, y + 4, 1, 1);
    ctx.fillRect(x + 1, y + 4, 1, 1);
    ctx.fillRect(x + 2, y + 3, 1, 1);
    ctx.fillRect(x + 3, y + 4, 1, 1);
  } else {
    ctx.fillStyle = "#6b3d4a";
    ctx.fillRect(x - 3, y + 3, 2, 2);
    ctx.fillRect(x + 1, y + 3, 2, 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 2, y + 3, 1, 1);
    ctx.fillRect(x + 2, y + 3, 1, 1);
  }

  // mouth
  ctx.fillStyle = "#6b3d4a";
  ctx.fillRect(x, y + 7, 1, 1);
  if (mascot.mood === "happy") {
    ctx.fillRect(x - 1, y + 8, 3, 1);
  }

  // sleepy z's
  if (mascot.mood === "sleepy") {
    ctx.fillStyle = "#a87985";
    const zy = y - 4 + Math.sin(now / 300) * 1;
    ctx.fillRect(x + 8, zy, 3, 1);
    ctx.fillRect(x + 10, zy + 1, 1, 1);
    ctx.fillRect(x + 9, zy + 2, 1, 1);
    ctx.fillRect(x + 8, zy + 3, 3, 1);
  }
}

function spawnSparkles(cx, cy, count, color) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.6 + Math.random() * 1.0;
    particles.push({
      kind: "sparkle",
      x: cx, y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 0.6,
      life: 0,
      max: 600 + Math.random() * 400,
      color: color || "#ffe28a",
    });
  }
}

function spawnHeart(cx, cy) {
  particles.push({
    kind: "heart",
    x: cx + (Math.random() - 0.5) * 6,
    y: cy,
    vx: (Math.random() - 0.5) * 0.4,
    vy: -0.6,
    life: 0,
    max: 900,
    color: "#ff8fb8",
  });
}

function drawParticles() {
  const now = Date.now();
  const dt = Math.min(50, now - lastFrameAt);
  lastFrameAt = now;
  const k = dt / 16.67; // normalize to ~60fps step
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (!p.bornAt) p.bornAt = now;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.vy += 0.04 * k;
    const t = (now - p.bornAt) / p.max;
    if (t >= 1) { particles.splice(i, 1); continue; }
    const alpha = 1 - t;
    if (p.kind === "sparkle") {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      const s = 2;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), s, s);
      ctx.fillRect(Math.floor(p.x) - 1, Math.floor(p.y) + 1, 1, 1);
      ctx.fillRect(Math.floor(p.x) + s, Math.floor(p.y) + 1, 1, 1);
      ctx.fillRect(Math.floor(p.x) + 1, Math.floor(p.y) - 1, 1, 1);
      ctx.fillRect(Math.floor(p.x) + 1, Math.floor(p.y) + s, 1, 1);
    } else if (p.kind === "heart") {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      ctx.fillRect(x - 2, y, 2, 1);
      ctx.fillRect(x + 1, y, 2, 1);
      ctx.fillRect(x - 2, y + 1, 5, 1);
      ctx.fillRect(x - 1, y + 2, 3, 1);
      ctx.fillRect(x, y + 3, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}


function drawAmbient() {
  if (state.weather && state.weather.type === "rain") return;
  const t = Date.now() / 1000;
  for (let i = ambient.length - 1; i >= 0; i--) {
    const a = ambient[i];
    let recycle = false;
    switch (a.kind) {
      case "bee":
      case "butterfly":
      case "firefly": {
        a.x += a.speed;
        if (a.x > CANVAS_PX + 10) recycle = true;
        const y = a.y + Math.sin(t * 2 + a.phase) * 4;
        if (a.kind === "bee") drawBee(a.x, y);
        else if (a.kind === "butterfly") drawButterfly(a.x, y, t);
        else drawFirefly(a.x, y, t);
        break;
      }
      case "ladybug": {
        a.x += a.speed;
        if (a.x > CANVAS_PX + 10) recycle = true;
        drawLadybug(a.x, a.y, t);
        break;
      }
      case "snail": {
        a.x += a.speed;
        if (a.x > CANVAS_PX + 10) recycle = true;
        drawSnail(a.x, a.y);
        break;
      }
      case "frog": {
        a.timer -= 16;
        if (a.timer <= 0) {
          a.vy = -2.4;
          a.speed = 1.2 * (Math.random() < 0.5 ? -1 : 1);
          a.timer = 1500 + Math.random() * 2500;
        }
        if (a.vy !== 0 || a.y < CANVAS_PX - 18) {
          a.x += a.speed;
          a.vy += 0.18;
          a.y += a.vy;
          if (a.y >= CANVAS_PX - 18) { a.y = CANVAS_PX - 18; a.vy = 0; a.speed = 0; }
        }
        if (a.x > CANVAS_PX + 12 || a.x < -12) recycle = true;
        drawFrog(a.x, a.y);
        break;
      }
      case "bird": {
        a.x += a.speed;
        if (a.x > CANVAS_PX + 14) recycle = true;
        drawBird(a.x, a.y, t);
        break;
      }
    }
    if (recycle) {
      ambient.splice(i, 1);
      ambient.push(spawnAmbient());
      // entering critter starts off-screen left
      const last = ambient[ambient.length - 1];
      last.x = -10;
    }
  }
}

function drawClouds() {
  while (clouds.length < CLOUD_COUNT) clouds.push(spawnCloud());
  for (const c of clouds) {
    c.x += c.speed;
    if (c.x > CANVAS_PX + c.w) {
      c.x = -c.w;
      c.y = 6 + Math.random() * 30;
      c.w = 28 + Math.random() * 24;
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    const x = Math.floor(c.x), y = Math.floor(c.y), w = c.w;
    ctx.fillRect(x, y + 4, w, 6);
    ctx.fillRect(x + 4, y + 1, w - 8, 4);
    ctx.fillRect(x + 8, y - 1, w - 16, 3);
    // soft underside
    ctx.fillStyle = "rgba(255, 200, 220, 0.35)";
    ctx.fillRect(x, y + 8, w, 2);
  }
}

function drawSun() {
  const h = new Date().getHours();
  const isNight = h >= 21 || h < 6;
  if (isNight) {
    // moon
    ctx.fillStyle = "#fff5dd";
    drawCircle(CANVAS_PX - 30, 28, 9);
    ctx.fillStyle = "rgba(217, 194, 255, 0.6)";
    drawCircle(CANVAS_PX - 26, 26, 4);
    // stars
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    const t = Date.now() / 800;
    for (let i = 0; i < 8; i++) {
      const sx = (i * 31 + 13) % CANVAS_PX;
      const sy = (i * 17 + 7) % 50;
      if ((Math.sin(t + i) + 1) > 1.2) ctx.fillRect(sx, sy, 1, 1);
    }
    return;
  }
  // sun w/ soft glow
  const cx = CANVAS_PX - 28, cy = 28;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  glow.addColorStop(0, "rgba(255, 226, 138, 0.9)");
  glow.addColorStop(0.5, "rgba(255, 184, 209, 0.25)");
  glow.addColorStop(1, "rgba(255, 184, 209, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 26, cy - 26, 52, 52);
  ctx.fillStyle = "#ffe28a";
  drawCircle(cx, cy, 8);
  ctx.fillStyle = "#fff5dd";
  drawCircle(cx - 2, cy - 2, 3);
}

function drawCircle(cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawLadybug(x, y, t) {
  const wob = Math.sin(t * 6 + x) * 0.6;
  // shadow
  ctx.fillStyle = "rgba(107, 61, 74, 0.18)";
  ctx.fillRect(x - 4, y + 5, 9, 1);
  // body
  ctx.fillStyle = "#d94c5e";
  ctx.fillRect(x - 4, y - 1 + wob, 9, 6);
  ctx.fillRect(x - 3, y - 2 + wob, 7, 1);
  ctx.fillRect(x - 3, y + 5 + wob, 7, 1);
  // head
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(x - 5, y + 1 + wob, 2, 3);
  // line down center
  ctx.fillRect(x, y - 1 + wob, 1, 6);
  // spots
  ctx.fillRect(x - 2, y + 1 + wob, 1, 1);
  ctx.fillRect(x + 2, y + 1 + wob, 1, 1);
  ctx.fillRect(x - 2, y + 3 + wob, 1, 1);
  ctx.fillRect(x + 2, y + 3 + wob, 1, 1);
}

function drawSnail(x, y) {
  // shadow
  ctx.fillStyle = "rgba(107, 61, 74, 0.18)";
  ctx.fillRect(x - 5, y + 6, 11, 1);
  // body
  ctx.fillStyle = "#ffd0dd";
  ctx.fillRect(x - 5, y + 2, 10, 4);
  ctx.fillRect(x + 4, y + 1, 3, 4);
  // antennae
  ctx.fillStyle = "#6b3d4a";
  ctx.fillRect(x + 5, y - 2, 1, 3);
  ctx.fillRect(x + 7, y - 2, 1, 3);
  // shell
  ctx.fillStyle = "#ff8fb8";
  ctx.fillRect(x - 4, y - 3, 8, 6);
  ctx.fillStyle = "#d68aa3";
  ctx.fillRect(x - 3, y - 2, 6, 1);
  ctx.fillRect(x - 2, y - 1, 4, 1);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 2, y - 2, 1, 1);
}

function drawFrog(x, y) {
  // shadow
  ctx.fillStyle = "rgba(107, 61, 74, 0.18)";
  ctx.fillRect(x - 5, y + 7, 11, 1);
  // body
  ctx.fillStyle = "#8fcb7a";
  ctx.fillRect(x - 5, y + 1, 11, 6);
  ctx.fillRect(x - 4, y, 9, 1);
  // belly
  ctx.fillStyle = "#cdf0b9";
  ctx.fillRect(x - 3, y + 5, 7, 2);
  // eyes (whites)
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 4, y - 2, 3, 3);
  ctx.fillRect(x + 2, y - 2, 3, 3);
  // pupils
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(x - 3, y - 1, 1, 1);
  ctx.fillRect(x + 3, y - 1, 1, 1);
  // smile
  ctx.fillRect(x - 1, y + 4, 3, 1);
}

function drawBird(x, y, t) {
  const flap = Math.sin(t * 14) > 0;
  ctx.fillStyle = "#7da7e8";
  ctx.fillRect(x, y, 3, 2);
  ctx.fillStyle = "#5a8ad0";
  if (flap) {
    ctx.fillRect(x - 4, y - 2, 4, 2);
    ctx.fillRect(x + 3, y - 2, 4, 2);
  } else {
    ctx.fillRect(x - 3, y + 1, 3, 2);
    ctx.fillRect(x + 3, y + 1, 3, 2);
  }
  // beak
  ctx.fillStyle = "#ffe28a";
  ctx.fillRect(x + 3, y, 1, 1);
  // eye
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(x + 2, y, 1, 1);
}

function drawFirefly(x, y, t) {
  const pulse = (Math.sin(t * 3 + x) + 1) / 2;
  // glow halo
  const r = 6 + pulse * 4;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(255, 244, 180, " + (0.7 * pulse + 0.2) + ")");
  g.addColorStop(1, "rgba(255, 244, 180, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // body
  ctx.fillStyle = "#fff5b8";
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

function drawBee(x, y) {
  ctx.fillStyle = "#f4d35e";
  ctx.fillRect(x - 3, y, 6, 3);
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(x - 2, y, 1, 3);
  ctx.fillRect(x, y, 1, 3);
  ctx.fillRect(x + 2, y, 1, 3);
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(x - 1, y - 2, 3, 1);
}

function drawButterfly(x, y, t) {
  const flap = Math.sin(t * 8) > 0;
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(x, y, 1, 3);
  ctx.fillStyle = "#e8a4c9";
  if (flap) {
    ctx.fillRect(x - 4, y - 1, 4, 3);
    ctx.fillRect(x + 1, y - 1, 4, 3);
  } else {
    ctx.fillRect(x - 3, y, 3, 2);
    ctx.fillRect(x + 1, y, 3, 2);
  }
}

function drawWeather() {
  if (!state.weather || state.weather.type !== "rain") return;
  ctx.fillStyle = "rgba(125, 167, 232, 0.7)";
  for (const d of rainDrops) {
    d.y += d.v;
    d.x += 1;
    if (d.y > CANVAS_PX) { d.y = -4; d.x = Math.random() * CANVAS_PX; }
    if (d.x > CANVAS_PX) d.x = 0;
    ctx.fillRect(Math.floor(d.x), Math.floor(d.y), 1, 3);
  }
}

function drawPlot(x, y, size, plot, idx) {
  const inset = 2;
  const ix = x + inset;
  const iy = y + inset;
  const iw = size - inset * 2;
  const ih = size - inset * 2;

  ctx.fillStyle = plot.soil === SOIL_RICH ? "#8d5a3a" : "#c89878";
  ctx.fillRect(ix, iy, iw, ih);

  ctx.fillStyle = plot.soil === SOIL_RICH ? "#5e3b1e" : "#9a6e4f";
  const rows = 4;
  const stepY = (ih - 6) / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillRect(ix + 3, iy + 4 + Math.floor(r * stepY), iw - 6, 2);
  }

  if (plot.soil === SOIL_RICH) {
    ctx.fillStyle = "#3a5a40";
    ctx.fillRect(ix + 5, iy + Math.floor(ih * 0.25), 2, 2);
    ctx.fillRect(ix + iw - 8, iy + Math.floor(ih * 0.55), 2, 2);
    ctx.fillRect(ix + Math.floor(iw * 0.5), iy + ih - 10, 2, 2);
  }

  ctx.strokeStyle = "#6b3d4a";
  ctx.lineWidth = 2;
  ctx.strokeRect(ix, iy, iw, ih);

  if (plot.stage !== STAGE.EMPTY) drawPlant(x, y, size, plot);
  if (plot.weed) drawWeed(x, y, size);
  if (plot.stage !== STAGE.EMPTY) drawWaterBar(x, y, size, plot.water);

  if (idx === hoverIdx) {
    let color = "#f4d35e";
    if (state.tool === TOOL_WATER) color = "#7da7e8";
    else if (state.tool === TOOL_COMPOST) color = "#5a8c4a";
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(ix - 1, iy - 1, iw + 2, ih + 2);
  }
}

function drawPlant(x, y, size, plot) {
  const seed = SEEDS[plot.seed];
  if (!seed) return;
  const s = size / 80;
  const cx = x + size / 2;
  const cy = y + size / 2 + size * 0.08;

  switch (plot.stage) {
    case STAGE.SEED:
      ctx.fillStyle = "#3a2e2a";
      ctx.fillRect(cx - 3 * s, cy + 12 * s, 6 * s, 4 * s);
      break;
    case STAGE.SPROUT:
      ctx.fillStyle = "#5a8c4a";
      ctx.fillRect(cx - 1 * s, cy + 4 * s, 2 * s, 12 * s);
      ctx.fillRect(cx - 5 * s, cy + 6 * s, 4 * s, 2 * s);
      ctx.fillRect(cx + 1 * s, cy + 8 * s, 4 * s, 2 * s);
      break;
    case STAGE.BUD:
      ctx.fillStyle = "#3a5a40";
      ctx.fillRect(cx - 1 * s, cy - 4 * s, 2 * s, 20 * s);
      ctx.fillStyle = seed.center;
      ctx.fillRect(cx - 3 * s, cy - 8 * s, 6 * s, 6 * s);
      break;
    case STAGE.BLOOM: {
      // sway
      const sway = Math.sin(Date.now() / 700 + (cx + cy)) * 1;
      // soft halo glow
      const haloR = 18 * s;
      const halo = ctx.createRadialGradient(cx + sway, cy - 9 * s, 2, cx + sway, cy - 9 * s, haloR);
      halo.addColorStop(0, hexToRgba(seed.petal, 0.45));
      halo.addColorStop(1, hexToRgba(seed.petal, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(cx - haloR + sway, cy - 9 * s - haloR, haloR * 2, haloR * 2);
      ctx.fillStyle = "#3a5a40";
      ctx.fillRect(cx - 1 * s, cy - 4 * s, 2 * s, 20 * s);
      // petals
      ctx.fillStyle = seed.petal;
      ctx.fillRect(cx - 8 * s + sway, cy - 12 * s, 6 * s, 6 * s);
      ctx.fillRect(cx + 2 * s + sway, cy - 12 * s, 6 * s, 6 * s);
      ctx.fillRect(cx - 8 * s + sway, cy - 4 * s, 6 * s, 6 * s);
      ctx.fillRect(cx + 2 * s + sway, cy - 4 * s, 6 * s, 6 * s);
      // petal highlights
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.fillRect(cx - 7 * s + sway, cy - 11 * s, 2 * s, 2 * s);
      ctx.fillRect(cx + 3 * s + sway, cy - 11 * s, 2 * s, 2 * s);
      // center face
      ctx.fillStyle = seed.center;
      ctx.fillRect(cx - 4 * s + sway, cy - 8 * s, 8 * s, 8 * s);
      // eyes on bloom (cute face!)
      ctx.fillStyle = "#3a2418";
      ctx.fillRect(cx - 3 * s + sway, cy - 6 * s, 1.5 * s, 1.5 * s);
      ctx.fillRect(cx + 1.5 * s + sway, cy - 6 * s, 1.5 * s, 1.5 * s);
      // smile
      ctx.fillRect(cx - 1 * s + sway, cy - 3 * s, 2 * s, 1 * s);
      // blush
      ctx.fillStyle = "rgba(255, 143, 184, 0.6)";
      ctx.fillRect(cx - 4 * s + sway, cy - 4 * s, 1 * s, 1 * s);
      ctx.fillRect(cx + 3 * s + sway, cy - 4 * s, 1 * s, 1 * s);
      // sparkle
      const t = Date.now() / 500;
      if ((t | 0) % 2 === 0) {
        ctx.fillStyle = "#ffffffcc";
        ctx.fillRect(cx + 6 * s, cy - 14 * s, 2 * s, 2 * s);
      }
      break;
    }
  }
}

function drawWeed(x, y, size) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const t = Date.now() / 300;
  const wob = Math.sin(t) * 0.8;
  // dark scraggly weed w/ thorns
  ctx.fillStyle = "#5a4a2a";
  ctx.fillRect(cx - 1 + wob, cy - 8, 2, 14);
  ctx.fillStyle = "#7a6a3a";
  // jagged leaves
  ctx.fillRect(cx - 5 + wob, cy - 4, 4, 2);
  ctx.fillRect(cx + 1 + wob, cy - 6, 4, 2);
  ctx.fillRect(cx - 6 + wob, cy + 1, 5, 2);
  ctx.fillRect(cx + 1 + wob, cy + 2, 5, 2);
  // thorns
  ctx.fillStyle = "#3a2418";
  ctx.fillRect(cx - 3 + wob, cy - 5, 1, 1);
  ctx.fillRect(cx + 2 + wob, cy - 7, 1, 1);
  // angry red dot top
  ctx.fillStyle = "#d94c5e";
  ctx.fillRect(cx - 1 + wob, cy - 10, 2, 2);
}

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "rgba(255, 255, 255, " + a + ")";
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function drawWaterBar(x, y, size, water) {
  const max = 10;
  const ratio = Math.max(0, Math.min(1, water / max));
  const barW = size - 14;
  const barH = 4;
  const bx = x + 7;
  const by = y + size - 9;
  ctx.fillStyle = "#2a1a10";
  ctx.fillRect(bx, by, barW, barH);
  if (ratio > 0) {
    ctx.fillStyle = ratio < 0.3 ? "#c9605a" : "#7da7e8";
    ctx.fillRect(bx + 1, by + 1, Math.max(1, Math.floor((barW - 2) * ratio)), barH - 2);
  }
}

// ---------- UI ----------

function refreshAll() {
  render();
  renderTopbar();
  renderSeedPicker();
  renderToolBar();
  renderShop();
  renderQuests();
  renderBunnyPanel();
  renderCustomer();
  persist();
}

function renderTopbar() {
  document.getElementById("coins").textContent = String(Math.floor(state.coins));
  let totalSeeds = 0;
  for (const k of Object.keys(state.inventory)) {
    if (k.startsWith("flower:") || k === "compost") continue;
    totalSeeds += state.inventory[k] || 0;
  }
  document.getElementById("seedCount").textContent = String(totalSeeds);

  const lv = currentLevel();
  const lvEl = document.getElementById("levelStat");
  if (lv < LEVELS.length) {
    const need = LEVELS[lv].threshold - state.totalHarvests;
    lvEl.textContent = "Lv" + lv + " (" + Math.max(0, need) + ")";
    lvEl.title = "Garden level " + lv + ". " + Math.max(0, need) + " more harvests to level up.";
  } else {
    lvEl.textContent = "Lv" + lv + " MAX";
    lvEl.title = "Max level reached.";
  }
  // combo indicator
  const comboEl = document.getElementById("comboStat");
  if (comboEl) {
    if (state.combo.count > 1 && Date.now() < state.combo.until) {
      comboEl.style.display = "";
      comboEl.textContent = "×" + state.combo.count;
    } else {
      comboEl.style.display = "none";
    }
  }
}

function renderQuests() {
  ensureQuestsFresh();
  const root = document.getElementById("questList");
  if (!root) return;
  root.innerHTML = "";
  state.quests.items.forEach((q, i) => {
    const li = document.createElement("li");
    const ready = !q.claimed && q.progress >= q.target;
    if (q.claimed) li.classList.add("quest-claimed");
    if (ready) li.classList.add("quest-ready");
    const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
    li.innerHTML =
      '<div class="meta">' +
        '<span class="name">' + esc(q.text) + "</span>" +
        '<span class="quest-prog">' + q.progress + " / " + q.target + " ♡ +" + q.reward + "c</span>" +
        '<div class="quest-bar"><div class="quest-bar-fill" style="width:' + pct + '%"></div></div>' +
      "</div>";
    const btn = document.createElement("button");
    btn.className = "btn-buy";
    btn.textContent = q.claimed ? "DONE" : ready ? "CLAIM" : "...";
    btn.disabled = q.claimed || !ready;
    btn.addEventListener("click", () => claimQuest(i));
    li.appendChild(btn);
    root.appendChild(li);
  });
}

function renderBunnyPanel() {
  const root = document.getElementById("bunnyPanel");
  if (!root) return;
  const b = state.bunny;
  const pct = Math.round((b.happy / 10) * 100);
  const mood = b.happy >= 8 ? "Blissful ♡♡" : b.happy >= 5 ? "Happy ♡" : b.happy >= 2 ? "Sleepy" : "Sad...";
  root.innerHTML = "";
  const face = document.createElement("div");
  face.className = "bunny-face";
  root.appendChild(face);
  const meta = document.createElement("div");
  meta.className = "bunny-meta";
  meta.innerHTML =
    '<div class="name">Mochi · ' + esc(mood) + "</div>" +
    '<div>Growth boost: +' + Math.round((bunnyGrowthMult() - 1) * 100) + "%</div>" +
    '<div class="happy-bar"><div class="happy-bar-fill" style="width:' + pct + '%"></div></div>';
  // feed buttons for each owned flower
  const feedRow = document.createElement("div");
  feedRow.className = "bunny-feed-row";
  for (const seedId of Object.keys(SEEDS)) {
    const key = "flower:" + seedId;
    const have = state.inventory[key] || 0;
    if (have <= 0) continue;
    const btn = document.createElement("button");
    btn.className = "bunny-feed-btn";
    btn.textContent = "Feed " + SEEDS[seedId].name + " (" + have + ")";
    btn.addEventListener("click", () => feedBunny(key));
    feedRow.appendChild(btn);
  }
  if (!feedRow.children.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "Harvest flowers to feed Mochi.";
    feedRow.appendChild(empty);
  }
  meta.appendChild(feedRow);
  root.appendChild(meta);
  // pet button
  const pet = document.createElement("button");
  pet.className = "btn-buy";
  pet.textContent = "PET ♡";
  pet.addEventListener("click", petBunny);
  root.appendChild(pet);
}

function renderSeedPicker() {
  const root = document.getElementById("seedPicker");
  if (!root) return;
  root.innerHTML = "";
  for (const [id, seed] of Object.entries(SEEDS)) {
    const have = state.inventory[id] || 0;
    const tile = document.createElement("button");
    tile.className =
      "seed-tile" +
      (state.selectedSeed === id ? " selected" : "") +
      (have === 0 ? " empty" : "");
    tile.dataset.seed = id;
    tile.title =
      seed.name +
      " - " +
      Math.round(seed.growMs / 1000) +
      "s grow, sells " +
      seed.reward +
      "c, needs " +
      seed.soil +
      " soil.";
    const flower = document.createElement("span");
    flower.className = "seed-flower";
    flower.style.setProperty("--c", seed.petal);
    flower.style.setProperty("--c2", seed.center);

    const name = document.createElement("span");
    name.className = "seed-name";
    name.textContent = seed.name.slice(0, 4).toUpperCase();

    const count = document.createElement("span");
    count.className = "seed-count";
    count.textContent = String(have);

    tile.appendChild(flower);
    tile.appendChild(name);
    tile.appendChild(count);

    if (seed.soil === SOIL_RICH) {
      const tag = document.createElement("span");
      tag.className = "seed-soil-tag";
      tag.textContent = "RICH";
      tile.appendChild(tag);
    }

    tile.addEventListener("click", () => {
      state.selectedSeed = id;
      state.tool = TOOL_PLANT;
      const need = seed.soil === SOIL_RICH ? " (needs RICH soil)" : "";
      setHint("Planting: " + seed.name + need + ". Click an empty plot.");
      refreshAll();
    });

    root.appendChild(tile);
  }
}

function renderToolBar() {
  for (const btn of document.querySelectorAll(".tool")) {
    btn.classList.toggle("selected", btn.dataset.tool === state.tool);
  }
}

function renderShop() {
  const list = document.getElementById("shopList");
  if (!list) return;
  list.innerHTML = "";

  for (const [id, seed] of Object.entries(SEEDS)) {
    const li = document.createElement("li");
    const have = state.inventory[id] || 0;
    li.innerHTML =
      '<div class="meta">' +
        '<span class="name">' + esc(seed.name) + " seed</span>" +
        '<span class="desc">' +
          Math.round(seed.growMs / 1000) + "s grow / " +
          seed.reward + "c sell / " +
          seed.soil + " soil / own " + have +
        "</span>" +
      "</div>";
    const buy = document.createElement("button");
    buy.className = "btn-buy";
    buy.textContent = seed.cost + "c";
    buy.disabled = state.coins < seed.cost;
    buy.addEventListener("click", () => buySeed(id));
    li.appendChild(buy);
    list.appendChild(li);
  }

  const li = document.createElement("li");
  const haveCompost = state.inventory.compost || 0;
  li.innerHTML =
    '<div class="meta">' +
      '<span class="name">Compost</span>' +
      '<span class="desc">Upgrades a plot to RICH soil / own ' + haveCompost + "</span>" +
    "</div>";
  const buy = document.createElement("button");
  buy.className = "btn-buy";
  buy.textContent = COMPOST_COST + "c";
  buy.disabled = state.coins < COMPOST_COST;
  buy.addEventListener("click", buyCompost);
  li.appendChild(buy);
  list.appendChild(li);
}

function buySeed(id) {
  const seed = SEEDS[id];
  if (!seed || state.coins < seed.cost) return;
  state.coins -= seed.cost;
  state.inventory[id] = (state.inventory[id] || 0) + 1;
  voice({ freq: 880, dur: 0.06, type: "sine", volume: 0.04, release: 0.1 });
  voice({ freq: 1046, dur: 0.06, type: "triangle", volume: 0.025, release: 0.12, when: 0.04 });
  toast("+1 " + seed.name);
  refreshAll();
}

function buyCompost() {
  if (state.coins < COMPOST_COST) return;
  state.coins -= COMPOST_COST;
  state.inventory.compost = (state.inventory.compost || 0) + 1;
  voice({ freq: 392, dur: 0.08, type: "triangle", volume: 0.04, release: 0.18 });
  toast("+1 Compost");
  refreshAll();
}

function renderCustomer() {
  const el = document.getElementById("customer");
  if (!el) return;
  if (!state.customer) {
    el.textContent = "No one yet. Harvest flowers to attract a visitor.";
    return;
  }
  const c = state.customer;
  const seed = SEEDS[c.want];
  const have = state.inventory["flower:" + c.want] || 0;
  const remain = Math.max(0, Math.floor((c.expiresAt - Date.now()) / 1000));
  const name = c.name || "Visitor";
  const greeting = c.greeting || ("Wants " + c.qty + " " + seed.name);
  el.innerHTML =
    '<div class="cust-name">' + esc(name) + '</div>' +
    '<div class="cust-line">"' + esc(greeting) + '"</div>' +
    "<div>Pays <b>" + c.bonus + "c</b> for " + c.qty + " " + esc(seed.name) + ".</div>" +
    '<div class="muted">Have ' + have + ". Leaves in " + remain + "s.</div>";
  const btn = document.createElement("button");
  btn.className = "accept";
  btn.textContent = have >= c.qty ? "SELL" : "NEED " + (c.qty - have);
  btn.disabled = have < c.qty;
  btn.addEventListener("click", fulfillCustomer);
  el.appendChild(btn);
}

function fulfillCustomer() {
  const c = state.customer;
  if (!c) return;
  const key = "flower:" + c.want;
  const have = state.inventory[key] || 0;
  if (have < c.qty) return;
  state.inventory[key] = have - c.qty;
  state.coins += c.bonus;
  bumpStat("sold", 1);
  state.customer = null;
  state.customerCooldown = 90_000 + Math.random() * 60_000;
  arpeggio([659.25, 783.99, 987.77, 1318.5], 0.06, "sine");
  toast("+" + c.bonus + "c ♡");
  refreshAll();
}

function setHint(t) {
  const el = document.getElementById("hint");
  if (el) el.textContent = t;
}

function toast(t) {
  const e = document.createElement("div");
  e.className = "toast";
  e.textContent = t;
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 1100);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- View switcher ----------

function switchView(name) {
  for (const v of document.querySelectorAll(".view")) v.classList.remove("active");
  const target = document.getElementById("view-" + name);
  if (target) target.classList.add("active");
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.view === name);
  }
  if (name === "shop") {
    renderShop();
    renderCustomer();
  }
}

// ---------- Audio ----------

let masterGain = null;
let padNodes = null;

function ensureAudio() {
  if (audio) return audio;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
    masterGain = audio.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(audio.destination);
  } catch {
    audio = null;
  }
  return audio;
}

// gentle bell-like voice with ADSR + slight detune for fatter tone
function voice({ freq = 440, dur = 0.18, type = "sine", attack = 0.008, release = 0.18, volume = 0.06, detune = 0, when = 0 }) {
  const ac = ensureAudio();
  if (!ac || !masterGain) return;
  try {
    const t0 = ac.currentTime + when;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.value = 0;
    osc.connect(gain).connect(masterGain);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
    osc.start(t0);
    osc.stop(t0 + dur + release + 0.05);
  } catch {
    // ignore audio errors
  }
}

function beep(freq, dur) {
  if (!settings.sound) return;
  voice({ freq, dur: dur * 0.6, type: "sine", volume: 0.05, release: dur });
  voice({ freq: freq * 2, dur: dur * 0.4, type: "triangle", volume: 0.02, release: dur * 0.8 });
}

function chord(freqs, dur = 0.35, type = "sine") {
  if (!settings.sound) return;
  for (const f of freqs) voice({ freq: f, dur: dur * 0.5, type, volume: 0.04, release: dur });
}

function arpeggio(freqs, step = 0.06, type = "triangle") {
  if (!settings.sound) return;
  freqs.forEach((f, i) => {
    voice({ freq: f, dur: 0.08, type, volume: 0.045, release: 0.18, when: i * step });
    voice({ freq: f * 2, dur: 0.06, type: "sine", volume: 0.018, release: 0.14, when: i * step });
  });
}

function startAmbientPad() {
  if (!settings.sound) return;
  const ac = ensureAudio();
  if (!ac || !masterGain || padNodes) return;
  try {
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(masterGain);

    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    filter.Q.value = 1.2;
    filter.connect(out);

    const o1 = ac.createOscillator();
    o1.type = "sine"; o1.frequency.value = 220;
    const o2 = ac.createOscillator();
    o2.type = "sine"; o2.frequency.value = 277.18; // C#
    o2.detune.value = -4;
    const o3 = ac.createOscillator();
    o3.type = "triangle"; o3.frequency.value = 110;
    o1.connect(filter); o2.connect(filter); o3.connect(filter);

    // slow LFO on filter cutoff
    const lfo = ac.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 0.08;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);

    const now = ac.currentTime;
    o1.start(now); o2.start(now); o3.start(now); lfo.start(now);
    out.gain.linearRampToValueAtTime(0.025, now + 2.5);
    padNodes = { out, filter, oscs: [o1, o2, o3], lfo, lfoGain };
  } catch {
    padNodes = null;
  }
}

function stopAmbientPad() {
  if (!padNodes) return;
  const ac = audio;
  try {
    const now = ac.currentTime;
    padNodes.out.gain.cancelScheduledValues(now);
    padNodes.out.gain.linearRampToValueAtTime(0, now + 0.4);
    const nodes = padNodes;
    setTimeout(() => {
      try {
        nodes.oscs.forEach((o) => o.stop());
        nodes.lfo.stop();
      } catch {}
    }, 500);
  } catch {}
  padNodes = null;
}

// short noise burst (rain, drip)
function noiseBurst({ dur = 0.08, volume = 0.03, type = "highpass", freq = 1800 }) {
  if (!settings.sound) return;
  const ac = ensureAudio();
  if (!ac || !masterGain) return;
  try {
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(masterGain);
    src.start();
  } catch {}
}

// ---------- Settings ----------

function bindSettings() {
  const sound = document.getElementById("optSound");
  const anchor = document.getElementById("optAnchor");
  const size = document.getElementById("optSize");

  sound.checked = settings.sound;
  anchor.value = settings.anchor;
  size.value = settings.size;

  sound.addEventListener("change", () => {
    settings.sound = sound.checked;
    if (!settings.sound) stopAmbientPad();
    else if (audio) startAmbientPad();
    persist();
  });
  anchor.addEventListener("change", () => {
    settings.anchor = anchor.value;
    persist();
  });
  size.addEventListener("change", () => {
    settings.size = size.value;
    applyWindowSize();
    persist();
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    if (!confirm("Reset all garden progress?")) return;
    state = defaultSave();
    lastLevel = currentLevel();
    persist();
    refreshAll();
    setHint("Garden reset.");
  });
}

function applyWindowSize() {
  const sizes = {
    small: [300, 440],
    medium: [340, 480],
    large: [380, 520],
  };
  const [w, h] = sizes[settings.size] || sizes.medium;
  invoke("set_window_size", { width: w, height: h }).catch(() => {});
}

// ---------- Animation ----------

function hideWithAnimation() {
  const shell = document.getElementById("app");
  if (!shell) {
    invoke("hide_window").catch(() => {});
    return;
  }
  shell.classList.remove("entering");
  shell.classList.add("closing");
  setTimeout(() => {
    shell.classList.remove("closing");
    invoke("hide_window").catch(() => {});
  }, ANIM_MS);
}

function replayEnterAnimation() {
  const shell = document.getElementById("app");
  if (!shell) return;
  shell.classList.remove("closing");
  shell.classList.remove("entering");
  void shell.offsetWidth;
  shell.classList.add("entering");
}

// ---------- Boot ----------

function bind() {
  setupCanvas();

  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => switchView(t.dataset.view));
  }

  for (const b of document.querySelectorAll(".tool")) {
    b.addEventListener("click", () => {
      state.tool = b.dataset.tool;
      const labels = {
        plant: "Plant mode. Click a plot to plant the selected seed.",
        water: "Water mode. Hover over plots to water them.",
        compost: "Compost mode. Click an empty plot to enrich soil to RICH.",
      };
      setHint(labels[state.tool] || "");
      refreshAll();
    });
  }

  document.getElementById("btnHide").addEventListener("click", hideWithAnimation);

  bindSettings();
  switchView("garden");
  refreshAll();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopTicks();
      stopAmbientPad();
    } else {
      replayEnterAnimation();
      startTicks();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideWithAnimation();
    else if (e.key === "1") setTool(TOOL_PLANT);
    else if (e.key === "2") setTool(TOOL_WATER);
    else if (e.key === "3") setTool(TOOL_COMPOST);
  });

  Promise.resolve(listen("menu:about", () => switchView("settings"))).catch(() => {});

  startTicks();
  applyWindowSize();
}

function setTool(t) {
  state.tool = t;
  refreshAll();
}

window.addEventListener("error", (e) => console.error("garden error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("garden rejection", e.reason));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
