// Taskbar Garden - frontend logic
// Pure DOM + Canvas. No bundler. Uses window.__TAURI__ globals.

const tauri = window.__TAURI__ || null;
const invoke = tauri?.core?.invoke ?? (() => Promise.resolve());
const listen = tauri?.event?.listen ?? (() => () => {});

const SAVE_KEY = "taskbar-garden:save:v1";
const SETTINGS_KEY = "taskbar-garden:settings:v1";

const GRID = 4;
const TILE = 80;
const CANVAS_PX = GRID * TILE;
const TICK_MS = 1000;

const SEEDS = {
  daisy:    { name: "Daisy",    cost: 5,  reward: 12, growMs: 60_000,  color: "#ffffff", center: "#f4d35e" },
  tulip:    { name: "Tulip",    cost: 12, reward: 30, growMs: 150_000, color: "#e8a4c9", center: "#c95a8d" },
  sunflower:{ name: "Sunflower",cost: 25, reward: 70, growMs: 300_000, color: "#f4d35e", center: "#8b5a3c" },
  bluebell: { name: "Bluebell", cost: 18, reward: 45, growMs: 220_000, color: "#7da7e8", center: "#3a5a8a" },
};

const STAGE = { EMPTY: 0, SEED: 1, SPROUT: 2, BUD: 3, BLOOM: 4 };

const DEFAULT_SETTINGS = {
  sound: true,
  notify: false,
  anchor: "tray",
  size: "medium",
};

const DEFAULT_SAVE = () => ({
  coins: 30,
  plots: Array.from({ length: GRID * GRID }, () => emptyPlot()),
  inventory: { daisy: 3 },
  selectedSeed: "daisy",
  customer: null,
  customerCooldown: 90_000,
  totalHarvests: 0,
});

function emptyPlot() {
  return { stage: STAGE.EMPTY, seed: null, plantedAt: 0, water: 0, lastTick: 0 };
}

let state = loadJSON(SAVE_KEY, DEFAULT_SAVE());
let settings = loadJSON(SETTINGS_KEY, { ...DEFAULT_SETTINGS });
state = sanitizeSave(state);
settings = { ...DEFAULT_SETTINGS, ...settings };

let tickHandle = null;
let canvas, ctx;
let audio = null;

function loadJSON(key, fallback) {
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
    // disk full or storage disabled - swallow to keep game running
  }
}

function sanitizeSave(s) {
  const base = DEFAULT_SAVE();
  if (!s || typeof s !== "object") return base;
  const out = { ...base, ...s };
  if (!Array.isArray(out.plots) || out.plots.length !== GRID * GRID) {
    out.plots = base.plots;
  } else {
    out.plots = out.plots.map((p) => ({ ...emptyPlot(), ...(p || {}) }));
  }
  if (!out.inventory || typeof out.inventory !== "object") out.inventory = { daisy: 3 };
  for (const k of Object.keys(out.inventory)) {
    if (!SEEDS[k]) delete out.inventory[k];
  }
  if (!SEEDS[out.selectedSeed]) out.selectedSeed = Object.keys(SEEDS)[0];
  if (typeof out.coins !== "number" || !Number.isFinite(out.coins)) out.coins = 0;
  return out;
}

function persist() {
  saveJSON(SAVE_KEY, state);
  saveJSON(SETTINGS_KEY, settings);
}

// ---------- Game tick ----------

function tick() {
  const now = Date.now();
  for (const plot of state.plots) {
    if (plot.stage === STAGE.EMPTY || plot.stage === STAGE.BLOOM) continue;
    const seed = SEEDS[plot.seed];
    if (!seed) {
      plot.stage = STAGE.EMPTY;
      plot.seed = null;
      continue;
    }
    const elapsed = now - plot.plantedAt;
    const ratio = Math.min(1, elapsed / seed.growMs);
    if (ratio >= 1) plot.stage = STAGE.BLOOM;
    else if (ratio >= 0.66) plot.stage = STAGE.BUD;
    else if (ratio >= 0.33) plot.stage = STAGE.SPROUT;
    else plot.stage = STAGE.SEED;
    plot.water = Math.max(0, plot.water - 1);
  }

  state.customerCooldown = Math.max(0, (state.customerCooldown || 0) - TICK_MS);
  if (!state.customer && state.customerCooldown <= 0 && state.totalHarvests > 0) {
    spawnCustomer();
  }
  if (state.customer && state.customer.expiresAt < now) {
    state.customer = null;
    state.customerCooldown = 60_000;
  }

  render();
  renderStats();
  renderCustomer();
  persist();
}

function startTicks() {
  if (tickHandle != null) return;
  tickHandle = setInterval(tick, TICK_MS);
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
  state.customer = {
    want,
    qty,
    bonus,
    expiresAt: Date.now() + 120_000,
  };
}

// ---------- Render ----------

function setupCanvas() {
  canvas = document.getElementById("garden");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  canvas.addEventListener("click", onPlotClick);
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);

  for (let i = 0; i < state.plots.length; i++) {
    const x = (i % GRID) * TILE;
    const y = Math.floor(i / GRID) * TILE;
    drawPlot(x, y, state.plots[i]);
  }
}

function drawPlot(x, y, plot) {
  // soil background
  ctx.fillStyle = "#a87f4d";
  ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
  // furrows
  ctx.fillStyle = "#8b6435";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 8, y + 12 + i * 14, TILE - 16, 2);
  }
  // border
  ctx.strokeStyle = "#5c3f1f";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);

  if (plot.stage === STAGE.EMPTY) return;

  const seed = SEEDS[plot.seed];
  if (!seed) return;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2 + 6;

  switch (plot.stage) {
    case STAGE.SEED:
      ctx.fillStyle = "#3a2e2a";
      ctx.fillRect(cx - 3, cy + 12, 6, 4);
      break;
    case STAGE.SPROUT:
      ctx.fillStyle = "#5a8c4a";
      ctx.fillRect(cx - 1, cy + 4, 2, 12);
      ctx.fillRect(cx - 5, cy + 6, 4, 2);
      ctx.fillRect(cx + 1, cy + 8, 4, 2);
      break;
    case STAGE.BUD:
      ctx.fillStyle = "#3a5a40";
      ctx.fillRect(cx - 1, cy - 4, 2, 20);
      ctx.fillStyle = seed.center;
      ctx.fillRect(cx - 3, cy - 8, 6, 6);
      break;
    case STAGE.BLOOM: {
      ctx.fillStyle = "#3a5a40";
      ctx.fillRect(cx - 1, cy - 4, 2, 20);
      ctx.fillStyle = seed.color;
      ctx.fillRect(cx - 8, cy - 12, 6, 6);
      ctx.fillRect(cx + 2, cy - 12, 6, 6);
      ctx.fillRect(cx - 8, cy - 4, 6, 6);
      ctx.fillRect(cx + 2, cy - 4, 6, 6);
      ctx.fillStyle = seed.center;
      ctx.fillRect(cx - 4, cy - 8, 8, 8);
      // gentle shimmer when ready
      const t = Date.now() / 400;
      if ((t | 0) % 2 === 0) {
        ctx.fillStyle = "#ffffffcc";
        ctx.fillRect(cx + 6, cy - 14, 2, 2);
      }
      break;
    }
  }
}

// ---------- Interaction ----------

function onPlotClick(e) {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * CANVAS_PX;
  const py = ((e.clientY - rect.top) / rect.height) * CANVAS_PX;
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  if (col < 0 || col >= GRID || row < 0 || row >= GRID) return;
  const idx = row * GRID + col;
  const plot = state.plots[idx];
  if (!plot) return;

  if (plot.stage === STAGE.EMPTY) {
    plant(idx);
  } else if (plot.stage === STAGE.BLOOM) {
    harvest(idx);
  } else {
    setHint("Still growing. Be patient.");
  }
}

function plant(idx) {
  const seedId = state.selectedSeed;
  const have = state.inventory[seedId] || 0;
  if (have <= 0) {
    setHint("No " + SEEDS[seedId].name + " seeds. Visit shop.");
    return;
  }
  state.inventory[seedId] = have - 1;
  state.plots[idx] = {
    stage: STAGE.SEED,
    seed: seedId,
    plantedAt: Date.now(),
    water: 5,
    lastTick: Date.now(),
  };
  beep(660, 0.05);
  setHint("Planted " + SEEDS[seedId].name + ".");
  render();
  renderStats();
  persist();
}

function harvest(idx) {
  const plot = state.plots[idx];
  const seed = SEEDS[plot.seed];
  if (!seed) return;
  const flowerType = plot.seed;
  state.coins += seed.reward;
  state.totalHarvests++;
  state.plots[idx] = emptyPlot();

  // store flower in inventory under flower:<id> for customer fulfillment
  const key = "flower:" + flowerType;
  state.inventory[key] = (state.inventory[key] || 0) + 1;

  beep(880, 0.08);
  setHint("Harvested " + seed.name + " (+" + seed.reward + " coins).");
  toast("+" + seed.reward);
  render();
  renderStats();
  persist();
}

// ---------- UI ----------

function renderStats() {
  document.getElementById("coins").textContent = String(Math.floor(state.coins));
  let totalSeeds = 0;
  for (const k of Object.keys(state.inventory)) {
    if (!k.startsWith("flower:")) totalSeeds += state.inventory[k] || 0;
  }
  document.getElementById("seedCount").textContent = String(totalSeeds);
}

function renderShop() {
  const list = document.getElementById("shopList");
  list.innerHTML = "";
  for (const [id, seed] of Object.entries(SEEDS)) {
    const li = document.createElement("li");
    const have = state.inventory[id] || 0;
    li.innerHTML =
      '<div class="meta">' +
        '<span class="name">' + escapeHtml(seed.name) + " seed</span>" +
        '<span class="desc">Grow ' + Math.round(seed.growMs / 1000) + "s &middot; sells " + seed.reward + " &middot; you have " + have + "</span>" +
      "</div>";
    const btn = document.createElement("button");
    btn.className = "btn-buy";
    btn.textContent = "Buy " + seed.cost;
    btn.disabled = state.coins < seed.cost;
    btn.addEventListener("click", () => buySeed(id));
    li.appendChild(btn);

    const sel = document.createElement("button");
    sel.className = "btn-icon";
    sel.style.marginLeft = "6px";
    sel.title = "Plant this next";
    sel.textContent = state.selectedSeed === id ? "*" : "o";
    sel.addEventListener("click", () => {
      state.selectedSeed = id;
      persist();
      renderShop();
      setHint("Selected " + seed.name + " for planting.");
    });
    li.appendChild(sel);

    list.appendChild(li);
  }
}

function buySeed(id) {
  const seed = SEEDS[id];
  if (!seed || state.coins < seed.cost) return;
  state.coins -= seed.cost;
  state.inventory[id] = (state.inventory[id] || 0) + 1;
  beep(520, 0.04);
  toast("+1 " + seed.name);
  renderShop();
  renderStats();
  persist();
}

function renderCustomer() {
  const el = document.getElementById("customer");
  if (!state.customer) {
    el.textContent = "No one is here yet. Harvest flowers and someone may stop by.";
    return;
  }
  const c = state.customer;
  const seed = SEEDS[c.want];
  const have = state.inventory["flower:" + c.want] || 0;
  const remain = Math.max(0, Math.floor((c.expiresAt - Date.now()) / 1000));
  el.innerHTML =
    "<div>Visitor wants <b>" + c.qty + " " + escapeHtml(seed.name) + "</b> for " + c.bonus + " coins.</div>" +
    "<div class=\"muted\">You have " + have + ". Leaves in " + remain + "s.</div>";
  const btn = document.createElement("button");
  btn.className = "accept";
  btn.textContent = have >= c.qty ? "Sell" : "Need " + (c.qty - have) + " more";
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
  toast("+" + c.bonus + " coins");
  renderStats();
  renderCustomer();
  persist();
}

function setHint(text) {
  const el = document.getElementById("hint");
  if (el) el.textContent = text;
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1100);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Tabs / views ----------

function switchView(name) {
  for (const view of document.querySelectorAll(".view")) view.classList.remove("active");
  document.getElementById("view-" + name).classList.add("active");
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.view === name);
  if (name === "shop") renderShop();
  if (name === "shop") renderCustomer();
}

// ---------- Sound ----------

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
    // audio failed - ignore, gameplay continues
  }
}

// ---------- Settings UI ----------

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
    state = DEFAULT_SAVE();
    persist();
    render();
    renderStats();
    renderShop();
    renderCustomer();
    setHint("Garden reset.");
  });
}

function applyWindowSize() {
  const sizes = {
    small: [320, 420],
    medium: [360, 480],
    large: [420, 560],
  };
  const [w, h] = sizes[settings.size] || sizes.medium;
  invoke("set_window_size", { width: w, height: h }).catch(() => {});
}

// ---------- Boot ----------

function bind() {
  setupCanvas();
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => switchView(t.dataset.view));
  }
  document.getElementById("btnHide").addEventListener("click", () => {
    invoke("hide_window").catch(() => {});
  });
  document.getElementById("btnShop").addEventListener("click", () => switchView("shop"));
  document.getElementById("btnSettings").addEventListener("click", () => switchView("settings"));

  bindSettings();
  switchView("garden");
  render();
  renderStats();
  renderShop();
  renderCustomer();

  // pause ticks when hidden, resume when visible. Saves CPU.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTicks();
    else startTicks();
  });

  if (tauri?.event?.listen) {
    listen("menu:about", () => {
      switchView("settings");
    }).catch(() => {});
  }

  startTicks();
  applyWindowSize();
}

window.addEventListener("error", (e) => {
  console.error("garden error", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("garden promise rejection", e.reason);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
