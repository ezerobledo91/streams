const { safeText, normalizeInfoHash, extractInfoHashFromText } = require("../utils");
const {
  PROWLARR_URL,
  PROWLARR_API_KEY,
  PROWLARR_ENABLED,
  PROWLARR_TIMEOUT_MS,
  PROWLARR_MAX_PER_QUERY,
  PROWLARR_MAX_STREAMS
} = require("../config");
const { fetchJson } = require("../http");
const { isTmdbConfigured, getTmdbLanguage, fetchTmdb } = require("../tmdb/client");
const { isProviderCircuitOpen, getProviderReliability } = require("../reliability/tracker");
const { resolveTmdbReference } = require("../meta/resolver");
const {
  mapProwlarrSearchResultToStream,
  filterEpisodeProwlarrStreams,
  dedupeProwlarrStreams
} = require("./mapper");

const prowlarrResultCache = new Map();
const PROWLARR_CACHE_TTL_MS = 10 * 60 * 1000;

function isProwlarrConfigured() {
  return PROWLARR_ENABLED && Boolean(PROWLARR_URL && PROWLARR_API_KEY);
}

function getProwlarrHeaders() {
  if (!PROWLARR_API_KEY) return null;
  return {
    "X-Api-Key": PROWLARR_API_KEY
  };
}

function parseProwlarrList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function normalizeReleaseQuery(value) {
  return safeText(value)
    .replace(/[^\p{L}\p{N}\s.:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseImdbIdFromResolvedItemId(resolvedItemId) {
  const imdbId = safeText(resolvedItemId).split(":")[0].toLowerCase();
  if (!/^tt\d+$/i.test(imdbId)) return "";
  return imdbId;
}

function parseSeriesNumbersFromResolvedItemId(resolvedType, resolvedItemId, season, episode) {
  if (safeText(resolvedType).toLowerCase() !== "series") return { seasonNum: null, episodeNum: null };

  const rawParts = safeText(resolvedItemId).split(":");
  let seasonNum = Number.parseInt(rawParts[1], 10);
  let episodeNum = Number.parseInt(rawParts[2], 10);

  if (!Number.isFinite(seasonNum) || seasonNum <= 0) {
    seasonNum = Number.parseInt(season, 10);
  }
  if (!Number.isFinite(episodeNum) || episodeNum <= 0) {
    episodeNum = Number.parseInt(episode, 10);
  }

  return {
    seasonNum: Number.isFinite(seasonNum) && seasonNum > 0 ? seasonNum : null,
    episodeNum: Number.isFinite(episodeNum) && episodeNum > 0 ? episodeNum : null
  };
}

async function resolveTitleForProwlarrQuery(type, itemId, resolvedType, resolvedItemId) {
  if (!isTmdbConfigured()) return "";

  try {
    const ref = await resolveTmdbReference(resolvedType, itemId, resolvedItemId);
    if (!ref) return "";

    const language = getTmdbLanguage();
    if (ref.tmdbType === "movie") {
      const details = await fetchTmdb(`/movie/${ref.tmdbId}`, { language });
      return safeText(details?.title);
    }

    const details = await fetchTmdb(`/tv/${ref.tmdbId}`, { language });
    return safeText(details?.name);
  } catch {
    return "";
  }
}

function buildProwlarrQueries({ title, imdbId, resolvedType, seasonNum, episodeNum }) {
  const queries = [];
  const normalizedTitle = normalizeReleaseQuery(title);

  if (normalizedTitle && resolvedType === "series" && seasonNum && episodeNum) {
    const seasonText = String(seasonNum).padStart(2, "0");
    const episodeText = String(episodeNum).padStart(2, "0");
    queries.push(`${normalizedTitle} S${seasonText}E${episodeText}`);
    queries.push(`${normalizedTitle} ${seasonNum}x${episodeNum}`);
  }

  if (normalizedTitle) {
    queries.push(normalizedTitle);
  }

  if (imdbId) {
    queries.push(imdbId);
    if (normalizedTitle) {
      queries.push(`${normalizedTitle} ${imdbId}`);
    }
  }

  return [...new Set(queries.map((query) => normalizeReleaseQuery(query)).filter(Boolean))].slice(0, 4);
}

async function fetchProwlarrStreams({ type, itemId, resolvedType, resolvedItemId, season, episode }) {
  if (!PROWLARR_ENABLED) {
    return null;
  }

  const cacheKey = `${safeText(type)}|${safeText(resolvedItemId)}|${safeText(season)}|${safeText(episode)}`;
  const cached = prowlarrResultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROWLARR_CACHE_TTL_MS && cached.result?.ok) {
    return cached.result;
  }

  if (isProviderCircuitOpen("prowlarr")) {
    const stats = getProviderReliability("prowlarr", false);
    const until = Number(stats?.breakerUntil || 0);
    return {
      provider: {
        id: "prowlarr",
        name: "Prowlarr",
        baseUrl: PROWLARR_URL || "http://localhost:9696",
        manifestUrl: PROWLARR_URL ? `${PROWLARR_URL}/api/v1` : "http://localhost:9696/api/v1"
      },
      ok: false,
      error: `Circuit breaker activo para prowlarr hasta ${new Date(until).toISOString()}.`,
      streams: []
    };
  }

  const provider = {
    id: "prowlarr",
    name: "Prowlarr",
    baseUrl: PROWLARR_URL || "http://localhost:9696",
    manifestUrl: PROWLARR_URL ? `${PROWLARR_URL}/api/v1` : "http://localhost:9696/api/v1"
  };

  if (!isProwlarrConfigured()) {
    return {
      provider,
      ok: false,
      error: "Prowlarr habilitado pero falta PROWLARR_URL o PROWLARR_API_KEY.",
      streams: []
    };
  }

  const imdbId = parseImdbIdFromResolvedItemId(resolvedItemId);
  const { seasonNum, episodeNum } = parseSeriesNumbersFromResolvedItemId(
    resolvedType,
    resolvedItemId,
    season,
    episode
  );
  const title = await resolveTitleForProwlarrQuery(type, itemId, resolvedType, resolvedItemId);
  const queries = buildProwlarrQueries({
    title,
    imdbId,
    resolvedType,
    seasonNum,
    episodeNum
  });

  if (!queries.length) {
    return {
      provider,
      ok: false,
      error: "No se pudo construir query para Prowlarr.",
      streams: []
    };
  }

  const headers = getProwlarrHeaders();
  const requestTimeoutMs = Math.max(3500, Math.min(PROWLARR_TIMEOUT_MS, 8000));
  const maxEntriesPerQuery = Math.min(PROWLARR_MAX_PER_QUERY, 80);
  const requests = await Promise.all(
    queries.map(async (query) => {
      try {
        const url = new URL("/api/v1/search", `${PROWLARR_URL}/`);
        url.searchParams.set("query", query);
        const payload = await fetchJson(url.toString(), {
          timeoutMs: requestTimeoutMs,
          headers
        });
        const entries = parseProwlarrList(payload).slice(0, maxEntriesPerQuery);
        return { ok: true, query, entries };
      } catch (error) {
        return {
          ok: false,
          query,
          error: error?.message || "Error consultando Prowlarr.",
          entries: []
        };
      }
    })
  );

  const allFailed = requests.every((item) => !item.ok);
  if (allFailed) {
    const reason = requests[0]?.error || "Prowlarr no respondio correctamente.";
    return {
      provider,
      ok: false,
      error: reason,
      streams: []
    };
  }

  const rawStreams = requests
    .flatMap((item) => item.entries)
    .map((entry) => mapProwlarrSearchResultToStream(entry))
    .filter(Boolean);

  const filteredForEpisode =
    safeText(resolvedType).toLowerCase() === "series"
      ? filterEpisodeProwlarrStreams(rawStreams, seasonNum, episodeNum)
      : rawStreams;
  const streams = dedupeProwlarrStreams(filteredForEpisode, PROWLARR_MAX_STREAMS);

  const result = { provider, ok: true, streams };
  prowlarrResultCache.set(cacheKey, { result, at: Date.now() });
  if (prowlarrResultCache.size > 200) {
    const oldest = [...prowlarrResultCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
    for (const [key] of oldest) prowlarrResultCache.delete(key);
  }
  return result;
}

module.exports = {
  isProwlarrConfigured,
  fetchProwlarrStreams,
  parseImdbIdFromResolvedItemId,
  parseSeriesNumbersFromResolvedItemId,
  buildProwlarrQueries
};
