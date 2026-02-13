const { safeText, clamp, normalizeProviderId } = require("../utils");
const { reliabilityState } = require("../state");
const { scheduleReliabilityPersist } = require("../reliability/persistence");
const { buildReliabilitySummary, getProviderReliability } = require("../reliability/tracker");

function registerReliabilityRoutes(app) {
  app.get("/api/streams/reliability", (req, res) => {
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 20, 5, 100);
    return res.json(buildReliabilitySummary(limit));
  });

  app.post("/api/streams/reliability/reset", (req, res) => {
    const providerIdRaw = safeText(req.body?.providerId || req.query.providerId);
    const providerId = providerIdRaw ? normalizeProviderId(providerIdRaw) : "";
    const sourceKey = safeText(req.body?.sourceKey || req.query.sourceKey);

    let mode = "all";
    if (!providerId) {
      reliabilityState.providers = {};
    } else if (!sourceKey) {
      delete reliabilityState.providers[providerId];
      mode = "provider";
    } else {
      const providerStats = getProviderReliability(providerId, false);
      if (providerStats?.sources) {
        delete providerStats.sources[sourceKey];
      }
      mode = "source";
    }

    reliabilityState.updatedAt = new Date().toISOString();
    scheduleReliabilityPersist();
    return res.json({
      ok: true,
      mode,
      providerId: providerId || null,
      sourceKey: sourceKey || null
    });
  });
}

module.exports = { registerReliabilityRoutes };
