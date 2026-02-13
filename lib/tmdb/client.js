const { safeText } = require("../utils");
const { TMDB_BASE_URL, DEFAULT_LANGUAGE } = require("../config");
const { tmdbCache } = require("../state");
const { fetchJson } = require("../http");

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

async function fetchTmdb(pathname, query = {}) {
  if (!isTmdbConfigured()) {
    return null;
  }

  const cacheKey = `${pathname}?${new URLSearchParams(query).toString()}`;
  const now = Date.now();
  const cached = tmdbCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const payload = await fetchJson(buildTmdbUrl(pathname, query), {
    headers: getTmdbHeaders(),
    timeoutMs: 12000
  });

  tmdbCache.set(cacheKey, {
    payload,
    expiresAt: now + 60 * 60 * 1000
  });

  return payload;
}

module.exports = {
  resolveTmdbAuth,
  isTmdbConfigured,
  getTmdbLanguage,
  getTmdbHeaders,
  buildTmdbUrl,
  fetchTmdb
};
