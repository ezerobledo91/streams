const fs = require("fs");
const path = require("path");
const { liveTvState } = require("../state");

const PREFS_FILE = path.resolve(__dirname, "../../config/live-tv-preferences.json");

const DEFAULT_PREFS = {
  favorites: [],
  hidden: [],
  customNames: {},
  customCategories: {},
  activeSource: "local"
};

let cached = null;

function loadPreferences() {
  try {
    if (!fs.existsSync(PREFS_FILE)) {
      cached = { ...DEFAULT_PREFS, favorites: [], hidden: [], customNames: {}, customCategories: {} };
      return cached;
    }
    const content = fs.readFileSync(PREFS_FILE, "utf8");
    const parsed = JSON.parse(content);
    cached = {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      customNames: parsed.customNames && typeof parsed.customNames === "object" ? parsed.customNames : {},
      customCategories: parsed.customCategories && typeof parsed.customCategories === "object" ? parsed.customCategories : {},
      activeSource: typeof parsed.activeSource === "string" ? parsed.activeSource : "local"
    };
    // Sincronizar con liveTvState
    liveTvState.activeSource = cached.activeSource;
    return cached;
  } catch {
    cached = { ...DEFAULT_PREFS, favorites: [], hidden: [], customNames: {}, customCategories: {}, activeSource: "local" };
    return cached;
  }
}

function savePreferences(data) {
  try {
    const dir = path.dirname(PREFS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2), "utf8");
    cached = data;
  } catch {
    // no-op
  }
}

function getPreferences() {
  if (cached) return cached;
  return loadPreferences();
}

function toggleFavorite(channelId) {
  const prefs = getPreferences();
  const idx = prefs.favorites.indexOf(channelId);
  if (idx >= 0) {
    prefs.favorites.splice(idx, 1);
  } else {
    prefs.favorites.push(channelId);
  }
  savePreferences(prefs);
  return prefs;
}

function hideChannel(channelId) {
  const prefs = getPreferences();
  if (!prefs.hidden.includes(channelId)) {
    prefs.hidden.push(channelId);
    savePreferences(prefs);
  }
  return prefs;
}

function unhideChannel(channelId) {
  const prefs = getPreferences();
  prefs.hidden = prefs.hidden.filter((id) => id !== channelId);
  savePreferences(prefs);
  return prefs;
}

function setCustomName(channelId, name) {
  const prefs = getPreferences();
  const trimmed = String(name || "").trim();
  if (trimmed) {
    prefs.customNames[channelId] = trimmed;
  } else {
    delete prefs.customNames[channelId];
  }
  savePreferences(prefs);
  return prefs;
}

function setCustomCategory(channelId, categoryId) {
  const prefs = getPreferences();
  const trimmed = String(categoryId || "").trim();
  if (trimmed) {
    prefs.customCategories[channelId] = trimmed;
  } else {
    delete prefs.customCategories[channelId];
  }
  savePreferences(prefs);
  return prefs;
}

function setActiveSource(source) {
  const prefs = getPreferences();
  prefs.activeSource = source;
  savePreferences(prefs);
  liveTvState.activeSource = source;
  return prefs;
}

// Load on startup
loadPreferences();

module.exports = {
  loadPreferences,
  savePreferences,
  getPreferences,
  toggleFavorite,
  hideChannel,
  unhideChannel,
  setCustomName,
  setCustomCategory,
  setActiveSource
};
