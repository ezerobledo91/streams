const { safeText } = require("../utils");
const { TMDB_IMAGE_BASE } = require("../config");
const { manifestCache } = require("../state");
const { fetchJson } = require("../http");
const { isTmdbConfigured, getTmdbLanguage, getTmdbWatchRegion, fetchTmdb } = require("../tmdb/client");

function parseNumericRating(value) {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(",", "."));
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num > 10) return num / 10;
  return num;
}

function mapCategoryToAddonType(category) {
  const clean = safeText(category).toLowerCase();
  if (clean === "movie") return "movie";
  if (clean === "series") return "series";
  if (clean === "tv") return "tv";
  return null;
}

function mapCategoryToTmdbType(category) {
  if (category === "movie") return "movie";
  if (category === "series") return "tv";
  return null;
}

function mapTmdbTypeToAppType(tmdbType) {
  if (tmdbType === "movie") return "movie";
  if (tmdbType === "tv") return "series";
  return null;
}

function normalizeProviderId(value) {
  const raw = safeText(value);
  if (!/^\d+$/.test(raw)) return "";
  return String(Number.parseInt(raw, 10));
}

function mapTmdbProviderArray(entries, mode) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const id = normalizeProviderId(entry?.provider_id);
      if (!id) return null;
      return {
        id,
        name: safeText(entry?.provider_name) || "Proveedor",
        logo: safeText(entry?.logo_path) ? `${TMDB_IMAGE_BASE}${entry.logo_path}` : null,
        types: [mode]
      };
    })
    .filter(Boolean);
}

function extractTmdbWatchProviders(payload, region) {
  const results = payload && typeof payload === "object" ? payload.results : null;
  const byRegion = results && typeof results === "object"
    ? results[region] || results[region.toUpperCase()] || results[region.toLowerCase()] || null
    : null;
  if (!byRegion || typeof byRegion !== "object") return [];

  const buckets = [
    ...mapTmdbProviderArray(byRegion.flatrate, "flatrate"),
    ...mapTmdbProviderArray(byRegion.free, "free"),
    ...mapTmdbProviderArray(byRegion.ads, "ads"),
    ...mapTmdbProviderArray(byRegion.buy, "buy"),
    ...mapTmdbProviderArray(byRegion.rent, "rent")
  ];

  const map = new Map();
  for (const provider of buckets) {
    const existing = map.get(provider.id);
    if (!existing) {
      map.set(provider.id, provider);
      continue;
    }

    const types = new Set([...(existing.types || []), ...(provider.types || [])]);
    existing.types = [...types];
    if (!existing.logo && provider.logo) {
      existing.logo = provider.logo;
    }
  }

  return [...map.values()];
}

function findSearchParamName(extra) {
  if (!Array.isArray(extra)) return null;
  const preferred = ["search", "query", "term", "keyword", "q"];

  for (const target of preferred) {
    const match = extra.find((entry) => safeText(entry?.name).toLowerCase() === target);
    if (match) return safeText(match.name);
  }

  return null;
}

async function loadManifest(source, force = false, timeoutMs = 10000) {
  const cacheKey = source.manifestUrl;
  const now = Date.now();
  const cached = manifestCache.get(cacheKey);

  if (!force && cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const payload = await fetchJson(source.manifestUrl, { timeoutMs });
  manifestCache.set(cacheKey, {
    payload,
    expiresAt: now + 15 * 60 * 1000
  });

  return payload;
}

function pickCatalogs(manifest, category, query) {
  const addonType = mapCategoryToAddonType(category);
  if (!addonType) return [];

  const catalogs = Array.isArray(manifest?.catalogs)
    ? manifest.catalogs.filter((catalog) => safeText(catalog?.type).toLowerCase() === addonType)
    : [];

  if (!query) {
    return catalogs.slice(0, 2);
  }

  const searchable = catalogs.filter((catalog) => findSearchParamName(catalog?.extra));
  return (searchable.length ? searchable : catalogs).slice(0, 2);
}

function buildCatalogUrl(source, category, catalogId, query = {}) {
  const addonType = mapCategoryToAddonType(category);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    const clean = safeText(value);
    if (!clean) continue;
    params.set(key, clean);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${source.baseUrl}/catalog/${encodeURIComponent(addonType)}/${encodeURIComponent(catalogId)}.json${suffix}`;
}

function normalizeCatalogItem(meta, category, source, catalogId) {
  const id = safeText(meta?.id);
  const name = safeText(meta?.name || meta?.title) || "Sin titulo";
  const year = safeText(meta?.year) || null;
  const rating = parseNumericRating(meta?.imdbRating) ?? parseNumericRating(meta?.rating);

  return {
    id: id || `${source.id}:${catalogId}:${name}`,
    type: category,
    name,
    year,
    poster: safeText(meta?.poster) || null,
    background: safeText(meta?.background) || null,
    description: safeText(meta?.description) || null,
    rating: rating ? Number(rating.toFixed(1)) : null,
    source: {
      kind: "catalog-addon",
      id: source.id,
      name: source.name,
      catalogId
    },
    raw: meta
  };
}

function buildTmdbItem(entry, tmdbType) {
  const appType = mapTmdbTypeToAppType(tmdbType);
  const title = safeText(entry?.title || entry?.name) || "Sin titulo";
  const date = safeText(entry?.release_date || entry?.first_air_date);

  return {
    id: `tmdb:${tmdbType}:${entry.id}`,
    type: appType,
    name: title,
    year: date ? date.slice(0, 4) : null,
    poster: entry?.poster_path ? `${TMDB_IMAGE_BASE}${entry.poster_path}` : null,
    background: entry?.backdrop_path ? `${TMDB_IMAGE_BASE}${entry.backdrop_path}` : null,
    description: safeText(entry?.overview) || null,
    rating: parseNumericRating(entry?.vote_average),
    source: {
      kind: "tmdb",
      id: "tmdb",
      name: "TMDB"
    },
    raw: entry
  };
}

async function attachTmdbAvailability(items, tmdbType, options = {}) {
  const includeAvailability = Boolean(options.includeAvailability);
  const providerFilterId = normalizeProviderId(options.providerId);
  if (!includeAvailability && !providerFilterId) {
    return items;
  }

  const region = safeText(options.watchRegion || getTmdbWatchRegion()).toUpperCase() || "US";
  const concurrency = 8;
  const input = Array.isArray(items) ? items : [];
  const output = new Array(input.length);
  let cursor = 0;

  async function worker() {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      const item = input[index];
      if (!item || !item.raw || !item.raw.id) {
        output[index] = item;
        continue;
      }

      let providers = [];
      try {
        const payload = await fetchTmdb(`/${tmdbType}/${item.raw.id}/watch/providers`);
        providers = extractTmdbWatchProviders(payload, region);
      } catch {
        providers = [];
      }

      if (providerFilterId && !providers.some((provider) => provider.id === providerFilterId)) {
        output[index] = null;
        continue;
      }

      if (includeAvailability || providerFilterId) {
        output[index] = {
          ...item,
          availability: {
            region,
            providers
          }
        };
      } else {
        output[index] = item;
      }
    }
  }

  const workers = [];
  const workerCount = Math.max(1, Math.min(concurrency, input.length));
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return output.filter(Boolean);
}

function dedupeItems(items, limit) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const idKey = safeText(item?.id).toLowerCase();
    const nameKey = safeText(item?.name).toLowerCase();
    const yearKey = safeText(item?.year);
    const typeKey = safeText(item?.type).toLowerCase();
    const key = idKey || `${typeKey}:${nameKey}:${yearKey}`;
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}

async function fetchTmdbCatalogItems(category, query, page, limit, genreId = "", year = "", options = {}) {
  const tmdbType = mapCategoryToTmdbType(category);
  if (!tmdbType || !isTmdbConfigured()) {
    return [];
  }

  const language = getTmdbLanguage();
  const normalizedGenre = safeText(genreId);
  const normalizedYear = safeText(year);
  const hasValidYear = /^\d{4}$/.test(normalizedYear);
  const includeAvailability = Boolean(options.includeAvailability);
  const providerFilterId = normalizeProviderId(options.providerId);
  const watchRegion = safeText(options.watchRegion || getTmdbWatchRegion()).toUpperCase() || "US";
  const hasValidGenre = Boolean(normalizedGenre && /^\d+$/.test(normalizedGenre));
  const shouldUseDiscover = hasValidGenre || hasValidYear || (providerFilterId && !query);

  function filterByYear(items) {
    if (!hasValidYear) return items;
    return items.filter((item) => safeText(item?.year) === normalizedYear);
  }

  async function finalize(entries) {
    const normalized = dedupeItems(
      filterByYear(entries.map((entry) => buildTmdbItem(entry, tmdbType))),
      limit
    );
    return attachTmdbAvailability(normalized, tmdbType, {
      includeAvailability,
      providerId: providerFilterId,
      watchRegion
    });
  }

  if (shouldUseDiscover) {
    const discoverPath = tmdbType === "movie" ? "/discover/movie" : "/discover/tv";
    const merged = [];
    const pagesToLoad = [page, Math.min(500, page + 1)];

    for (const tmdbPage of pagesToLoad) {
      const discoverQuery = {
        language,
        page: String(tmdbPage),
        include_adult: "false",
        sort_by: "popularity.desc"
      };
      if (hasValidGenre) {
        discoverQuery.with_genres = normalizedGenre;
      }
      if (hasValidYear) {
        if (tmdbType === "movie") {
          discoverQuery.primary_release_year = normalizedYear;
        } else {
          discoverQuery.first_air_date_year = normalizedYear;
        }
      }
      if (providerFilterId) {
        discoverQuery.watch_region = watchRegion;
        discoverQuery.with_watch_providers = providerFilterId;
        discoverQuery.with_watch_monetization_types = "flatrate|free|ads";
      }

      const payload = await fetchTmdb(discoverPath, {
        ...discoverQuery
      });
      const results = Array.isArray(payload?.results) ? payload.results : [];
      merged.push(...results);
      if (merged.length >= Math.max(limit * 2, 180)) {
        break;
      }
    }

    return finalize(merged);
  }

  if (query) {
    const searchQuery = {
      query,
      language,
      page: String(page),
      include_adult: "false"
    };
    if (hasValidYear) {
      if (tmdbType === "movie") {
        searchQuery.year = normalizedYear;
      } else {
        searchQuery.first_air_date_year = normalizedYear;
      }
    }
    const payload = await fetchTmdb(`/search/${tmdbType}`, searchQuery);

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const sliced = results.slice(0, Math.max(limit * 2, 120));
    return finalize(sliced);
  }

  const paths =
    tmdbType === "movie"
      ? ["/trending/movie/week", "/movie/popular", "/movie/top_rated", "/movie/now_playing"]
      : ["/trending/tv/week", "/tv/popular", "/tv/top_rated", "/tv/on_the_air"];

  const merged = [];
  const pagesToLoad = [page, Math.min(500, page + 1)];
  for (const pathName of paths) {
    for (const tmdbPage of pagesToLoad) {
      const payload = await fetchTmdb(pathName, {
        language,
        page: String(tmdbPage)
      });

      const results = Array.isArray(payload?.results) ? payload.results : [];
      merged.push(...results);
      if (merged.length >= Math.max(limit * 2, 180)) {
        break;
      }
    }

    if (merged.length >= Math.max(limit * 2, 180)) {
      break;
    }
  }

  return finalize(merged);
}

async function fetchSourceCatalogItems(source, category, query, page, perSourceLimit, options = {}) {
  const manifestTimeoutMs = Number(options.manifestTimeoutMs || 9000);
  const catalogTimeoutMs = Number(options.catalogTimeoutMs || 9000);
  const maxCatalogs = Number(options.maxCatalogs || 2);

  try {
    const manifest = await loadManifest(source, false, manifestTimeoutMs);
    const catalogs = pickCatalogs(manifest, category, query).slice(0, Math.max(1, maxCatalogs));
    if (!catalogs.length) return [];

    const skipAmount = (page - 1) * perSourceLimit;
    const settled = await Promise.allSettled(
      catalogs.map(async (catalog) => {
        const catalogId = safeText(catalog?.id);
        if (!catalogId) return [];

        const requestQuery = {};
        const searchParam = findSearchParamName(catalog?.extra);
        if (query && searchParam) {
          requestQuery[searchParam] = query;
        }
        requestQuery.skip = String(skipAmount);

        const url = buildCatalogUrl(source, category, catalogId, requestQuery);
        const payload = await fetchJson(url, { timeoutMs: catalogTimeoutMs });
        const metas = Array.isArray(payload?.metas) ? payload.metas.slice(0, perSourceLimit) : [];
        return metas.map((meta) => normalizeCatalogItem(meta, category, source, catalogId));
      })
    );

    const items = [];
    for (const entry of settled) {
      if (entry.status !== "fulfilled" || !Array.isArray(entry.value)) continue;
      items.push(...entry.value);
    }
    return items;
  } catch {
    return [];
  }
}

module.exports = {
  parseNumericRating,
  loadManifest,
  dedupeItems,
  fetchTmdbCatalogItems,
  fetchSourceCatalogItems
};
