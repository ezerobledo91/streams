const fs = require("fs");
const { safeText, normalizeProviderId } = require("../utils");
const { CONFIG_DIR, STREAM_RELIABILITY_FILE } = require("../config");
const { reliabilityState, getReliabilityPersistTimer, setReliabilityPersistTimer } = require("../state");

function scheduleReliabilityPersist() {
  reliabilityState.updatedAt = new Date().toISOString();
  if (getReliabilityPersistTimer()) return;
  setReliabilityPersistTimer(setTimeout(() => {
    setReliabilityPersistTimer(null);
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      const tmpFile = `${STREAM_RELIABILITY_FILE}.tmp`;
      fs.writeFileSync(
        tmpFile,
        JSON.stringify(
          {
            loadedAt: reliabilityState.loadedAt,
            updatedAt: reliabilityState.updatedAt,
            providers: reliabilityState.providers
          },
          null,
          2
        ),
        "utf8"
      );
      fs.renameSync(tmpFile, STREAM_RELIABILITY_FILE);
    } catch (error) {
      console.error("No se pudo persistir confiabilidad de streams:", error?.message || error);
    }
  }, 1200));
}

function loadReliabilityFromDisk() {
  const { createEmptyProviderReliability } = require("./tracker");
  try {
    if (!fs.existsSync(STREAM_RELIABILITY_FILE)) {
      reliabilityState.providers = {};
      reliabilityState.loadedAt = new Date().toISOString();
      reliabilityState.updatedAt = reliabilityState.loadedAt;
      return;
    }

    const rawText = fs.readFileSync(STREAM_RELIABILITY_FILE, "utf8").replace(/^\uFEFF/, "");
    const payload = JSON.parse(rawText);
    const rawProviders = payload && typeof payload === "object" ? payload.providers : {};
    const normalizedProviders = {};
    for (const [rawProviderId, rawProvider] of Object.entries(rawProviders || {})) {
      const providerId = normalizeProviderId(rawProviderId);
      const base = createEmptyProviderReliability();
      base.successes = Number(rawProvider?.successes || 0);
      base.failures = Number(rawProvider?.failures || 0);
      base.consecutiveFailures = Number(rawProvider?.consecutiveFailures || 0);
      base.lastSuccessAt = Number(rawProvider?.lastSuccessAt || 0);
      base.lastFailureAt = Number(rawProvider?.lastFailureAt || 0);
      base.lastFailureReason = safeText(rawProvider?.lastFailureReason);
      base.breakerUntil = Number(rawProvider?.breakerUntil || 0);

      const sourceMap = rawProvider?.sources && typeof rawProvider.sources === "object" ? rawProvider.sources : {};
      for (const [sourceKey, rawSource] of Object.entries(sourceMap)) {
        const normalizedSourceKey = safeText(sourceKey);
        if (!normalizedSourceKey) continue;
        base.sources[normalizedSourceKey] = {
          successes: Number(rawSource?.successes || 0),
          failures: Number(rawSource?.failures || 0),
          consecutiveFailures: Number(rawSource?.consecutiveFailures || 0),
          lastSuccessAt: Number(rawSource?.lastSuccessAt || 0),
          lastFailureAt: Number(rawSource?.lastFailureAt || 0)
        };
      }

      normalizedProviders[providerId] = base;
    }

    reliabilityState.providers = normalizedProviders;
    reliabilityState.loadedAt = safeText(payload?.loadedAt) || new Date().toISOString();
    reliabilityState.updatedAt = safeText(payload?.updatedAt) || reliabilityState.loadedAt;
  } catch (error) {
    reliabilityState.providers = {};
    reliabilityState.loadedAt = new Date().toISOString();
    reliabilityState.updatedAt = reliabilityState.loadedAt;
    console.error("No se pudo cargar confiabilidad de streams:", error?.message || error);
  }
}

module.exports = {
  scheduleReliabilityPersist,
  loadReliabilityFromDisk
};
