const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { safeText, clamp, compactText, ensureDirSync, safeRemoveDirSync, nowMs } = require("../utils");
const {
  PLAYBACK_HLS_DIR,
  PLAYBACK_HLS_PRESET,
  PLAYBACK_HLS_CRF,
  PLAYBACK_HLS_SEGMENT_SECONDS,
  FFMPEG_PATH
} = require("../config");
const { liveTvState } = require("../state");
const { normalizeLooseText, normalizeLiveCategoryId } = require("../live-tv/parser");
const { getLiveTvSummary, loadLiveTvFromDisk } = require("../live-tv/manager");
const liveTvPreferences = require("../live-tv/preferences");

const LIVE_TV_HLS_ROOT_DIR = path.join(PLAYBACK_HLS_DIR, "live-tv");
const LIVE_TV_HLS_IDLE_TTL_MS = 90 * 1000;
const LIVE_TV_MAX_CONCURRENT_TRANSCODES = 5;
const LIVE_TV_FORCE_TRANSCODE = safeText(process.env.LIVE_TV_FORCE_TRANSCODE || "false").toLowerCase() === "true";
const LIVE_TV_PROXY_STICKY_TTL_MS = 90 * 1000;
const LIVE_TV_PROXY_DEFAULT_UA =
  safeText(process.env.LIVE_TV_PROXY_USER_AGENT) || "VLC/3.0.20 LibVLC/3.0.20";
const LIVE_TV_PROXY_FALLBACK_UAS = [
  "node",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];
const LIVE_TV_MAX_PROXY_PER_CHANNEL = 6;
const liveTvTranscodes = new Map();
const liveTvProxyStickyMap = new Map();
const liveTvProxyActiveCount = new Map();
let transcodeReaperTimer = null;

function isHttpUrl(value) {
  return /^https?:\/\//i.test(safeText(value));
}

function isLiveTvTranscodeCandidate(item) {
  return isHttpUrl(item?.streamUrl);
}

function resolveOriginFromUrl(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function buildLiveTvUpstreamHeaders(item, req, targetUrl) {
  const forcedUserAgent = safeText(item?.httpUserAgent);
  const requestUserAgent = safeText(req.headers["user-agent"]);
  const headers = {
    accept: safeText(req.headers.accept) || "*/*",
    "user-agent": forcedUserAgent || LIVE_TV_PROXY_DEFAULT_UA || requestUserAgent || "streams-mvp/1.0"
  };
  const range = safeText(req.headers.range);
  if (range) {
    headers.range = range;
  }

  let referer = safeText(item?.httpReferrer);
  
  // Inyección manual para proveedores conocidos que requieren Referer específico
  if (!referer && (targetUrl.includes('megaplay') || targetUrl.includes('sniper'))) {
    referer = 'https://megaplaytv.vip/';
  }

  if (referer) {
    headers.referer = referer;
    const origin = resolveOriginFromUrl(referer) || resolveOriginFromUrl(targetUrl);
    if (origin) {
      headers.origin = origin;
    }
  }

  return headers;
}

function createUpstreamHeaderAttempts(item, req, targetUrl) {
  const base = buildLiveTvUpstreamHeaders(item, req, targetUrl);
  const forcedUserAgent = safeText(item?.httpUserAgent);
  if (forcedUserAgent) {
    return [base];
  }

  const seen = new Set([safeText(base["user-agent"]).toLowerCase()]);
  const attempts = [base];
  for (const candidate of LIVE_TV_PROXY_FALLBACK_UAS) {
    const ua = safeText(candidate);
    if (!ua) continue;
    const key = ua.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attempts.push({
      ...base,
      "user-agent": ua
    });
  }
  return attempts;
}

async function fetchLiveTvUpstreamWithFallback(item, req, targetUrl, signal) {
  const headerAttempts = createUpstreamHeaderAttempts(item, req, targetUrl);
  let lastResponse = null;

  for (let index = 0; index < headerAttempts.length; index += 1) {
    const headers = headerAttempts[index];
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        signal,
        redirect: "follow",
        headers
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
      if (index >= headerAttempts.length - 1) {
        throw error;
      }
      continue;
    }

    if (upstream.ok) {
      return upstream;
    }

    lastResponse = upstream;
    const shouldRetryAuth = upstream.status === 401 || upstream.status === 403 || upstream.status === 429;
    if (!shouldRetryAuth || index >= headerAttempts.length - 1) {
      return upstream;
    }
  }

  return lastResponse;
}

function getLiveTvStickyUrl(channelId) {
  const state = liveTvProxyStickyMap.get(channelId);
  if (!state) return "";
  if (Number(state.expiresAt || 0) <= nowMs()) {
    liveTvProxyStickyMap.delete(channelId);
    return "";
  }
  return safeText(state.url);
}

function setLiveTvStickyUrl(channelId, url) {
  const nextUrl = safeText(url);
  if (!channelId || !nextUrl) return;
  liveTvProxyStickyMap.set(channelId, {
    url: nextUrl,
    expiresAt: nowMs() + LIVE_TV_PROXY_STICKY_TTL_MS
  });
}

function clearLiveTvStickyUrl(channelId) {
  if (!channelId) return;
  liveTvProxyStickyMap.delete(channelId);
}

async function fetchLiveTvUpstreamByCandidates(item, req, candidates, signal) {
  let lastResponse = null;
  let lastTargetUrl = "";
  for (const candidate of candidates) {
    const targetUrl = safeText(candidate);
    if (!targetUrl) continue;
    lastTargetUrl = targetUrl;
    const upstream = await fetchLiveTvUpstreamWithFallback(item, req, targetUrl, signal);
    if (upstream?.ok) {
      return { upstream, targetUrl };
    }
    lastResponse = upstream;
    const retryable =
      Number(upstream?.status || 0) === 401 ||
      Number(upstream?.status || 0) === 403 ||
      Number(upstream?.status || 0) === 404 ||
      Number(upstream?.status || 0) === 429;
    if (!retryable) {
      break;
    }
  }
  return {
    upstream: lastResponse,
    targetUrl: lastTargetUrl
  };
}

function toChannelProxyPath(channelId, targetUrl) {
  const base = `/api/live-tv/channels/${encodeURIComponent(channelId)}/proxy`;
  if (!targetUrl) return base;
  return `${base}?url=${encodeURIComponent(targetUrl)}`;
}

function toChannelHlsPath(channelId, asset = "index.m3u8") {
  return `/api/live-tv/channels/${encodeURIComponent(channelId)}/hls/${encodeURIComponent(asset)}`;
}

function toAbsoluteHttpUrl(raw, baseUrl) {
  const value = safeText(raw);
  if (!value) return "";
  try {
    const parsed = new URL(value, baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function rewriteM3u8Line(line, channelId, baseUrl) {
  const raw = String(line || "");
  if (!raw) return raw;

  if (raw.startsWith("#")) {
    return raw.replace(/URI=(?:"([^"]*)"|'([^']*)'|([^,\s]+))/gi, (full, q1, q2, q3) => {
      const uriValue = safeText(q1 || q2 || q3);
      const absolute = toAbsoluteHttpUrl(uriValue, baseUrl);
      if (!absolute) return full;
      return `URI="${toChannelProxyPath(channelId, absolute)}"`;
    });
  }

  const absolute = toAbsoluteHttpUrl(raw, baseUrl);
  if (!absolute) return raw;
  return toChannelProxyPath(channelId, absolute);
}

function rewriteM3u8Manifest(manifestText, channelId, baseUrl) {
  return String(manifestText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => rewriteM3u8Line(line, channelId, baseUrl))
    .join("\n");
}

const PIPE_IDLE_TIMEOUT_MS = 30 * 1000;

async function pipeUpstreamToResponse(upstream, res) {
  const statusCode = Number(upstream.status || 200);
  const contentType = safeText(upstream.headers.get("content-type"));
  const contentLength = safeText(upstream.headers.get("content-length"));
  const acceptRanges = safeText(upstream.headers.get("accept-ranges"));
  const contentRange = safeText(upstream.headers.get("content-range"));

  res.status(statusCode);
  res.setHeader("Cache-Control", "no-store");
  if (contentType) res.setHeader("Content-Type", contentType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
  if (contentRange) res.setHeader("Content-Range", contentRange);

  if (upstream.body && typeof Readable.fromWeb === "function") {
    const nodeStream = Readable.fromWeb(upstream.body);
    let idleTimer = setTimeout(() => {
      if (!nodeStream.destroyed) nodeStream.destroy();
    }, PIPE_IDLE_TIMEOUT_MS);
    nodeStream.on("data", () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!nodeStream.destroyed) nodeStream.destroy();
      }, PIPE_IDLE_TIMEOUT_MS);
    });
    nodeStream.on("end", () => clearTimeout(idleTimer));
    nodeStream.on("error", () => {
      clearTimeout(idleTimer);
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }
    });
    res.on("close", () => {
      clearTimeout(idleTimer);
      if (!nodeStream.destroyed) nodeStream.destroy();
    });
    nodeStream.pipe(res);
    return;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.send(buffer);
}

function cleanupExpiredStickyEntries() {
  const now = nowMs();
  for (const [channelId, state] of liveTvProxyStickyMap.entries()) {
    if (Number(state.expiresAt || 0) <= now) {
      liveTvProxyStickyMap.delete(channelId);
    }
  }
}

function startTranscodeReaper() {
  if (transcodeReaperTimer) return;
  transcodeReaperTimer = setInterval(() => {
    cleanupIdleLiveTvTranscodes(false);
    cleanupExpiredStickyEntries();
    cleanupOrphanedLiveTvDirs();
  }, 30 * 1000);
  if (typeof transcodeReaperTimer.unref === "function") {
    transcodeReaperTimer.unref();
  }
}

function stopLiveTvTranscode(transcode) {
  if (!transcode) return;
  try {
    if (transcode.ffmpegProcess && !transcode.ffmpegProcess.killed) {
      transcode.ffmpegProcess.kill("SIGTERM");
      setTimeout(() => {
        try {
          if (!transcode.ffmpegProcess.killed) transcode.ffmpegProcess.kill("SIGKILL");
        } catch {}
      }, 2000);
    }
  } catch {
    // no-op
  }
  safeRemoveDirSync(transcode.dir);
}

function cleanupIdleLiveTvTranscodes(force) {
  const threshold = nowMs() - LIVE_TV_HLS_IDLE_TTL_MS;
  for (const [channelId, transcode] of liveTvTranscodes.entries()) {
    const expired = force || Number(transcode.lastAccessAt || 0) < threshold;
    if (!expired) continue;
    stopLiveTvTranscode(transcode);
    liveTvTranscodes.delete(channelId);
  }
}

function getManifestSegmentCount(manifestPath) {
  try {
    const text = fs.readFileSync(manifestPath, "utf8");
    return (text.match(/#EXTINF:/g) || []).length;
  } catch {
    return 0;
  }
}

const LIVE_TV_QUALITY_PRESETS = {
  "360p":  { height: 360,  crf: "34", audioBitrate: "96k"  },
  "480p":  { height: 480,  crf: "32", audioBitrate: "128k" },
  "720p":  { height: 720,  crf: "28", audioBitrate: "128k" },
  "1080p": { height: 1080, crf: "24", audioBitrate: "192k" }
};
const LIVE_TV_DEFAULT_QUALITY = "480p";

function cleanupOrphanedLiveTvDirs() {
  try {
    if (!fs.existsSync(LIVE_TV_HLS_ROOT_DIR)) return;
    const entries = fs.readdirSync(LIVE_TV_HLS_ROOT_DIR);
    for (const entry of entries) {
      if (liveTvTranscodes.has(entry)) continue;
      safeRemoveDirSync(path.join(LIVE_TV_HLS_ROOT_DIR, entry));
    }
  } catch {
    // no-op
  }
}

function createLiveTvTranscode(item, quality) {
  const channelId = safeText(item?.id);
  const sourceUrl = safeText(item?.streamUrl);
  if (!channelId || !isHttpUrl(sourceUrl)) {
    throw new Error("Canal no apto para transcode.");
  }

  const resolvedQuality = LIVE_TV_QUALITY_PRESETS[quality] ? quality : LIVE_TV_DEFAULT_QUALITY;
  const preset = LIVE_TV_QUALITY_PRESETS[resolvedQuality];

  if (liveTvTranscodes.size >= LIVE_TV_MAX_CONCURRENT_TRANSCODES && !liveTvTranscodes.has(channelId)) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, t] of liveTvTranscodes.entries()) {
      if (t.lastAccessAt < oldestTime) { oldestTime = t.lastAccessAt; oldestKey = key; }
    }
    if (oldestKey) { stopLiveTvTranscode(liveTvTranscodes.get(oldestKey)); liveTvTranscodes.delete(oldestKey); }
  }

  const existing = liveTvTranscodes.get(channelId);
  const sameSource = existing && safeText(existing.sourceUrl) === sourceUrl;
  const sameQuality = sameSource && existing.quality === resolvedQuality;
  const stillRunning = sameQuality && existing.ffmpegProcess && existing.ffmpegProcess.exitCode === null;
  if (sameQuality && stillRunning && existing.status !== "error") {
    existing.lastAccessAt = nowMs();
    return existing;
  }
  if (existing) {
    stopLiveTvTranscode(existing);
    liveTvTranscodes.delete(channelId);
  }

  ensureDirSync(LIVE_TV_HLS_ROOT_DIR);
  const dir = path.join(LIVE_TV_HLS_ROOT_DIR, channelId);
  safeRemoveDirSync(dir);
  ensureDirSync(dir);

  const manifestPath = path.join(dir, "index.m3u8");
  const segmentPattern = path.join(dir, "seg-%05d.ts");
  const transcode = {
    channelId,
    sourceUrl,
    quality: resolvedQuality,
    dir,
    manifestPath,
    status: "loading",
    error: null,
    lastStderr: "",
    ffmpegProcess: null,
    lastAccessAt: nowMs()
  };

  const transcodeUserAgent = safeText(item?.httpUserAgent) || LIVE_TV_PROXY_DEFAULT_UA;

  const inputArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-rw_timeout",
    "8000000",
    ...(transcodeUserAgent ? ["-user_agent", transcodeUserAgent] : []),
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "3",
    ...(safeText(item?.httpReferrer)
      ? [
          "-headers",
          `Referer: ${safeText(item.httpReferrer)}\r\nOrigin: ${resolveOriginFromUrl(item.httpReferrer) || resolveOriginFromUrl(sourceUrl)}\r\n`
        ]
      : []),
    "-fflags",
    "+genpts+discardcorrupt",
    "-i",
    sourceUrl
  ];

  const codecArgs = [
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-crf", preset.crf,
    "-vf", `scale=-2:min(ih\\,${preset.height})`,
    "-g", "30",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-b:a", preset.audioBitrate,
    "-ac", "2",
    "-sn",
    "-dn"
  ];

  const hlsArgs = [
    "-f", "hls",
    "-hls_time", "2",
    "-hls_init_time", "1",
    "-hls_list_size", "20",
    "-hls_delete_threshold", "4",
    "-hls_flags", "delete_segments+append_list+independent_segments+temp_file",
    "-hls_segment_filename", segmentPattern,
    manifestPath
  ];

  const ffmpegArgs = [...inputArgs, ...codecArgs, ...hlsArgs];

  let ffmpeg;
  try {
    ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    transcode.status = "error";
    transcode.error = `No se pudo iniciar ffmpeg (${FFMPEG_PATH}): ${error?.message || error}`;
    liveTvTranscodes.set(channelId, transcode);
    return transcode;
  }

  transcode.ffmpegProcess = ffmpeg;
  ffmpeg.stderr?.on("data", (chunk) => {
    const text = String(chunk || "");
    if (!text) return;
    transcode.lastStderr = compactText(text, 260);
  });

  ffmpeg.on("error", (error) => {
    const active = liveTvTranscodes.get(channelId);
    if (!active) return;
    active.status = "error";
    active.error = `ffmpeg error: ${error?.message || "desconocido"}`;
  });

  ffmpeg.on("exit", (code) => {
    const active = liveTvTranscodes.get(channelId);
    if (!active) return;
    if (active.status === "ready") {
      active.status = "error";
      active.error = `ffmpeg terminó inesperadamente (code ${code ?? "?"}).`;
      return;
    }
    active.status = "error";
    active.error = compactText(
      active.lastStderr || `ffmpeg finalizo antes de preparar HLS (code ${code ?? "?"}).`,
      240
    );
  });

  liveTvTranscodes.set(channelId, transcode);
  return transcode;
}

function resolveHlsAssetPath(transcode, rawAsset) {
  const asset = safeText(rawAsset);
  if (!asset || asset.includes("..") || asset.includes("/") || asset.includes("\\")) {
    return null;
  }
  return path.join(transcode.dir, asset);
}

function setHlsAssetHeaders(res, assetName) {
  const lower = safeText(assetName).toLowerCase();
  res.setHeader("Cache-Control", "no-store");
  if (lower.endsWith(".m3u8")) {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    return;
  }
  if (lower.endsWith(".ts")) {
    res.setHeader("Content-Type", "video/mp2t");
    return;
  }
  if (lower.endsWith(".m4s")) {
    res.setHeader("Content-Type", "video/iso.segment");
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
}

function registerLiveTvRoutes(app) {
  startTranscodeReaper();
  cleanupOrphanedLiveTvDirs();

  app.get("/api/live-tv/qualities", (req, res) => {
    return res.json({
      qualities: Object.keys(LIVE_TV_QUALITY_PRESETS),
      default: LIVE_TV_DEFAULT_QUALITY
    });
  });

  app.get("/api/live-tv/status", (req, res) => {
    cleanupIdleLiveTvTranscodes(false);
    return res.json({
      ...getLiveTvSummary(),
      exists: fs.existsSync(liveTvState.dir),
      transcodes: liveTvTranscodes.size
    });
  });

  app.post("/api/live-tv/reload", (req, res) => {
    try {
      cleanupIdleLiveTvTranscodes(true);
      const summary = loadLiveTvFromDisk();
      return res.json({ ok: true, ...summary });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "No se pudo recargar Live TV." });
    }
  });

  app.get("/api/live-tv/categories", (req, res) => {
    return res.json({
      loadedAt: liveTvState.loadedAt,
      categories: liveTvState.categories
    });
  });

  app.get("/api/live-tv/channels", (req, res) => {
    cleanupIdleLiveTvTranscodes(false);
    const rawCategory = safeText(req.query.category).toLowerCase();
    const category = rawCategory && rawCategory !== "all" ? normalizeLiveCategoryId(rawCategory) : "";
    const query = normalizeLooseText(req.query.query);
    const webOnly = req.query.webOnly !== "false";
    const page = clamp(Number.parseInt(req.query.page, 10) || 1, 1, 400);
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 120, 20, 1200);

    let pool = liveTvState.channels;
    if (category) {
      pool = pool.filter((item) => item.category.id === category);
    }
    if (webOnly) {
      pool = pool.filter((item) => item.webPlayable || isLiveTvTranscodeCandidate(item));
    }
    if (query) {
      pool = pool.filter((item) => item.searchText.includes(query));
    }

    const total = pool.length;
    const offset = (page - 1) * limit;
    const items = pool.slice(offset, offset + limit).map(({ searchText, ...channel }) => channel);

    return res.json({
      loadedAt: liveTvState.loadedAt,
      category: category || "all",
      query: safeText(req.query.query),
      webOnly,
      page,
      limit,
      total,
      items
    });
  });

  app.get("/api/live-tv/channels/:id", (req, res) => {
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    const { searchText, ...channel } = item;
    return res.json(channel);
  });

  app.get("/api/live-tv/channels/:id/stream", (req, res) => {
    cleanupIdleLiveTvTranscodes(false);
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    res.setHeader("Cache-Control", "no-store");
    if (LIVE_TV_FORCE_TRANSCODE && isLiveTvTranscodeCandidate(item)) {
      return res.redirect(302, toChannelHlsPath(id));
    }
    if (item.webPlayable) {
      return res.redirect(302, toChannelProxyPath(id));
    }
    if (isLiveTvTranscodeCandidate(item)) {
      return res.redirect(302, toChannelHlsPath(id));
    }
    return res.status(400).json({ error: "El canal no es reproducible en navegador (protocolo no soportado)." });
  });

  app.get("/api/live-tv/channels/:id/hls/:asset", async (req, res) => {
    cleanupIdleLiveTvTranscodes(false);
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }
    if (!isLiveTvTranscodeCandidate(item)) {
      return res.status(400).json({ error: "Canal no apto para transcode HLS." });
    }

    const requestedAssetEarly = safeText(req.params.asset) || "index.m3u8";
    const isManifestRequest = /\.m3u8$/i.test(requestedAssetEarly);

    // Solo arrancar/reiniciar ffmpeg en peticiones de manifest, no de segmentos.
    // Los segmentos no llevan ?quality= y reiniciarían el transcode por error.
    if (isManifestRequest) {
      const quality = safeText(req.query.quality) || LIVE_TV_DEFAULT_QUALITY;
      try {
        createLiveTvTranscode(item, quality);
      } catch (error) {
        return res.status(502).json({ error: error?.message || "No se pudo iniciar transcode." });
      }
    }

    const transcode = liveTvTranscodes.get(id);
    if (!transcode) {
      return res.status(502).json({ error: "No hay transcode activo para este canal." });
    }
    transcode.lastAccessAt = nowMs();

    if (transcode.status === "error") {
      return res.status(502).json({ error: transcode.error || "Transcode falló." });
    }

    const requestedAsset = requestedAssetEarly;
    const filePath = resolveHlsAssetPath(transcode, requestedAsset);
    if (!filePath) {
      return res.status(400).json({ error: "Asset HLS invalido." });
    }

    // Manifest: verificar que existe y tiene al menos 1 segmento
    if (/\.m3u8$/i.test(requestedAsset)) {
      if (!fs.existsSync(filePath) || getManifestSegmentCount(filePath) < 1) {
        res.setHeader("Retry-After", "2");
        return res.status(503).json({ error: "Transcode en preparación, reintentando..." });
      }
      // Marcar como ready en el primer manifest válido servido
      if (transcode.status === "loading") {
        transcode.status = "ready";
      }
      setHlsAssetHeaders(res, requestedAsset);
      return res.sendFile(path.resolve(filePath));
    }

    // Segmentos: breve espera si ffmpeg aún está escribiendo (temp_file rename)
    if (!fs.existsSync(filePath)) {
      if (/\.ts$/i.test(requestedAsset)) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 350));
          if (req.destroyed) return;
          if (fs.existsSync(filePath)) break;
        }
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Segmento HLS no encontrado." });
      }
    }
    setHlsAssetHeaders(res, requestedAsset);
    return res.sendFile(path.resolve(filePath));
  });

  // --- Preferences endpoints ---
  app.get("/api/live-tv/preferences", (req, res) => {
    return res.json(liveTvPreferences.getPreferences());
  });

  app.post("/api/live-tv/preferences/favorites", (req, res) => {
    const channelId = safeText(req.body?.channelId);
    if (!channelId) return res.status(400).json({ error: "channelId requerido." });
    const prefs = liveTvPreferences.toggleFavorite(channelId);
    return res.json(prefs);
  });

  app.post("/api/live-tv/preferences/hidden", (req, res) => {
    const channelId = safeText(req.body?.channelId);
    if (!channelId) return res.status(400).json({ error: "channelId requerido." });
    const prefs = liveTvPreferences.hideChannel(channelId);
    return res.json(prefs);
  });

  app.delete("/api/live-tv/preferences/hidden", (req, res) => {
    const channelId = safeText(req.body?.channelId);
    if (!channelId) return res.status(400).json({ error: "channelId requerido." });
    const prefs = liveTvPreferences.unhideChannel(channelId);
    return res.json(prefs);
  });

  app.post("/api/live-tv/preferences/names", (req, res) => {
    const channelId = safeText(req.body?.channelId);
    const name = String(req.body?.name ?? "");
    if (!channelId) return res.status(400).json({ error: "channelId requerido." });
    const prefs = liveTvPreferences.setCustomName(channelId, name);
    return res.json(prefs);
  });

  app.post("/api/live-tv/preferences/categories", (req, res) => {
    const channelId = safeText(req.body?.channelId);
    const categoryId = safeText(req.body?.categoryId);
    if (!channelId) return res.status(400).json({ error: "channelId requerido." });
    const prefs = liveTvPreferences.setCustomCategory(channelId, categoryId);
    return res.json(prefs);
  });

  app.get("/api/live-tv/channels/:id/proxy", async (req, res) => {
    const id = safeText(req.params.id);
    const item = liveTvState.channelById.get(id);
    if (!item) {
      return res.status(404).json({ error: "Canal no encontrado." });
    }

    const currentCount = liveTvProxyActiveCount.get(id) || 0;
    if (currentCount >= LIVE_TV_MAX_PROXY_PER_CHANNEL) {
      return res.status(429).json({ error: "Demasiadas conexiones simultaneas a este canal." });
    }
    liveTvProxyActiveCount.set(id, currentCount + 1);

    const explicitTargetUrl = safeText(req.query.url);
    const stickyTargetUrl = explicitTargetUrl ? "" : getLiveTvStickyUrl(id);
    const targetCandidates = explicitTargetUrl
      ? [explicitTargetUrl]
      : [stickyTargetUrl, item.streamUrl].filter(Boolean);
    const firstTarget = safeText(targetCandidates[0]);
    if (!isHttpUrl(firstTarget)) {
      liveTvProxyActiveCount.set(id, Math.max(0, (liveTvProxyActiveCount.get(id) || 1) - 1));
      return res.status(400).json({ error: "Solo se permiten streams http/https." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const { upstream, targetUrl } = await fetchLiveTvUpstreamByCandidates(
        item,
        req,
        targetCandidates,
        controller.signal
      );

      if (!upstream?.ok) {
        if (!explicitTargetUrl) {
          clearLiveTvStickyUrl(id);
        }
        const statusCode = Number(upstream?.status || 502);
        const looksSegmentAsset =
          /\.((ts)|(m4s))(?:$|\?)/i.test(explicitTargetUrl) || /\/segments?\//i.test(explicitTargetUrl);
        if (explicitTargetUrl && looksSegmentAsset && [401, 403, 404].includes(statusCode)) {
          clearLiveTvStickyUrl(id);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Streams-Retry", "manifest-refresh");
          return res.status(503).json({
            error: `Segmento expirado (upstream ${statusCode}). Reintentando con manifest nuevo.`
          });
        }
        const preview = upstream ? safeText(await upstream.text()).slice(0, 180) : "";
        return res
          .status(502)
          .json({ error: `Stream upstream devolvio HTTP ${statusCode}${preview ? `: ${preview}` : ""}` });
      }

      const finalUrl = safeText(upstream.url) || targetUrl;
      const contentType = safeText(upstream.headers.get("content-type")).toLowerCase();
      const maybeManifest = contentType.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(finalUrl);
      if (!explicitTargetUrl && maybeManifest) {
        setLiveTvStickyUrl(id, finalUrl);
      }

      if (maybeManifest) {
        const rawBuffer = Buffer.from(await upstream.arrayBuffer());
        if (rawBuffer.length > 2 * 1024 * 1024) {
          return res.status(502).json({ error: "Manifest demasiado grande." });
        }
        const text = rawBuffer.toString("utf8");
        const rewritten = rewriteM3u8Manifest(text, id, finalUrl);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        return res.status(200).send(rewritten);
      }

      await pipeUpstreamToResponse(upstream, res);
      return undefined;
    } catch (error) {
      return res.status(502).json({ error: error?.message || "No se pudo abrir stream remoto." });
    } finally {
      clearTimeout(timeout);
      liveTvProxyActiveCount.set(id, Math.max(0, (liveTvProxyActiveCount.get(id) || 1) - 1));
    }
  });
}

module.exports = { registerLiveTvRoutes };

