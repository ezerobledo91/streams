const { safeText, normalizeProviderId, nowMs } = require("../utils");
const {
  RELIABILITY_MIN_SAMPLES,
  RELIABILITY_CIRCUIT_THRESHOLD,
  RELIABILITY_CIRCUIT_BASE_MS,
  RELIABILITY_MAX_SOURCES_PER_PROVIDER
} = require("../config");
const { reliabilityState } = require("../state");
const { scheduleReliabilityPersist } = require("./persistence");

function createEmptyProviderReliability() {
  return {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    lastFailureReason: "",
    breakerUntil: 0,
    sources: {}
  };
}

function createEmptySourceReliability() {
  return {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0
  };
}

function getProviderReliability(providerId, create = false) {
  const id = normalizeProviderId(providerId);
  const existing = reliabilityState.providers[id];
  if (existing) return existing;
  if (!create) return null;
  const created = createEmptyProviderReliability();
  reliabilityState.providers[id] = created;
  return created;
}

function trimProviderSources(providerStats) {
  const entries = Object.entries(providerStats?.sources || {});
  if (entries.length <= RELIABILITY_MAX_SOURCES_PER_PROVIDER) return;
  entries.sort((a, b) => {
    const aScore = Number(a[1]?.lastFailureAt || 0) + Number(a[1]?.lastSuccessAt || 0);
    const bScore = Number(b[1]?.lastFailureAt || 0) + Number(b[1]?.lastSuccessAt || 0);
    return bScore - aScore;
  });
  providerStats.sources = Object.fromEntries(entries.slice(0, RELIABILITY_MAX_SOURCES_PER_PROVIDER));
}

function getSourceReliability(providerId, sourceKey, create = false) {
  const providerStats = getProviderReliability(providerId, create);
  if (!providerStats) return null;
  const key = safeText(sourceKey);
  if (!key) return null;

  const existing = providerStats.sources[key];
  if (existing) return existing;
  if (!create) return null;
  const created = createEmptySourceReliability();
  providerStats.sources[key] = created;
  trimProviderSources(providerStats);
  return created;
}

function isProviderCircuitOpen(providerId) {
  const stats = getProviderReliability(providerId, false);
  if (!stats) return false;
  return Number(stats.breakerUntil || 0) > nowMs();
}

function buildProviderReliabilityPenalty(providerId) {
  const stats = getProviderReliability(providerId, false);
  if (!stats) return { penalty: 0, breakerOpen: false };

  const now = nowMs();
  const total = Number(stats.successes || 0) + Number(stats.failures || 0);
  const failRatio = total > 0 ? Number(stats.failures || 0) / total : 0;
  let penalty = 0;

  if (total >= RELIABILITY_MIN_SAMPLES) {
    penalty += failRatio * 22;
  }
  penalty += Math.min(Number(stats.consecutiveFailures || 0), 5) * 5;

  if (Number(stats.lastFailureAt || 0) > 0 && now - Number(stats.lastFailureAt || 0) < 30 * 60 * 1000) {
    penalty += 8;
  }

  const breakerOpen = Number(stats.breakerUntil || 0) > now;
  if (breakerOpen) {
    penalty += 80;
  }

  return { penalty: Math.round(penalty * 10) / 10, breakerOpen };
}

function buildSourceReliabilityPenalty(providerId, sourceKey) {
  const stats = getSourceReliability(providerId, sourceKey, false);
  if (!stats) return 0;
  const total = Number(stats.successes || 0) + Number(stats.failures || 0);
  const failRatio = total > 0 ? Number(stats.failures || 0) / total : 0;
  let penalty = 0;
  if (total >= 2) {
    penalty += failRatio * 14;
  }
  penalty += Math.min(Number(stats.consecutiveFailures || 0), 4) * 4;
  return Math.round(penalty * 10) / 10;
}

function registerPlaybackOutcome(providerId, sourceKey, success, reason = "") {
  const normalizedPid = normalizeProviderId(providerId);
  if (!normalizedPid) return;
  const now = nowMs();
  const providerStats = getProviderReliability(normalizedPid, true);
  if (!providerStats) return;

  if (success) {
    providerStats.successes += 1;
    providerStats.consecutiveFailures = 0;
    providerStats.lastSuccessAt = now;
    if (providerStats.breakerUntil > 0 && providerStats.breakerUntil < now) {
      providerStats.breakerUntil = 0;
    }
  } else {
    providerStats.failures += 1;
    providerStats.consecutiveFailures += 1;
    providerStats.lastFailureAt = now;
    providerStats.lastFailureReason = safeText(reason).slice(0, 180);
    if (providerStats.consecutiveFailures >= RELIABILITY_CIRCUIT_THRESHOLD) {
      const steps = Math.min(providerStats.consecutiveFailures - RELIABILITY_CIRCUIT_THRESHOLD + 1, 4);
      const cooldown = RELIABILITY_CIRCUIT_BASE_MS * steps;
      providerStats.breakerUntil = Math.max(providerStats.breakerUntil || 0, now + cooldown);
    }
  }

  const normalizedSourceKey = safeText(sourceKey);
  if (normalizedSourceKey) {
    const sourceStats = getSourceReliability(normalizedPid, normalizedSourceKey, true);
    if (sourceStats) {
      if (success) {
        sourceStats.successes += 1;
        sourceStats.consecutiveFailures = 0;
        sourceStats.lastSuccessAt = now;
      } else {
        sourceStats.failures += 1;
        sourceStats.consecutiveFailures += 1;
        sourceStats.lastFailureAt = now;
      }
    }
  }

  scheduleReliabilityPersist();
}

function extractStreamSourceKey(stream) {
  const { buildStreamSourceKey } = require("../utils");
  const direct = buildStreamSourceKey(stream?.infoHash);
  if (direct) return direct;

  const fromUrl = buildStreamSourceKey(stream?.url);
  if (fromUrl) return fromUrl;

  if (Array.isArray(stream?.sources)) {
    for (const value of stream.sources) {
      const fromSource = buildStreamSourceKey(value);
      if (fromSource) return fromSource;
    }
  }

  return "";
}

function applyReliabilityToProviderResult(result) {
  if (!result?.provider?.id) return result;
  const providerId = normalizeProviderId(result.provider.id);
  const providerPenaltyInfo = buildProviderReliabilityPenalty(providerId);
  if (providerPenaltyInfo.breakerOpen) {
    const stats = getProviderReliability(providerId, false);
    const until = Number(stats?.breakerUntil || 0);
    return {
      ...result,
      ok: false,
      error: `Circuit breaker activo para ${providerId} hasta ${new Date(until).toISOString()}.`,
      streams: []
    };
  }

  if (!result.ok || !Array.isArray(result.streams) || !result.streams.length) {
    return result;
  }

  const streams = result.streams.map((stream) => {
    const sourceKey = extractStreamSourceKey(stream);
    const sourcePenalty = buildSourceReliabilityPenalty(providerId, sourceKey);
    const reliabilityPenalty = Math.round((providerPenaltyInfo.penalty + sourcePenalty) * 10) / 10;

    return {
      ...stream,
      behaviorHints: {
        ...(stream?.behaviorHints || {}),
        reliabilityPenalty,
        reliabilityProviderPenalty: providerPenaltyInfo.penalty,
        reliabilitySourcePenalty: sourcePenalty,
        reliabilitySourceKey: sourceKey || undefined
      }
    };
  });

  return {
    ...result,
    streams
  };
}

function markSessionOutcome(session, success, reason = "") {
  if (!session || session.reliabilityOutcome !== "none") return;
  const providerId = safeText(session.providerId) ? normalizeProviderId(session.providerId) : "";
  if (!providerId) return;
  registerPlaybackOutcome(providerId, session.sourceKey, Boolean(success), reason);
  session.reliabilityOutcome = success ? "success" : "failure";
  session.reliabilityReason = safeText(reason).slice(0, 180);
}

function buildReliabilitySummary(limit = 20) {
  const now = nowMs();
  const providers = Object.entries(reliabilityState.providers || {})
    .map(([id, stats]) => {
      const total = Number(stats.successes || 0) + Number(stats.failures || 0);
      const failRatio = total > 0 ? Number(stats.failures || 0) / total : 0;
      const recentSources = Object.entries(stats.sources || {})
        .sort((a, b) => {
          const aTime = Number(a[1]?.lastFailureAt || 0) + Number(a[1]?.lastSuccessAt || 0);
          const bTime = Number(b[1]?.lastFailureAt || 0) + Number(b[1]?.lastSuccessAt || 0);
          return bTime - aTime;
        })
        .slice(0, 6)
        .map(([sourceKey, sourceStats]) => ({
          sourceKey,
          successes: Number(sourceStats.successes || 0),
          failures: Number(sourceStats.failures || 0),
          consecutiveFailures: Number(sourceStats.consecutiveFailures || 0),
          lastSuccessAt: Number(sourceStats.lastSuccessAt || 0) || null,
          lastFailureAt: Number(sourceStats.lastFailureAt || 0) || null
        }));

      return {
        id,
        successes: Number(stats.successes || 0),
        failures: Number(stats.failures || 0),
        total,
        failRatio: Number(failRatio.toFixed(3)),
        consecutiveFailures: Number(stats.consecutiveFailures || 0),
        breakerOpen: Number(stats.breakerUntil || 0) > now,
        breakerUntil: Number(stats.breakerUntil || 0) || null,
        lastSuccessAt: Number(stats.lastSuccessAt || 0) || null,
        lastFailureAt: Number(stats.lastFailureAt || 0) || null,
        lastFailureReason: safeText(stats.lastFailureReason) || null,
        sources: recentSources
      };
    })
    .sort((a, b) => {
      if (a.breakerOpen !== b.breakerOpen) return a.breakerOpen ? -1 : 1;
      return b.failures - a.failures;
    })
    .slice(0, Math.max(5, limit));

  return {
    loadedAt: reliabilityState.loadedAt,
    updatedAt: reliabilityState.updatedAt,
    config: {
      minSamples: RELIABILITY_MIN_SAMPLES,
      circuitThreshold: RELIABILITY_CIRCUIT_THRESHOLD,
      circuitBaseMs: RELIABILITY_CIRCUIT_BASE_MS
    },
    providers
  };
}

module.exports = {
  createEmptyProviderReliability,
  createEmptySourceReliability,
  getProviderReliability,
  getSourceReliability,
  isProviderCircuitOpen,
  buildProviderReliabilityPenalty,
  buildSourceReliabilityPenalty,
  registerPlaybackOutcome,
  extractStreamSourceKey,
  applyReliabilityToProviderResult,
  markSessionOutcome,
  buildReliabilitySummary
};
