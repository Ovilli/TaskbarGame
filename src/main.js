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

const DEFAULT_SETTINGS = { sound: true, notify: false, anchor: "tray", size: "medium" };

function emptyPlot() {
  return { stage: STAGE.EMPTY, seed: null, plantedAt: 0, water: 0, soil: SOIL_STANDARD };
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
  };
}

const RAIN_DROPS = 14;
const AMBIENT_COUNT = 2;
const ambient = []; // transient, not persisted
const rainDrops = [];

let state = sanitize(load(SAVE_KEY, defaultSave()));
let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };
let canvas = null;
let ctx = null;
let hoverIdx = -1;
let tickHandle = null;
let audio = null;
let lastLevel = currentLevel();

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
    out.plots = out.plots.map((p) => ({ ...emptyPlot(), ...(p || {}) }));
  }
  if (!out.inventory || typeof out.inventory !== "object") out.inventory = base.inventory;
  if (!SEEDS[out.selectedSeed]) out.selectedSeed = "daisy";
  if (![TOOL_PLANT, TOOL_WATER, TOOL_COMPOST].includes(out.tool)) out.tool = TOOL_PLANT;
  if (typeof out.coins !== "number" || !Number.isFinite(out.coins)) out.coins = 0;
  if (typeof out.totalHarvests !== "number") out.totalHarvests = 0;
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
    const elapsed = now - p.plantedAt;
    const ratio = Math.min(1, elapsed / seed.growMs);
    if (ratio >= 1) p.stage = STAGE.BLOOM;
    else if (ratio >= 0.66) p.stage = STAGE.BUD;
    else if (ratio >= 0.33) p.stage = STAGE.SPROUT;
    else p.stage = STAGE.SEED;
  }

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
  persist();
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
  const isBee = Math.random() < 0.6;
  return {
    kind: isBee ? "bee" : "butterfly",
    x: Math.random() * CANVAS_PX,
    y: 20 + Math.random() * (CANVAS_PX - 40),
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.4,
  };
}

function startTicks() {
  if (tickHandle == null) tickHandle = setInterval(tick, TICK_MS);
}

function stopTicks() {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

// ---------- Customers ----------

function spawnCustomer() {
  const seedIds = Object.keys(SEEDS);
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
  const idx = pointToIdx(e.clientX, e.clientY);
  if (idx < 0 || !isUnlocked(idx)) return;
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
    water: 6,
  });
  beep(660, 0.05);
  setHint("Planted " + seed.name + ".");
  refreshAll();
}

function tryWater(idx, silent) {
  const p = state.plots[idx];
  if (!p || p.stage === STAGE.EMPTY) {
    if (!silent) setHint("Nothing to water here.");
    return;
  }
  if (p.water >= 9.5) return;
  p.water = 10;
  if (!silent) {
    beep(440, 0.04);
    setHint("Watered.");
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
  beep(330, 0.06);
  setHint("Soil enriched. RICH seeds OK now.");
  refreshAll();
}

function harvest(idx) {
  const p = state.plots[idx];
  const seed = SEEDS[p.seed];
  if (!seed) return;
  state.coins += seed.reward;
  state.totalHarvests += 1;
  const flowerType = p.seed;
  const keepSoil = p.soil;
  Object.assign(p, emptyPlot());
  p.soil = keepSoil;
  state.inventory["flower:" + flowerType] = (state.inventory["flower:" + flowerType] || 0) + 1;
  beep(880, 0.08);
  toast("+" + seed.reward + "c");
  setHint("Harvested " + seed.name + ".");
  checkLevelUp();
  refreshAll();
}

function checkLevelUp() {
  const lv = currentLevel();
  if (lv > lastLevel) {
    lastLevel = lv;
    toast("LEVEL " + lv + " - new plots!");
    beep(660, 0.08);
    beep(880, 0.08);
    beep(990, 0.1);
  }
}

// ---------- Render canvas ----------

function render() {
  if (!ctx) return;
  ctx.fillStyle = "#c2a679";
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  // grass border dots
  ctx.fillStyle = "#7fb069";
  for (let x = 0; x < CANVAS_PX; x += 8) {
    ctx.fillRect(x, 0, 4, 2);
    ctx.fillRect(x + 2, CANVAS_PX - 2, 4, 2);
  }
  for (let y = 0; y < CANVAS_PX; y += 8) {
    ctx.fillRect(0, y + 2, 2, 4);
    ctx.fillRect(CANVAS_PX - 2, y, 2, 4);
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
  drawDayNightTint();
}

function drawDayNightTint() {
  const h = new Date().getHours();
  let color = null;
  if (h >= 6 && h < 9) color = "rgba(244, 211, 94, 0.10)";
  else if (h >= 18 && h < 21) color = "rgba(232, 132, 80, 0.14)";
  else if (h >= 21 || h < 6) color = "rgba(58, 90, 138, 0.22)";
  if (!color) return;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
}

function drawAmbient() {
  if (state.weather && state.weather.type === "rain") return;
  const t = Date.now() / 1000;
  for (const a of ambient) {
    a.x += a.speed;
    if (a.x > CANVAS_PX + 8) {
      a.x = -8;
      a.y = 20 + Math.random() * (CANVAS_PX - 40);
    }
    const y = a.y + Math.sin(t * 2 + a.phase) * 4;
    if (a.kind === "bee") drawBee(a.x, y);
    else drawButterfly(a.x, y, t);
  }
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

  ctx.fillStyle = plot.soil === SOIL_RICH ? "#5e3b1e" : "#a07546";
  ctx.fillRect(ix, iy, iw, ih);

  ctx.fillStyle = plot.soil === SOIL_RICH ? "#3d2410" : "#7e5631";
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

  ctx.strokeStyle = "#3a2418";
  ctx.lineWidth = 2;
  ctx.strokeRect(ix, iy, iw, ih);

  if (plot.stage !== STAGE.EMPTY) drawPlant(x, y, size, plot);
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
      ctx.fillStyle = "#3a5a40";
      ctx.fillRect(cx - 1 * s, cy - 4 * s, 2 * s, 20 * s);
      ctx.fillStyle = seed.petal;
      ctx.fillRect(cx - 8 * s, cy - 12 * s, 6 * s, 6 * s);
      ctx.fillRect(cx + 2 * s, cy - 12 * s, 6 * s, 6 * s);
      ctx.fillRect(cx - 8 * s, cy - 4 * s, 6 * s, 6 * s);
      ctx.fillRect(cx + 2 * s, cy - 4 * s, 6 * s, 6 * s);
      ctx.fillStyle = seed.center;
      ctx.fillRect(cx - 4 * s, cy - 8 * s, 8 * s, 8 * s);
      const t = Date.now() / 500;
      if ((t | 0) % 2 === 0) {
        ctx.fillStyle = "#ffffffcc";
        ctx.fillRect(cx + 6 * s, cy - 14 * s, 2 * s, 2 * s);
      }
      break;
    }
  }
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
  beep(520, 0.04);
  toast("+1 " + seed.name);
  refreshAll();
}

function buyCompost() {
  if (state.coins < COMPOST_COST) return;
  state.coins -= COMPOST_COST;
  state.inventory.compost = (state.inventory.compost || 0) + 1;
  beep(380, 0.05);
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
  state.customer = null;
  state.customerCooldown = 90_000 + Math.random() * 60_000;
  beep(740, 0.06);
  beep(990, 0.06);
  toast("+" + c.bonus + "c");
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

function ensureAudio() {
  if (audio) return audio;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
  } catch {
    audio = null;
  }
  return audio;
}

function beep(freq, dur) {
  if (!settings.sound) return;
  const ac = ensureAudio();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ac.destination);
    const now = ac.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    // ignore audio errors - gameplay continues
  }
}

// ---------- Settings ----------

function bindSettings() {
  const sound = document.getElementById("optSound");
  const notify = document.getElementById("optNotify");
  const anchor = document.getElementById("optAnchor");
  const size = document.getElementById("optSize");

  sound.checked = settings.sound;
  notify.checked = settings.notify;
  anchor.value = settings.anchor;
  size.value = settings.size;

  sound.addEventListener("change", () => {
    settings.sound = sound.checked;
    persist();
  });
  notify.addEventListener("change", () => {
    settings.notify = notify.checked;
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

  if (tauri?.event?.listen) {
    listen("menu:about", () => switchView("settings")).catch(() => {});
  }

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
