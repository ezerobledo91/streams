const { safeText } = require("../utils");
const { state } = require("../state");
const { fetchJson } = require("../http");
const { PROWLARR_ENABLED } = require("../config");
const { resolveStreamRequest } = require("../meta/resolver");
const {
  isProwlarrConfigured,
  fetchProwlarrStreams
} = require("../prowlarr/client");
const {
  isProviderCircuitOpen,
  getProviderReliability,
  applyReliabilityToProviderResult
} = require("../reliability/tracker");

const STREAM_SOURCE_TIMEOUT_MS = 4000;
const PROWLARR_GRACE_MS = 1500;

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

  const rawResults = prowlarrResult ? [prowlarrResult, ...addonResults] : addonResults;
  const results = rawResults.map((item) => applyReliabilityToProviderResult(item));

  return {
    requestedType,
    requestedItemId,
    resolvedType: resolved.resolvedType,
    resolvedItemId: resolved.resolvedItemId,
    providerCount: targetSources.length + (prowlarrResult ? 1 : 0),
    results,
    summary: {
      addonProviders: targetSources.length,
      prowlarrEnabled: PROWLARR_ENABLED,
      prowlarrConfigured: isProwlarrConfigured(),
      prowlarrUsed: Boolean(prowlarrResult)
    }
  };
}

module.exports = {
  fetchAggregatedStreams
};
