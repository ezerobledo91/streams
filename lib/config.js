const path = require("path");
const { safeText, clamp } = require("./utils");

require("dotenv").config();

const APP_DIR = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(APP_DIR, "config");
const CATALOG_SOURCES_FILE = path.join(CONFIG_DIR, "catalog-manifests.json");
const STREAM_SOURCES_FILE = path.join(CONFIG_DIR, "stream-manifests.json");
const SUBTITLE_SOURCES_CANDIDATES = [
  path.join(CONFIG_DIR, "subtitles-manifests.json"),
  path.join(CONFIG_DIR, "subtitles-manifest.json"),
  path.join(CONFIG_DIR, "subtitles-manifes.json")
];
const WEB_DIST_DIR = path.join(APP_DIR, "web", "dist");
const LEGACY_PUBLIC_DIR = path.join(APP_DIR, "public");
const DEFAULT_LIVE_TV_LISTS_DIR = path.resolve(APP_DIR, "..", "listas m3u", "_curated");
const LIVE_TV_DIR_FROM_ENV = String(process.env.LIVE_TV_LISTS_DIR || process.env.M3U_LISTS_DIR || "").trim();
const LIVE_TV_LISTS_DIR = path.resolve(
  LIVE_TV_DIR_FROM_ENV || DEFAULT_LIVE_TV_LISTS_DIR
);
const LIVE_TV_PLAYLIST_EXTENSIONS = new Set([".m3u", ".m3u8"]);

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const DEFAULT_LANGUAGE = "es-ES";
const DEFAULT_PUBLIC_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce"
];
const SUPPORTED_SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt"]);
const BROWSER_NATIVE_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".m4v"]);
const PROWLARR_URL = safeText(process.env.PROWLARR_URL).replace(/\/+$/, "");
const PROWLARR_API_KEY = safeText(process.env.PROWLARR_API_KEY || process.env.PROWLARR_TOKEN);
const PROWLARR_ENABLED = safeText(process.env.PROWLARR_ENABLED || "true").toLowerCase() !== "false";
const PROWLARR_TIMEOUT_MS = clamp(
  Number.parseInt(safeText(process.env.PROWLARR_TIMEOUT_MS), 10) || 12000,
  4000,
  30000
);
const PROWLARR_MAX_PER_QUERY = clamp(
  Number.parseInt(safeText(process.env.PROWLARR_MAX_PER_QUERY), 10) || 120,
  20,
  300
);
const PROWLARR_MAX_STREAMS = clamp(
  Number.parseInt(safeText(process.env.PROWLARR_MAX_STREAMS), 10) || 160,
  20,
  500
);
const STREAM_RELIABILITY_FILE = path.join(CONFIG_DIR, "stream-reliability.json");
const RELIABILITY_MIN_SAMPLES = clamp(
  Number.parseInt(safeText(process.env.RELIABILITY_MIN_SAMPLES), 10) || 3,
  1,
  20
);
const RELIABILITY_CIRCUIT_THRESHOLD = clamp(
  Number.parseInt(safeText(process.env.RELIABILITY_CIRCUIT_THRESHOLD), 10) || 4,
  2,
  12
);
const RELIABILITY_CIRCUIT_BASE_MS = clamp(
  Number.parseInt(safeText(process.env.RELIABILITY_CIRCUIT_BASE_MS), 10) || 15 * 60 * 1000,
  2 * 60 * 1000,
  6 * 60 * 60 * 1000
);
const RELIABILITY_MAX_SOURCES_PER_PROVIDER = clamp(
  Number.parseInt(safeText(process.env.RELIABILITY_MAX_SOURCES_PER_PROVIDER), 10) || 1800,
  200,
  10000
);
const SUBTITLE_PROVIDER_TIMEOUT_MS = clamp(
  Number.parseInt(safeText(process.env.SUBTITLE_PROVIDER_TIMEOUT_MS), 10) || 8000,
  2500,
  20000
);
const SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS = clamp(
  Number.parseInt(safeText(process.env.SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS), 10) || 3500,
  1500,
  12000
);
const PLAYBACK_MAX_SESSIONS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_MAX_SESSIONS), 10) || 5,
  2,
  20
);
const PLAYBACK_MAX_CONNS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_MAX_CONNS), 10) || 36,
  10,
  120
);
const PLAYBACK_ATTEMPT_LOG_LIMIT = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_ATTEMPT_LOG_LIMIT), 10) || 500,
  100,
  5000
);
const PLAYBACK_HLS_ENABLED = safeText(process.env.PLAYBACK_HLS_ENABLED || "true").toLowerCase() !== "false";
const PLAYBACK_HLS_FORCE = safeText(process.env.PLAYBACK_HLS_FORCE || "false").toLowerCase() === "true";
const PLAYBACK_HLS_START_TIMEOUT_MS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_START_TIMEOUT_MS), 10) || 120000,
  8000,
  300000
);
const PLAYBACK_HLS_STALL_MS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_STALL_MS), 10) || 60000,
  8000,
  180000
);
const PLAYBACK_HLS_STALL_MIN_SPEED_BPS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_STALL_MIN_SPEED_BPS), 10) || 20000,
  4096,
  5 * 1024 * 1024
);
const PLAYBACK_HLS_SEGMENT_SECONDS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_SEGMENT_SECONDS), 10) || 6,
  2,
  10
);
const PLAYBACK_HLS_CRF = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_CRF), 10) || 23,
  18,
  30
);
const PLAYBACK_HLS_VIDEO_MAXRATE_KBPS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_VIDEO_MAXRATE_KBPS), 10) || 0,
  0,
  20000
);
const PLAYBACK_HLS_READY_SEGMENTS = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_READY_SEGMENTS), 10) || 6,
  1,
  12
);
const PLAYBACK_HLS_PRESET = safeText(process.env.PLAYBACK_HLS_PRESET || "ultrafast") || "ultrafast";
const PLAYBACK_HLS_MAX_HEIGHT = clamp(
  Number.parseInt(safeText(process.env.PLAYBACK_HLS_MAX_HEIGHT), 10) || 1080,
  480,
  2160
);
const FFMPEG_PATH = safeText(process.env.FFMPEG_PATH || "ffmpeg");
const PLAYBACK_HLS_DIR = path.resolve(
  safeText(process.env.PLAYBACK_HLS_DIR || path.join(CONFIG_DIR, "playback-hls"))
);
const PLAYBACK_SESSION_TTL_MS = 30 * 60 * 1000;
const PORT = Number(process.env.PORT || 8787);

const DEFAULT_CATALOG_SOURCES = {
  providers: [
    {
      id: "cinemeta",
      name: "Cinemeta",
      manifestUrl: "https://v3-cinemeta.strem.io/manifest.json",
      active: true,
      priority: 100,
      categories: ["movie", "series"]
    }
  ]
};

const DEFAULT_STREAM_SOURCES = {
  providers: [
    {
      id: "thepiratebay-plus",
      name: "ThePirateBay+",
      manifestUrl: "https://thepiratebay-plus.strem.fun/manifest.json",
      active: true,
      priority: 100,
      categories: ["movie", "series"]
    }
  ]
};

const DEFAULT_SUBTITLE_SOURCES = {
  providers: []
};

module.exports = {
  APP_DIR,
  CONFIG_DIR,
  CATALOG_SOURCES_FILE,
  STREAM_SOURCES_FILE,
  SUBTITLE_SOURCES_CANDIDATES,
  WEB_DIST_DIR,
  LEGACY_PUBLIC_DIR,
  LIVE_TV_LISTS_DIR,
  LIVE_TV_PLAYLIST_EXTENSIONS,
  TMDB_BASE_URL,
  TMDB_IMAGE_BASE,
  DEFAULT_LANGUAGE,
  DEFAULT_PUBLIC_TRACKERS,
  SUPPORTED_SUBTITLE_EXTENSIONS,
  BROWSER_NATIVE_VIDEO_EXTENSIONS,
  PROWLARR_URL,
  PROWLARR_API_KEY,
  PROWLARR_ENABLED,
  PROWLARR_TIMEOUT_MS,
  PROWLARR_MAX_PER_QUERY,
  PROWLARR_MAX_STREAMS,
  STREAM_RELIABILITY_FILE,
  RELIABILITY_MIN_SAMPLES,
  RELIABILITY_CIRCUIT_THRESHOLD,
  RELIABILITY_CIRCUIT_BASE_MS,
  RELIABILITY_MAX_SOURCES_PER_PROVIDER,
  SUBTITLE_PROVIDER_TIMEOUT_MS,
  SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS,
  PLAYBACK_MAX_SESSIONS,
  PLAYBACK_MAX_CONNS,
  PLAYBACK_ATTEMPT_LOG_LIMIT,
  PLAYBACK_HLS_ENABLED,
  PLAYBACK_HLS_FORCE,
  PLAYBACK_HLS_START_TIMEOUT_MS,
  PLAYBACK_HLS_STALL_MS,
  PLAYBACK_HLS_STALL_MIN_SPEED_BPS,
  PLAYBACK_HLS_SEGMENT_SECONDS,
  PLAYBACK_HLS_CRF,
  PLAYBACK_HLS_VIDEO_MAXRATE_KBPS,
  PLAYBACK_HLS_READY_SEGMENTS,
  PLAYBACK_HLS_PRESET,
  PLAYBACK_HLS_MAX_HEIGHT,
  FFMPEG_PATH,
  PLAYBACK_HLS_DIR,
  PLAYBACK_SESSION_TTL_MS,
  PORT,
  DEFAULT_CATALOG_SOURCES,
  DEFAULT_STREAM_SOURCES,
  DEFAULT_SUBTITLE_SOURCES
};
