const fs = require("fs");
const { safeText, normalizeManifestUrl, deriveBaseUrlFromManifestUrl } = require("../utils");
const {
  CONFIG_DIR,
  CATALOG_SOURCES_FILE,
  STREAM_SOURCES_FILE,
  SUBTITLE_SOURCES_CANDIDATES,
  DEFAULT_CATALOG_SOURCES,
  DEFAULT_STREAM_SOURCES,
  DEFAULT_SUBTITLE_SOURCES
} = require("../config");
const { state, manifestCache } = require("../state");

function ensureConfigFiles() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(CATALOG_SOURCES_FILE)) {
    fs.writeFileSync(CATALOG_SOURCES_FILE, JSON.stringify(DEFAULT_CATALOG_SOURCES, null, 2));
  }

  if (!fs.existsSync(STREAM_SOURCES_FILE)) {
    fs.writeFileSync(STREAM_SOURCES_FILE, JSON.stringify(DEFAULT_STREAM_SOURCES, null, 2));
  }

  const subtitleFile = SUBTITLE_SOURCES_CANDIDATES.find((filePath) => fs.existsSync(filePath));
  if (!subtitleFile) {
    fs.writeFileSync(SUBTITLE_SOURCES_CANDIDATES[0], JSON.stringify(DEFAULT_SUBTITLE_SOURCES, null, 2));
  }
}

function getSubtitleSourcesFilePath() {
  return SUBTITLE_SOURCES_CANDIDATES.find((filePath) => fs.existsSync(filePath)) || SUBTITLE_SOURCES_CANDIDATES[0];
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function normalizeCategories(rawCategories) {
  if (!Array.isArray(rawCategories)) return [];
  const allowed = new Set(["movie", "series", "tv"]);
  const out = [];

  for (const value of rawCategories) {
    const clean = safeText(value).toLowerCase();
    if (allowed.has(clean) && !out.includes(clean)) {
      out.push(clean);
    }
  }

  return out;
}

function normalizeSourceList(raw, role) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.providers) ? raw.providers : [];

  return list
    .map((entry, index) => {
      const manifestUrl = normalizeManifestUrl(entry?.manifestUrl || entry?.url);
      if (!manifestUrl) return null;

      const baseUrl = deriveBaseUrlFromManifestUrl(manifestUrl);
      if (!baseUrl) return null;

      const id =
        safeText(entry?.id) ||
        `${role}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;

      const priority = Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : 100;

      return {
        id,
        name: safeText(entry?.name) || id,
        manifestUrl,
        baseUrl,
        active: Boolean(entry?.active ?? true),
        priority,
        categories: normalizeCategories(entry?.categories)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);
}

function loadSourcesFromDisk() {
  ensureConfigFiles();

  const catalogRaw = readJsonFile(CATALOG_SOURCES_FILE);
  const streamRaw = readJsonFile(STREAM_SOURCES_FILE);
  const subtitleRaw = readJsonFile(getSubtitleSourcesFilePath());

  state.catalogSources = normalizeSourceList(catalogRaw, "catalog");
  state.streamSources = normalizeSourceList(streamRaw, "stream");
  state.subtitleSources = normalizeSourceList(subtitleRaw, "subtitle");
  state.loadedAt = new Date().toISOString();

  manifestCache.clear();

  return {
    catalogCount: state.catalogSources.length,
    streamCount: state.streamSources.length,
    subtitleCount: state.subtitleSources.length
  };
}

module.exports = {
  ensureConfigFiles,
  getSubtitleSourcesFilePath,
  readJsonFile,
  normalizeSourceList,
  loadSourcesFromDisk
};
