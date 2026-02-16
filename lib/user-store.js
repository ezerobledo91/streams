const fs = require("fs");
const path = require("path");

const DATA_FILE = path.resolve(__dirname, "../data/user-data.json");

function ensureDataFile() {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");
    }
  } catch {
    // no-op
  }
}

function loadData() {
  ensureDataFile();
  try {
    const content = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return { users: {} };
  }
}

function persistData(payload) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // no-op
  }
}

function sanitizeUsername(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
  return clean || "guest";
}

function ensureUser({ username, displayName }) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const existing = data.users[cleanUsername] || {
    username: cleanUsername,
    displayName: displayName || cleanUsername,
    favorites: [],
    unavailable: [],
    continueWatching: []
  };
  existing.displayName = displayName || existing.displayName;
  data.users[cleanUsername] = existing;
  persistData(data);
  return existing;
}

function getUser(username) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  return data.users[cleanUsername] || null;
}

function listUsers() {
  const data = loadData();
  return Object.values(data.users || {});
}

function toggleFavorite(username, item) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const user = data.users[cleanUsername];
  if (!user) return null;

  const key = `${item.type}:${item.id}`;
  const existingIndex = user.favorites.findIndex((entry) => `${entry.type}:${entry.id}` === key);
  if (existingIndex >= 0) {
    user.favorites.splice(existingIndex, 1);
  } else {
    user.favorites.unshift({
      type: item.type,
      id: item.id,
      name: item.name,
      year: item.year,
      poster: item.poster,
      background: item.background,
      description: item.description,
      rating: item.rating,
      source: item.source || null
    });
    if (user.favorites.length > 120) {
      user.favorites.pop();
    }
  }

  persistData(data);
  return user;
}

function markUnavailable(username, payload) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const user = data.users[cleanUsername];
  if (!user) return null;
  const key = `${payload.type}:${payload.itemId}`;
  const existing = user.unavailable.find((entry) => entry.key === key);
  if (!existing) {
    user.unavailable.push({
      key,
      type: payload.type,
      itemId: payload.itemId,
      reason: payload.reason || "n/a",
      notedAt: Date.now()
    });
  }
  persistData(data);
  return user;
}

function clearUnavailable(username, type, itemId) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const user = data.users[cleanUsername];
  if (!user) return null;
  const key = `${type}:${itemId}`;
  user.unavailable = user.unavailable.filter((entry) => entry.key !== key);
  persistData(data);
  return user;
}

function upsertContinueWatching(username, entry) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const user = data.users[cleanUsername];
  if (!user) return null;

  if (!Array.isArray(user.continueWatching)) {
    user.continueWatching = [];
  }

  const key =
    entry.type === "series" && entry.season != null && entry.episode != null
      ? `${entry.type}:${entry.itemId}:${entry.season}:${entry.episode}`
      : `${entry.type}:${entry.itemId}`;

  user.continueWatching = user.continueWatching.filter((e) => {
    const k =
      e.type === "series" && e.season != null && e.episode != null
        ? `${e.type}:${e.itemId}:${e.season}:${e.episode}`
        : `${e.type}:${e.itemId}`;
    return k !== key;
  });

  user.continueWatching.unshift({
    type: entry.type,
    itemId: entry.itemId,
    name: entry.name || "",
    poster: entry.poster || null,
    background: entry.background || null,
    season: entry.season ?? null,
    episode: entry.episode ?? null,
    episodeTitle: entry.episodeTitle || null,
    position: entry.position || 0,
    duration: entry.duration || 0,
    lastWatched: Date.now()
  });

  if (user.continueWatching.length > 50) {
    user.continueWatching = user.continueWatching.slice(0, 50);
  }

  persistData(data);
  return user;
}

function getContinueWatchingForUser(username) {
  const data = loadData();
  const cleanUsername = sanitizeUsername(username);
  const user = data.users[cleanUsername];
  if (!user || !Array.isArray(user.continueWatching)) return [];

  return user.continueWatching
    .filter((e) => {
      if (!e.duration || e.duration <= 0) return false;
      const pct = e.position / e.duration;
      return (pct > 0.02 || e.position >= 10) && pct < 0.95;
    })
    .sort((a, b) => b.lastWatched - a.lastWatched);
}

module.exports = {
  ensureUser,
  getUser,
  listUsers,
  toggleFavorite,
  markUnavailable,
  clearUnavailable,
  sanitizeUsername,
  upsertContinueWatching,
  getContinueWatchingForUser
};
