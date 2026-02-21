const fs = require("fs");
const path = require("path");
const { CONFIG_DIR } = require("../config");
const { safeText } = require("../utils");

const REMOTE_SOURCES_CONFIG_FILE = path.join(CONFIG_DIR, "live-tv-remote-sources.json");
const CACHE_DIR = path.join(CONFIG_DIR, "live-tv-cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

const DEFAULT_REMOTE_SOURCES = [
  {
    id: "fuxxion",
    name: "Lista Fuxxion",
    url: "http://live.fuxxion.club:8080/get.php?username=juanvernazza&password=85GbSi1ewU&type=m3u_plus",
    enabled: true
  },
  {
    id: "rey-premium",
    name: "Lista Rey Premium",
    url: "http://rey-premium.ddns.net:54321/get.php?username=DPVEduardoEspa&password=Espa020828&type=m3u_plus",
    enabled: true
  }
];

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadRemoteSourcesConfig() {
  try {
    if (!fs.existsSync(REMOTE_SOURCES_CONFIG_FILE)) {
      return DEFAULT_REMOTE_SOURCES.map((s) => ({ ...s }));
    }
    const content = fs.readFileSync(REMOTE_SOURCES_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || !parsed.length) {
      return DEFAULT_REMOTE_SOURCES.map((s) => ({ ...s }));
    }
    return parsed;
  } catch {
    return DEFAULT_REMOTE_SOURCES.map((s) => ({ ...s }));
  }
}

function saveRemoteSourcesConfig(sources) {
  try {
    fs.mkdirSync(path.dirname(REMOTE_SOURCES_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(REMOTE_SOURCES_CONFIG_FILE, JSON.stringify(sources, null, 2), "utf8");
  } catch {
    // no-op
  }
}

function getCacheFilePath(sourceId) {
  const safeId = safeText(sourceId).replace(/[^a-z0-9_-]/gi, "_");
  return path.join(CACHE_DIR, `${safeId}.m3u`);
}

function getCacheInfo(sourceId) {
  const filePath = getCacheFilePath(sourceId);
  if (!fs.existsSync(filePath)) {
    return { exists: false, updatedAt: null, stale: true, filePath };
  }
  try {
    const stat = fs.statSync(filePath);
    const updatedAtMs = stat.mtimeMs;
    const stale = Date.now() - updatedAtMs > CACHE_TTL_MS;
    return { exists: true, updatedAt: new Date(updatedAtMs).toISOString(), stale, filePath };
  } catch {
    return { exists: false, updatedAt: null, stale: true, filePath };
  }
}

async function downloadRemoteSource(source) {
  const url = safeText(source.url);
  if (!url) throw new Error(`Source ${source.id}: URL vacía.`);

  ensureCacheDir();
  const filePath = getCacheFilePath(source.id);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
        "Accept": "*/*"
      }
    });

    if (!response.ok) {
      throw new Error(`Source ${source.id}: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 10) {
      throw new Error(`Source ${source.id}: respuesta vacía o inválida.`);
    }

    fs.writeFileSync(filePath, buffer);
    return { sourceId: source.id, filePath, size: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshRemoteSources(sourceIds = null) {
  const sources = loadRemoteSourcesConfig();
  const toRefresh = sourceIds
    ? sources.filter((s) => s.enabled && sourceIds.includes(s.id))
    : sources.filter((s) => s.enabled);

  const results = [];
  for (const source of toRefresh) {
    try {
      const result = await downloadRemoteSource(source);
      results.push({ id: source.id, ok: true, size: result.size });
    } catch (err) {
      results.push({ id: source.id, ok: false, error: err?.message || "Error desconocido" });
    }
  }
  return results;
}

async function ensureRemoteSourcesCached() {
  const sources = loadRemoteSourcesConfig();
  const stale = sources.filter((s) => s.enabled && getCacheInfo(s.id).stale);
  if (!stale.length) return [];
  return refreshRemoteSources(stale.map((s) => s.id));
}

function getRemoteSourcesStatus() {
  const sources = loadRemoteSourcesConfig();
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    enabled: source.enabled,
    cache: getCacheInfo(source.id)
  }));
}

function getCacheDir() {
  return CACHE_DIR;
}

module.exports = {
  loadRemoteSourcesConfig,
  saveRemoteSourcesConfig,
  refreshRemoteSources,
  ensureRemoteSourcesCached,
  getRemoteSourcesStatus,
  getCacheDir,
  getCacheFilePath,
  getCacheInfo
};
