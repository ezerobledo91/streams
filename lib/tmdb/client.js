const fs = require("fs/promises");
const path = require("path");
const { safeText } = require("../utils");
const {
  TMDB_BASE_URL,
  DEFAULT_LANGUAGE,
  TMDB_CACHE_TTL_MS,
  TMDB_CACHE_MAX_ITEMS,
  TMDB_CACHE_PERSIST_ENABLED,
  TMDB_CACHE_DIR,
  TMDB_CACHE_FILE
} = require("../config");
const { tmdbCache } = require("../state");
const { fetchJson } = require("../http");

const inflightTmdbRequests = new Map();
let tmdbDiskCacheLoadPromise = null;
let tmdbDiskCacheLoaded = false;
let tmdbPersistTimer = null;
let tmdbPersistInProgress = false;
let tmdbPersistQueued = false;

function looksLikeTmdbApiKey(value) {
  return /^[a-f0-9]{32}$/i.test(safeText(value));
}

function resolveTmdbAuth() {
  const explicitBearer = safeText(
    process.env.TMDB_BEARER_TOKEN || process.env.TMDB_API_READ_ACCESS_TOKEN
  );
  const explicitApiKey = safeText(process.env.TMDB_API_KEY);
  const legacyToken = safeText(process.env.TMDB_TOKEN);

  let bearerToken = explicitBearer;
  let apiKey = explicitApiKey;

  if (bearerToken && looksLikeTmdbApiKey(bearerToken) && !apiKey) {
    apiKey = bearerToken;
    bearerToken = "";
  }

  if (!apiKey && legacyToken && looksLikeTmdbApiKey(legacyToken)) {
    apiKey = legacyToken;
  }

  if (!bearerToken && legacyToken && !looksLikeTmdbApiKey(legacyToken)) {
    bearerToken = legacyToken;
  }

  return { bearerToken, apiKey };
}

function isTmdbConfigured() {
  const auth = resolveTmdbAuth();
  return Boolean(auth.bearerToken || auth.apiKey);
}

function getTmdbLanguage() {
  return safeText(process.env.TMDB_LANGUAGE) || DEFAULT_LANGUAGE;
}

function getTmdbWatchRegion() {
  const value = safeText(process.env.TMDB_WATCH_REGION || process.env.TMDB_REGION || "US")
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) {
    return "US";
  }
  return value;
}

function getTmdbHeaders() {
  const auth = resolveTmdbAuth();
  if (!auth.bearerToken) return {};
  return {
    Authorization: `Bearer ${auth.bearerToken}`
  };
}

function buildTmdbUrl(pathname, query = {}) {
  const url = new URL(`${TMDB_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    const clean = safeText(value);
    if (!clean) continue;
    url.searchParams.set(key, clean);
  }

  const auth = resolveTmdbAuth();
  if (!auth.bearerToken && auth.apiKey) {
    url.searchParams.set("api_key", auth.apiKey);
  }

  return url.toString();
}

function getCacheEntryTime(entry) {
  const value = Number(entry?.cachedAt || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function pruneTmdbCache(nowMs = Date.now()) {
  let changed = false;

  for (const [key, entry] of tmdbCache.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("payload" in entry) ||
      Number(entry.expiresAt || 0) <= nowMs
    ) {
      tmdbCache.delete(key);
      changed = true;
    }
  }

  if (tmdbCache.size <= TMDB_CACHE_MAX_ITEMS) {
    return changed;
  }

  const ordered = [...tmdbCache.entries()].sort(
    (a, b) => getCacheEntryTime(a?.[1]) - getCacheEntryTime(b?.[1])
  );
  const overflow = tmdbCache.size - TMDB_CACHE_MAX_ITEMS;
  for (let index = 0; index < overflow; index += 1) {
    const victim = ordered[index];
    if (!victim) break;
    tmdbCache.delete(victim[0]);
    changed = true;
  }

  return changed;
}

function scheduleTmdbCachePersist() {
  if (!TMDB_CACHE_PERSIST_ENABLED) return;
  if (tmdbPersistTimer) return;

  tmdbPersistTimer = setTimeout(() => {
    tmdbPersistTimer = null;
    void persistTmdbCacheToDisk();
  }, 1400);
}

async function loadTmdbCacheFromDisk() {
  if (!TMDB_CACHE_PERSIST_ENABLED || tmdbDiskCacheLoaded) return;

  await fs.mkdir(TMDB_CACHE_DIR, { recursive: true });
  let raw = "";
  try {
    raw = await fs.readFile(TMDB_CACHE_FILE, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      tmdbDiskCacheLoaded = true;
      return;
    }
    throw error;
  }

  if (!raw.trim()) {
    tmdbDiskCacheLoaded = true;
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const now = Date.now();
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  for (const entry of entries) {
    const key = safeText(entry?.key);
    if (!key) continue;
    if (Number(entry?.expiresAt || 0) <= now) continue;
    if (!Object.prototype.hasOwnProperty.call(entry || {}, "payload")) continue;

    tmdbCache.set(key, {
      payload: entry.payload,
      cachedAt: Number(entry.cachedAt || now),
      expiresAt: Number(entry.expiresAt || now + TMDB_CACHE_TTL_MS)
    });
  }

  const changed = pruneTmdbCache(now);
  if (changed) {
    scheduleTmdbCachePersist();
  }

  tmdbDiskCacheLoaded = true;
}

async function ensureTmdbDiskCacheLoaded() {
  if (!TMDB_CACHE_PERSIST_ENABLED || tmdbDiskCacheLoaded) return;
  if (!tmdbDiskCacheLoadPromise) {
    tmdbDiskCacheLoadPromise = loadTmdbCacheFromDisk()
      .catch(() => {
        // If disk cache fails, continue with in-memory cache.
      })
      .finally(() => {
        tmdbDiskCacheLoaded = true;
      });
  }
  await tmdbDiskCacheLoadPromise;
}

async function persistTmdbCacheToDisk() {
  if (!TMDB_CACHE_PERSIST_ENABLED) return;

  if (tmdbPersistInProgress) {
    tmdbPersistQueued = true;
    return;
  }

  tmdbPersistInProgress = true;
  try {
    await fs.mkdir(TMDB_CACHE_DIR, { recursive: true });
    const now = Date.now();
    pruneTmdbCache(now);
    const entries = [];
    for (const [key, entry] of tmdbCache.entries()) {
      if (Number(entry?.expiresAt || 0) <= now) continue;
      entries.push({
        key,
        cachedAt: getCacheEntryTime(entry),
        expiresAt: Number(entry.expiresAt || 0),
        payload: entry.payload
      });
    }

    const payload = JSON.stringify(
      {
        version: 1,
        savedAt: now,
        entries
      },
      null,
      2
    );
    const tmpFile = path.join(TMDB_CACHE_DIR, "tmdb-cache.tmp.json");
    await fs.writeFile(tmpFile, payload, "utf8");
    await fs.rename(tmpFile, TMDB_CACHE_FILE);
  } catch {
    // no-op: cache persistence is best effort.
  } finally {
    tmdbPersistInProgress = false;
    if (tmdbPersistQueued) {
      tmdbPersistQueued = false;
      scheduleTmdbCachePersist();
    }
  }
}

async function fetchTmdb(pathname, query = {}) {
  if (!isTmdbConfigured()) {
    return null;
  }

  await ensureTmdbDiskCacheLoaded();

  const cacheKey = `${pathname}?${new URLSearchParams(query).toString()}`;
  const now = Date.now();
  const cached = tmdbCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cached.cachedAt = now;
    return cached.payload;
  }
  if (cached) {
    tmdbCache.delete(cacheKey);
  }

  const inflight = inflightTmdbRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const requestPromise = fetchJson(buildTmdbUrl(pathname, query), {
    headers: getTmdbHeaders(),
    timeoutMs: 12000
  }).then((payload) => {
    const writtenAt = Date.now();
    tmdbCache.set(cacheKey, {
      payload,
      cachedAt: writtenAt,
      expiresAt: writtenAt + TMDB_CACHE_TTL_MS
    });

    const changed = pruneTmdbCache(writtenAt);
    if (changed || TMDB_CACHE_PERSIST_ENABLED) {
      scheduleTmdbCachePersist();
    }

    return payload;
  }).finally(() => {
    inflightTmdbRequests.delete(cacheKey);
  });

  inflightTmdbRequests.set(cacheKey, requestPromise);

  return requestPromise;
}

module.exports = {
  resolveTmdbAuth,
  isTmdbConfigured,
  getTmdbLanguage,
  getTmdbWatchRegion,
  getTmdbHeaders,
  buildTmdbUrl,
  fetchTmdb
};
