const { safeText, clamp } = require("../utils");
const { state } = require("../state");
const { isTmdbConfigured } = require("../tmdb/client");
const { fetchTmdbCatalogItems, fetchSourceCatalogItems, dedupeItems } = require("../catalog/fetcher");

function registerCatalogRoutes(app) {
  app.get("/api/catalog/browse", async (req, res) => {
    const category = safeText(req.query.category || "movie").toLowerCase();
    const validCategories = new Set(["movie", "series", "tv"]);
    if (!validCategories.has(category)) {
      return res.status(400).json({ error: "category debe ser movie, series o tv" });
    }

    const query = safeText(req.query.query);
    const genre = safeText(req.query.genre);
    const page = clamp(Number.parseInt(req.query.page, 10) || 1, 1, 25);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 60, 10, 120);
    const perSourceLimit = clamp(Number.parseInt(req.query.perSourceLimit, 10) || 20, 5, 40);

    let tmdbItems = [];
    try {
      tmdbItems = await fetchTmdbCatalogItems(category, query, page, Math.min(90, limit), genre);
    } catch {
      tmdbItems = [];
    }

    const activeCatalogSources = state.catalogSources.filter(
      (source) => source.active && (!source.categories.length || source.categories.includes(category))
    );

    const sourceItemsNested = genre
      ? []
      : await Promise.all(
          activeCatalogSources.map((source) => fetchSourceCatalogItems(source, category, query, page, perSourceLimit))
        );

    const sourceItems = sourceItemsNested.flat();
    const merged = dedupeItems([...tmdbItems, ...sourceItems], limit);

    return res.json({
      category,
      query,
      genre,
      page,
      limit,
      total: merged.length,
      items: merged,
      summary: {
        tmdbEnabled: isTmdbConfigured(),
        catalogSourcesQueried: activeCatalogSources.length,
        tmdbItems: tmdbItems.length,
        addonItems: sourceItems.length
      }
    });
  });
}

module.exports = { registerCatalogRoutes };
