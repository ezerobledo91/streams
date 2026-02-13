const path = require("path");
const { safeText } = require("../utils");
const { SUBTITLE_PROVIDER_TIMEOUT_MS, SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS } = require("../config");
const { fetchJson } = require("../http");
const { sanitizeSubtitleProxyExtension, normalizeSubtitleExtension } = require("./converter");
const { subtitleLabelForLanguage } = require("./detector");

function getSubtitleFallbackLanguages() {
  const raw = safeText(process.env.SUBTITLE_LANGS || process.env.SUBDL_LANGS || "ES");
  const out = raw
    .split(/[,\s]+/)
    .map((item) => safeText(item).toUpperCase())
    .filter(Boolean);

  return out.length ? out.join(",") : "ES";
}

function getOpenSubtitlesApiKey() {
  return safeText(process.env.OPEN_SUBTITLES_API_KEY || process.env.OPENSUBTITLES_API_KEY);
}

function getOpenSubtitlesUserAgent() {
  const fromEnv = safeText(process.env.OPEN_SUBTITLES_USER_AGENT);
  if (fromEnv) return fromEnv;
  const appName = safeText(process.env.TMDB_NAME_APP || "streams_app");
  return appName.includes(" v") ? appName : `${appName} v1.0`;
}

function getOpenSubtitlesHeaders() {
  const apiKey = getOpenSubtitlesApiKey();
  if (!apiKey) return null;
  return {
    "api-key": apiKey,
    "user-agent": getOpenSubtitlesUserAgent()
  };
}

function getOpenSubtitlesLanguageQuery() {
  const raw = getSubtitleFallbackLanguages();
  const values = raw
    .split(",")
    .map((item) => safeText(item).toLowerCase())
    .map((item) => {
      if (!item) return "";
      if (item === "es-419" || item === "es_la" || item === "es-la") return "es";
      return item.includes("-") ? item.split("-")[0] : item;
    })
    .filter(Boolean);
  const deduped = [...new Set(values)];
  return deduped.length ? deduped.join(",") : "es,en";
}

function parseImdbNumericId(rawItemId) {
  const base = safeText(rawItemId).split(":")[0].toLowerCase();
  if (/^tt\d+$/i.test(base)) return base.slice(2);
  if (/^\d+$/.test(base)) return base;
  return "";
}

function mapResolvedTypeToSubdl(type) {
  const clean = safeText(type).toLowerCase();
  if (clean === "series" || clean === "tv") return "tv";
  return "movie";
}

function normalizeSubdlUrl(value) {
  const raw = safeText(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://dl.subdl.com${raw}`;
  return `https://dl.subdl.com/${raw.replace(/^\/+/, "")}`;
}

function resolveAddonUrl(baseUrl, rawUrl) {
  const value = safeText(rawUrl);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  try {
    return new URL(value, `${safeText(baseUrl).replace(/\/+$/, "")}/`).toString();
  } catch {
    return "";
  }
}

function extractSubtitleLanguage(subtitle) {
  const candidates = [
    subtitle?.lang,
    subtitle?.language,
    subtitle?.locale,
    subtitle?.country
  ];

  for (const candidate of candidates) {
    const value = safeText(candidate).toLowerCase();
    if (!value) continue;
    if (value.includes("latin")) return "es-419";
    if (value.includes("latam")) return "es-419";
    if (value.includes("es-la")) return "es-419";
    if (value === "spa") return "es";
    if (value === "eng") return "en";
    if (value.includes("-")) return value.split("-")[0];
    return value;
  }

  return "und";
}

function isSpanishSubtitleLanguage(value) {
  const lang = safeText(value).toLowerCase();
  if (!lang) return false;
  if (lang === "es" || lang === "spa") return true;
  if (lang === "es-419" || lang === "es_la" || lang === "es-la") return true;
  if (lang.startsWith("es-")) return true;
  return false;
}

function normalizeSubtitleEntry(subtitle, source, index, req = null) {
  const externalUrl = resolveAddonUrl(source.baseUrl, subtitle?.url);
  if (!externalUrl) return null;

  const language = extractSubtitleLanguage(subtitle);
  const fileName = safeText(subtitle?.id || subtitle?.subFilename || subtitle?.name || subtitle?.title);
  const extensionFromName = path.extname(fileName || "").toLowerCase();
  const extensionFromUrl = path.extname(new URL(externalUrl).pathname || "").toLowerCase();
  const rawExt = subtitle?.format || subtitle?.ext || extensionFromName || extensionFromUrl || ".vtt";
  const blocked = [".rar", ".7z"];
  if (blocked.includes(normalizeSubtitleExtension(rawExt))) return null;
  const extension = sanitizeSubtitleProxyExtension(rawExt, ".srt");
  const labelSource = safeText(subtitle?.label || subtitle?.title || subtitle?.name || fileName);
  const label = labelSource || `${subtitleLabelForLanguage(language)} #${index + 1}`;

  const proxyPath = `/api/subtitles/proxy?url=${encodeURIComponent(externalUrl)}&ext=${encodeURIComponent(extension)}`;
  return {
    id: `${source.id}-${index}`,
    providerId: source.id,
    providerName: source.name,
    label,
    language,
    extension,
    url: proxyPath
  };
}

function dedupeSubtitles(items, limit = 40) {
  const out = [];
  const seen = new Set();

  for (const item of items) {
    if (!item) continue;
    const key = `${safeText(item.language).toLowerCase()}|${safeText(item.label).toLowerCase()}|${safeText(item.url).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}

async function fetchProviderSubtitles(source, resolvedType, resolvedItemId, req) {
  const url = `${source.baseUrl}/subtitles/${encodeURIComponent(resolvedType)}/${encodeURIComponent(resolvedItemId)}.json`;

  try {
    let payload;
    try {
      payload = await fetchJson(url, {
        timeoutMs: SUBTITLE_PROVIDER_TIMEOUT_MS,
        headers: {
          "user-agent": "streams-mvp/1.0"
        }
      });
    } catch (firstError) {
      const firstMessage = safeText(firstError?.message).toLowerCase();
      const shouldTryRedirectFallback =
        firstMessage.includes("http 30") ||
        firstMessage.includes("redirect") ||
        firstMessage.includes("unexpected token") ||
        firstMessage.includes("json");

      if (!shouldTryRedirectFallback) {
        throw firstError;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS);
      let text = "";
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json,text/plain,*/*",
            "user-agent": "streams-mvp/1.0"
          }
        });
        text = await response.text();
      } finally {
        clearTimeout(timeout);
      }
      const redirectMatch = text.match(/Redirecting to\s+(https?:\/\/\S+)/i);
      if (!redirectMatch?.[1]) {
        throw firstError;
      }

      payload = await fetchJson(redirectMatch[1], {
        timeoutMs: SUBTITLE_PROVIDER_TIMEOUT_MS,
        headers: {
          "user-agent": "streams-mvp/1.0"
        }
      });
    }

    const subtitles = Array.isArray(payload?.subtitles) ? payload.subtitles : [];
    const normalized = subtitles
      .map((subtitle, index) => normalizeSubtitleEntry(subtitle, source, index, req))
      .filter(Boolean);

    return {
      provider: {
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        manifestUrl: source.manifestUrl
      },
      ok: true,
      subtitles: normalized
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
      error: error?.message || "No se pudieron cargar subtitulos.",
      subtitles: []
    };
  }
}

async function fetchSubdlExternalSubtitles(resolvedType, resolvedItemId, season, episode, req) {
  const apiKey = safeText(process.env.SUBDL_API_KEY);
  if (!apiKey) {
    return null;
  }

  const imdbId = safeText(resolvedItemId).split(":")[0].toLowerCase();
  if (!/^tt\d+$/i.test(imdbId)) {
    return null;
  }

  const url = new URL("https://api.subdl.com/api/v1/subtitles");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("type", mapResolvedTypeToSubdl(resolvedType));
  url.searchParams.set("imdb_id", imdbId);
  url.searchParams.set("languages", getSubtitleFallbackLanguages());

  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  if (mapResolvedTypeToSubdl(resolvedType) === "tv") {
    if (Number.isFinite(seasonNum) && seasonNum > 0) url.searchParams.set("season_number", String(seasonNum));
    if (Number.isFinite(episodeNum) && episodeNum > 0) url.searchParams.set("episode_number", String(episodeNum));
  }

  try {
    const payload = await fetchJson(url.toString(), { timeoutMs: 12000 });
    const rawList = Array.isArray(payload?.subtitles) ? payload.subtitles : [];
    const subtitles = rawList
      .map((subtitle, index) => {
        const externalUrl = normalizeSubdlUrl(
          subtitle?.url ||
            subtitle?.link ||
            subtitle?.download_url ||
            subtitle?.download ||
            subtitle?.downloadLink ||
            subtitle?.path
        );
        if (!externalUrl) return null;

        const language = extractSubtitleLanguage(subtitle);
        const extension = sanitizeSubtitleProxyExtension(
          subtitle?.format || subtitle?.ext || path.extname(new URL(externalUrl).pathname || "") || ".zip",
          ".zip"
        );
        const proxyPath = `/api/subtitles/proxy?url=${encodeURIComponent(externalUrl)}&ext=${encodeURIComponent(extension)}`;

        return {
          id: `subdl-${index}`,
          providerId: "subdl",
          providerName: "SubDL",
          label: safeText(subtitle?.release_name || subtitle?.name || subtitle?.filename || subtitle?.lang || "SubDL"),
          language: language || "und",
          extension,
          url: proxyPath
        };
      })
      .filter(Boolean);

    return {
      provider: {
        id: "subdl",
        name: "SubDL",
        baseUrl: "https://api.subdl.com/api/v1/subtitles",
        manifestUrl: "https://subdl.com"
      },
      ok: true,
      subtitles
    };
  } catch (error) {
    return {
      provider: {
        id: "subdl",
        name: "SubDL",
        baseUrl: "https://api.subdl.com/api/v1/subtitles",
        manifestUrl: "https://subdl.com"
      },
      ok: false,
      error: error?.message || "No se pudieron cargar subtitulos externos.",
      subtitles: []
    };
  }
}

async function fetchOpenSubtitlesExternalSubtitles(resolvedType, resolvedItemId, season, episode, req) {
  const headers = getOpenSubtitlesHeaders();
  if (!headers) return null;

  const imdbId = parseImdbNumericId(resolvedItemId);
  if (!imdbId) return null;

  const url = new URL("https://api.opensubtitles.com/api/v1/subtitles");
  url.searchParams.set("imdb_id", imdbId);
  url.searchParams.set("languages", getOpenSubtitlesLanguageQuery());
  url.searchParams.set("order_by", "download_count");
  url.searchParams.set("order_direction", "desc");

  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  const mappedType = mapResolvedTypeToSubdl(resolvedType);
  if (mappedType === "tv") {
    if (Number.isFinite(seasonNum) && seasonNum > 0) url.searchParams.set("season_number", String(seasonNum));
    if (Number.isFinite(episodeNum) && episodeNum > 0) url.searchParams.set("episode_number", String(episodeNum));
  }

  try {
    const payload = await fetchJson(url.toString(), {
      timeoutMs: 12000,
      headers
    });
    const rawList = Array.isArray(payload?.data) ? payload.data : [];
    const subtitles = rawList
      .slice(0, 30)
      .map((item, index) => {
        const attrs = item?.attributes || {};
        const files = Array.isArray(attrs?.files) ? attrs.files : [];
        const file = files[0] || {};
        const fileId = safeText(file?.file_id || attrs?.file_id || attrs?.subtitle_id);
        if (!/^\d+$/.test(fileId)) return null;

        const fileName = safeText(file?.file_name || attrs?.release || `opensubtitles-${fileId}.srt`);
        const extension = sanitizeSubtitleProxyExtension(path.extname(fileName) || ".srt", ".srt");
        const language = extractSubtitleLanguage({
          lang: attrs?.language,
          language: attrs?.language
        });
        const label =
          safeText(attrs?.release || attrs?.feature_details?.movie_name || attrs?.url || `OpenSubtitles ${fileId}`);

        const proxyPath = `/api/subtitles/opensubtitles/file/${encodeURIComponent(fileId)}?ext=${encodeURIComponent(extension)}`;
        return {
          id: `opensub-${safeText(item?.id || fileId)}-${index}`,
          providerId: "opensubtitles-api",
          providerName: "OpenSubtitles API",
          label,
          language: language || "und",
          extension,
          url: proxyPath
        };
      })
      .filter(Boolean);

    return {
      provider: {
        id: "opensubtitles-api",
        name: "OpenSubtitles API",
        baseUrl: "https://api.opensubtitles.com/api/v1",
        manifestUrl: "https://api.opensubtitles.com/api/v1/subtitles"
      },
      ok: true,
      subtitles
    };
  } catch (error) {
    return {
      provider: {
        id: "opensubtitles-api",
        name: "OpenSubtitles API",
        baseUrl: "https://api.opensubtitles.com/api/v1",
        manifestUrl: "https://api.opensubtitles.com/api/v1/subtitles"
      },
      ok: false,
      error: error?.message || "No se pudieron cargar subtitulos de OpenSubtitles.",
      subtitles: []
    };
  }
}

module.exports = {
  getSubtitleFallbackLanguages,
  getOpenSubtitlesApiKey,
  getOpenSubtitlesHeaders,
  getOpenSubtitlesLanguageQuery,
  extractSubtitleLanguage,
  isSpanishSubtitleLanguage,
  normalizeSubtitleEntry,
  dedupeSubtitles,
  fetchProviderSubtitles,
  fetchSubdlExternalSubtitles,
  fetchOpenSubtitlesExternalSubtitles
};
