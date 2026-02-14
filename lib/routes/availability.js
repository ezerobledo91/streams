const { resolveStreamRequest } = require("../meta/resolver");
const { state } = require("../state");
const { fetchJson } = require("../http");
const { isProviderCircuitOpen } = require("../reliability/tracker");

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 500;
const PROBE_TIMEOUT_MS = 2500;
const MAX_SOURCES_PER_ITEM = 2;

const availabilityCache = new Map();

function pruneCache() {
  if (availabilityCache.size <= MAX_CACHE) return;
  const entries = [...availabilityCache.entries()];
  entries.sort((a, b) => a[1].ts - b[1].ts);
  const toDelete = entries.slice(0, entries.length - MAX_CACHE);
  for (const [key] of toDelete) {
    availabilityCache.delete(key);
  }
}

async function checkSingleAvailability(type, itemId) {
  const cacheKey = `${type}:${itemId}`;
  const cached = availabilityCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const resolved = await resolveStreamRequest(type, itemId, "", "");
    const activeSources = state.streamSources
      .filter((s) => s.active && !isProviderCircuitOpen(s.id))
      .slice(0, MAX_SOURCES_PER_ITEM);

    if (!activeSources.length) {
      availabilityCache.set(cacheKey, { value: false, ts: Date.now() });
      return false;
    }

    const encodedType = encodeURIComponent(resolved.resolvedType);
    const encodedItemId = encodeURIComponent(resolved.resolvedItemId);

    const results = await Promise.allSettled(
      activeSources.map((source) => {
        const url = `${source.baseUrl}/stream/${encodedType}/${encodedItemId}.json`;
        return fetchJson(url, { timeoutMs: PROBE_TIMEOUT_MS });
      })
    );

    let available = false;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const streams = Array.isArray(result.value.streams) ? result.value.streams : [];
        if (streams.length > 0) {
          available = true;
          break;
        }
      }
    }

    availabilityCache.set(cacheKey, { value: available, ts: Date.now() });
    pruneCache();
    return available;
  } catch {
    return false;
  }
}

function registerAvailabilityRoutes(app) {
  app.post("/api/availability/batch", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
      if (!items.length) {
        return res.json({ results: {} });
      }

      const settledResults = await Promise.allSettled(
        items.map(async (item) => {
          const type = String(item.type || "movie");
          const itemId = String(item.itemId || "");
          if (!itemId) return { key: "", value: false };
          const value = await checkSingleAvailability(type, itemId);
          return { key: `${type}:${itemId}`, value };
        })
      );

      const results = {};
      for (const result of settledResults) {
        if (result.status === "fulfilled" && result.value.key) {
          results[result.value.key] = result.value.value;
        }
      }

      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || "Error interno") });
    }
  });
}

module.exports = { registerAvailabilityRoutes };
