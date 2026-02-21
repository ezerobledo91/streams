const { safeText } = require("../utils");
const { state } = require("../state");
const { fetchJson } = require("../http");
const { PROWLARR_ENABLED } = require("../config");
const { resolveStreamRequest, resolveTmdbReference } = require("../meta/resolver");
const { isTmdbConfigured, getTmdbLanguage, fetchTmdb } = require("../tmdb/client");
const {
  isProwlarrConfigured,
  fetchProwlarrStreams
} = require("../prowlarr/client");
const { searchVodIndex, estimateVideoSizeFromQuality } = require("../live-tv/vod-index");
const {
  isProviderCircuitOpen,
  getProviderReliability,
  applyReliabilityToProviderResult
} = require("../reliability/tracker");

const STREAM_SOURCE_TIMEOUT_MS = 4000;
const PROWLARR_GRACE_MS = 1500;

async function resolveTitleForVodQuery(requestedItemId, resolvedType, resolvedItemId) {
  if (!isTmdbConfigured()) return "";
  try {
    const ref = await resolveTmdbReference(resolvedType, requestedItemId, resolvedItemId);
    if (!ref?.tmdbId || !ref?.tmdbType) return "";
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

function inferFilenameFromEntry(entry) {
  const streamUrl = safeText(entry?.streamUrl);
  if (streamUrl) {
    try {
      const pathname = new URL(streamUrl).pathname;
      const byPath = pathname.split("/").pop();
      if (safeText(byPath)) return byPath;
    } catch {
      // ignore malformed URL
    }
  }
  const safeName = safeText(entry?.name).replace(/[^\p{L}\p{N}\s._-]/gu, "").trim();
  return safeName ? `${safeName}.mp4` : "vod-stream.mp4";
}

function entryToStream(entry) {
  const streamUrl = safeText(entry?.streamUrl);
  if (!streamUrl) return null;

  return {
    name: "M3U VOD",
    title: safeText(entry?.name) || "M3U VOD",
    description: safeText(entry?.groupTitle) || "Fuente local M3U VOD",
    url: streamUrl,
    behaviorHints: {
      videoSize: estimateVideoSizeFromQuality(entry?.quality),
      filename: inferFilenameFromEntry(entry),
      bingeGroup: safeText(entry?.normalizedTitle) || undefined
    }
  };
}

async function fetchAggregatedStreams({ type, itemId, season = "", episode = "", onlyActive = true }) {
  const requestedType = safeText(type);
  const requestedItemId = safeText(itemId);
  const requestedSeason = safeText(season);
  const requestedEpisode = safeText(episode);

  if (!requestedType || !requestedItemId) {
    throw new Error("Debes enviar type e itemId.");
  }

  const resolved = await resolveStreamRequest(requestedType, requestedItemId, requestedSeason, requestedEpisode);
  const targetSources = state.streamSources.filter((source) => (onlyActive ? source.active : true));
  const encodedType = encodeURIComponent(resolved.resolvedType);
  const encodedItemId = encodeURIComponent(resolved.resolvedItemId);
  const resolvedTitle = await resolveTitleForVodQuery(
    requestedItemId,
    resolved.resolvedType,
    resolved.resolvedItemId
  );
  const vodCandidates = resolvedTitle
    ? searchVodIndex(resolvedTitle, {
        season: requestedSeason,
        episode: requestedEpisode,
        type: requestedType
      })
    : [];
  const vodStreams = vodCandidates.map((item) => entryToStream(item)).filter(Boolean);
  if (resolvedTitle) {
    console.log(
      `[M3U-VOD] query title="${safeText(resolvedTitle).slice(0, 90)}" season=${requestedSeason || "-"} episode=${requestedEpisode || "-"} matches=${vodStreams.length}`
    );
  } else {
    console.log(
      `[M3U-VOD] query skipped (sin titulo resuelto TMDB) type=${requestedType} itemId=${requestedItemId}`
    );
  }
  const m3uVodResult =
    vodStreams.length > 0
      ? {
          provider: {
            id: "m3u-vod",
            name: "M3U VOD",
            baseUrl: "",
            manifestUrl: ""
          },
          ok: true,
          streams: vodStreams
        }
      : null;

  const addonPromise = Promise.all(
    targetSources.map(async (source) => {
      if (isProviderCircuitOpen(source.id)) {
        const stats = getProviderReliability(source.id, false);
        const until = Number(stats?.breakerUntil || 0);
        return {
          provider: {
            id: source.id,
            name: source.name,
            baseUrl: source.baseUrl,
            manifestUrl: source.manifestUrl
          },
          ok: false,
          error: `Circuit breaker activo hasta ${new Date(until).toISOString()}.`,
          streams: []
        };
      }

      const url = `${source.baseUrl}/stream/${encodedType}/${encodedItemId}.json`;
      try {
        const payload = await fetchJson(url, { timeoutMs: STREAM_SOURCE_TIMEOUT_MS });
        return {
          provider: {
            id: source.id,
            name: source.name,
            baseUrl: source.baseUrl,
            manifestUrl: source.manifestUrl
          },
          ok: true,
          streams: Array.isArray(payload?.streams) ? payload.streams : []
        };
      } catch (error) {
        return {
          provider: {
            id: source.id,
            name: source.name,
            baseUrl: source.baseUrl,
            manifestUrl: source.manifestUrl
          },
          ok: false,
          error: error.message,
          streams: []
        };
      }
    })
  );

  // Lanzar Prowlarr en paralelo pero NO bloquear si es lento
  const prowlarrPromise = fetchProwlarrStreams({
    type: requestedType,
    itemId: requestedItemId,
    resolvedType: resolved.resolvedType,
    resolvedItemId: resolved.resolvedItemId,
    season: requestedSeason,
    episode: requestedEpisode
  });

  // Esperar addons primero (max 5s por su timeout)
  const addonResults = await addonPromise;

  // Dar a Prowlarr solo PROWLARR_GRACE_MS extra después de que los addons terminaron
  let prowlarrResult = null;
  try {
    prowlarrResult = await Promise.race([
      prowlarrPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), PROWLARR_GRACE_MS))
    ]);
  } catch {
    prowlarrResult = null;
  }

  const rawResults = [
    ...(m3uVodResult ? [m3uVodResult] : []),
    ...(prowlarrResult ? [prowlarrResult] : []),
    ...addonResults
  ];
  const m3uRawIndex = rawResults.findIndex((item) => safeText(item?.provider?.id).toLowerCase() === "m3u-vod");
  if (m3uRawIndex >= 0) {
    console.log(`[M3U-VOD] provider order index=${m3uRawIndex}/${Math.max(rawResults.length - 1, 0)} (0=primero)`);
  }
  const results = rawResults.map((item) => applyReliabilityToProviderResult(item));
  const m3uResult = results.find((item) => safeText(item?.provider?.id).toLowerCase() === "m3u-vod");
  if (m3uResult) {
    console.log(
      `[M3U-VOD] provider after reliability ok=${Boolean(m3uResult.ok)} streams=${Array.isArray(m3uResult.streams) ? m3uResult.streams.length : 0} reason=${safeText(m3uResult.error) || "none"}`
    );
  }

  return {
    requestedType,
    requestedItemId,
    resolvedType: resolved.resolvedType,
    resolvedItemId: resolved.resolvedItemId,
    providerCount: rawResults.length,
    results,
    summary: {
      addonProviders: targetSources.length,
      prowlarrEnabled: PROWLARR_ENABLED,
      prowlarrConfigured: isProwlarrConfigured(),
      prowlarrUsed: Boolean(prowlarrResult),
      m3uVodUsed: Boolean(m3uVodResult),
      m3uVodStreams: vodStreams.length
    }
  };
}

module.exports = {
  fetchAggregatedStreams
};
