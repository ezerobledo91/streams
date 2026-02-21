const { safeText, clamp } = require("../utils");
const { state } = require("../state");
const { isTmdbConfigured } = require("../tmdb/client");
const { fetchTmdbCatalogItems, fetchSourceCatalogItems, dedupeItems } = require("../catalog/fetcher");

const CATALOG_BROWSE_CACHE_TTL_MS = 90 * 1000;
const CATALOG_BROWSE_CACHE_MAX_ITEMS = 320;
const CATALOG_QUERY_MAX_SOURCES = 2;
const CATALOG_QUERY_MAX_CATALOGS_PER_SOURCE = 1;
const CATALOG_QUERY_SOURCE_TIMEOUT_MS = 4500;
const CATALOG_QUERY_TMDB_TIMEOUT_MS = 8000;
const catalogBrowseCache = new Map();

async function withTimeout(task, timeoutMs, fallbackValue) {
  let timeoutHandle = null;
  const safeTask = Promise.resolve(task).catch(() => fallbackValue);
  const timeoutTask = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallbackValue), Math.max(500, timeoutMs));
  });

  try {
    return await Promise.race([safeTask, timeoutTask]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function parseYearValue(rawValue) {
  const value = safeText(rawValue);
  if (!/^\d{4}$/.test(value)) return "";
  const year = Number.parseInt(value, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return "";
  return String(year);
}

function parseProviderValue(rawValue) {
  const value = safeText(rawValue);
  if (!/^\d+$/.test(value)) return "";
  return String(Number.parseInt(value, 10));
}

function buildCatalogBrowseCacheKey({
  category,
  query,
  genre,
  year,
  page,
  limit,
  perSourceLimit,
  provider,
  includeAvailability,
  loadedAt
}) {
  return [
    safeText(category).toLowerCase(),
    safeText(query).toLowerCase(),
    safeText(genre).toLowerCase(),
    safeText(year),
    String(page),
    String(limit),
    String(perSourceLimit),
    safeText(provider),
    String(Boolean(includeAvailability)),
    safeText(loadedAt)
  ].join("|");
}

function pruneCatalogBrowseCache(nowMs) {
  for (const [key, entry] of catalogBrowseCache.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= nowMs) {
      catalogBrowseCache.delete(key);
    }
  }

  if (catalogBrowseCache.size <= CATALOG_BROWSE_CACHE_MAX_ITEMS) return;

  const ordered = [...catalogBrowseCache.entries()].sort(
    (a, b) => Number(a?.[1]?.cachedAt || 0) - Number(b?.[1]?.cachedAt || 0)
  );
  const overflow = catalogBrowseCache.size - CATALOG_BROWSE_CACHE_MAX_ITEMS;
  for (let index = 0; index < overflow; index += 1) {
    const victim = ordered[index];
    if (!victim) break;
    catalogBrowseCache.delete(victim[0]);
  }
}

function registerCatalogRoutes(app) {
  app.get("/api/catalog/browse", async (req, res) => {
    const category = safeText(req.query.category || "movie").toLowerCase();
    const validCategories = new Set(["movie", "series", "tv"]);
    if (!validCategories.has(category)) {
      return res.status(400).json({ error: "category debe ser movie, series o tv" });
    }

    const query = safeText(req.query.query);
    const genre = safeText(req.query.genre);
    const year = parseYearValue(req.query.year);
    const provider = parseProviderValue(req.query.provider);
    const includeAvailability = safeText(req.query.includeAvailability).toLowerCase() === "true";
    const page = clamp(Number.parseInt(req.query.page, 10) || 1, 1, 25);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 60, 10, 120);
    const perSourceLimit = clamp(Number.parseInt(req.query.perSourceLimit, 10) || 20, 5, 40);
    const now = Date.now();
    const cacheKey = buildCatalogBrowseCacheKey({
      category,
      query,
      genre,
      year,
      page,
      limit,
      perSourceLimit,
      provider,
      includeAvailability,
      loadedAt: state.loadedAt
    });
    const cached = catalogBrowseCache.get(cacheKey);
    if (cached && Number(cached.expiresAt || 0) > now) {
      return res.json({
        ...cached.payload,
        cache: {
          hit: true,
          ttlMs: CATALOG_BROWSE_CACHE_TTL_MS,
          ageMs: now - Number(cached.cachedAt || now)
        }
      });
    }

    const hasQuery = Boolean(query);
    const tmdbTimeoutMs = includeAvailability
      ? (hasQuery ? 16000 : 26000)
      : (hasQuery ? CATALOG_QUERY_TMDB_TIMEOUT_MS : 12000);
    const tmdbItems = await withTimeout(
      fetchTmdbCatalogItems(category, query, page, Math.min(90, limit), genre, year, {
        providerId: provider,
        includeAvailability
      }),
      tmdbTimeoutMs,
      []
    );

    const activeCatalogSources = state.catalogSources.filter(
      (source) => source.active && (!source.categories.length || source.categories.includes(category))
    );
    const catalogSourcesToQuery = hasQuery
      ? activeCatalogSources.slice(0, CATALOG_QUERY_MAX_SOURCES)
      : activeCatalogSources;

    const sourceItemsNested = genre || provider || includeAvailability
      ? []
      : await Promise.all(
          catalogSourcesToQuery.map((source) =>
            withTimeout(
              fetchSourceCatalogItems(source, category, query, page, perSourceLimit, {
                maxCatalogs: hasQuery ? CATALOG_QUERY_MAX_CATALOGS_PER_SOURCE : 2,
                manifestTimeoutMs: hasQuery ? CATALOG_QUERY_SOURCE_TIMEOUT_MS : 9000,
                catalogTimeoutMs: hasQuery ? CATALOG_QUERY_SOURCE_TIMEOUT_MS : 9000
              }),
              hasQuery ? CATALOG_QUERY_SOURCE_TIMEOUT_MS + 700 : 10000,
              []
            )
          )
        );

    const sourceItems = sourceItemsNested
      .flat()
      .filter((item) => {
        if (!year) return true;
        const itemYear = safeText(item?.year);
        return itemYear === year;
      });
    const merged = dedupeItems([...tmdbItems, ...sourceItems], limit);
    const payload = {
      category,
      query,
      genre,
      provider,
      year,
      page,
      limit,
      total: merged.length,
      items: merged,
      summary: {
        tmdbEnabled: isTmdbConfigured(),
        catalogSourcesQueried: catalogSourcesToQuery.length,
        tmdbItems: tmdbItems.length,
        addonItems: sourceItems.length,
        includeAvailability
      }
    };

    catalogBrowseCache.set(cacheKey, {
      payload,
      cachedAt: now,
      expiresAt: now + CATALOG_BROWSE_CACHE_TTL_MS
    });
    pruneCatalogBrowseCache(now);

    return res.json({
      ...payload,
      cache: {
        hit: false,
        ttlMs: CATALOG_BROWSE_CACHE_TTL_MS,
        ageMs: 0
      }
    });
  });
}

module.exports = { registerCatalogRoutes };
