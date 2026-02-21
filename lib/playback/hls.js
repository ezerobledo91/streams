const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { safeText, compactText, ensureDirSync, safeRemoveDirSync, nowMs, extractResolutionHintFromText } = require("../utils");
const {
  PLAYBACK_HLS_ENABLED,
  PLAYBACK_HLS_DIR,
  PLAYBACK_HLS_PRESET,
  PLAYBACK_HLS_MAX_HEIGHT,
  PLAYBACK_HLS_CRF,
  PLAYBACK_HLS_VIDEO_MAXRATE_KBPS,
  PLAYBACK_HLS_SEGMENT_SECONDS,
  PLAYBACK_HLS_READY_SEGMENTS,
  PLAYBACK_HLS_START_TIMEOUT_MS,
  FFMPEG_PATH
} = require("../config");
const { playbackSessions } = require("../state");
const { markSessionOutcome } = require("../reliability/tracker");

function getSessionById(sessionId) {
  return playbackSessions.get(sessionId) || null;
}

function touchSession(session) {
  session.lastAccessAt = nowMs();
}

function pushPlaybackAttemptEvent(event, payload = {}) {
  const { playbackAttemptLog } = require("../state");
  const { PLAYBACK_ATTEMPT_LOG_LIMIT } = require("../config");
  const entry = {
    at: new Date().toISOString(),
    ts: nowMs(),
    event: compactText(event, 64),
    ...payload
  };
  playbackAttemptLog.push(entry);
  if (playbackAttemptLog.length > PLAYBACK_ATTEMPT_LOG_LIMIT) {
    playbackAttemptLog.splice(0, playbackAttemptLog.length - PLAYBACK_ATTEMPT_LOG_LIMIT);
  }
}

function createEmptySessionHlsState() {
  return {
    enabled: false,
    status: "idle",
    error: null,
    dir: "",
    manifestPath: "",
    playlistPath: "",
    ffmpegProcess: null,
    inputStream: null,
    lastStderr: "",
    lastSegmentCount: 0,
    lastSegmentAt: 0,
    lastManifestLogAt: 0
  };
}

function readHlsManifestSegmentCount(manifestPath) {
  try {
    const text = fs.readFileSync(manifestPath, "utf8");
    return (text.match(/#EXTINF:/g) || []).length;
  } catch {
    return -1;
  }
}

function resolveHlsVideoMaxrateKbps(heightHint) {
  if (PLAYBACK_HLS_VIDEO_MAXRATE_KBPS > 0) {
    return PLAYBACK_HLS_VIDEO_MAXRATE_KBPS;
  }
  const h = Number(heightHint) || 0;
  if (h > 0 && h <= 576) return 700;
  if (h > 0 && h <= 720) return 1000;
  if (h > 0 && h <= 1080) return 1800;
  return 2800;
}

function getSessionHlsSegmentCount(session) {
  if (!session?.hls?.enabled) return 0;
  const dir = safeText(session?.hls?.dir);
  if (!dir) return 0;
  try {
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const fileName of files) {
      if (/^seg-\d+\.ts$/i.test(fileName)) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function destroySessionHlsArtifacts(session) {
  if (!session?.hls) return;
  const hls = session.hls;

  try {
    if (hls.inputStream && !hls.inputStream.destroyed) {
      hls.inputStream.destroy();
    }
  } catch {
    // no-op
  }

  try {
    if (hls.ffmpegProcess && !hls.ffmpegProcess.killed) {
      hls.ffmpegProcess.kill("SIGKILL");
    }
  } catch {
    // no-op
  }

  safeRemoveDirSync(hls.dir);
  session.hls = createEmptySessionHlsState();
}

async function waitForHlsManifest(manifestPath, timeoutMs, sessionId) {
  const start = nowMs();

  while (nowMs() - start < timeoutMs) {
    const session = getSessionById(sessionId);
    if (!session) {
      throw new Error("Sesion cancelada.");
    }
    if (session.status === "error") {
      throw new Error(session.error || "Sesion con error.");
    }

    try {
      const stats = fs.statSync(manifestPath);
      if (stats.size > 16) {
        const text = fs.readFileSync(manifestPath, "utf8");
        const segmentCount = (text.match(/#EXTINF:/g) || []).length;
        if (text.includes("#EXTM3U") && segmentCount >= PLAYBACK_HLS_READY_SEGMENTS) {
          return;
        }
      }
    } catch {
      // waiting...
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timeout generando playlist HLS.");
}

async function startSessionHlsTranscode(session) {
  if (!session?.id || !session?.file) {
    throw new Error("Sesion o archivo no disponible para HLS.");
  }
  if (!PLAYBACK_HLS_ENABLED) {
    throw new Error("HLS deshabilitado por configuracion.");
  }

  ensureDirSync(PLAYBACK_HLS_DIR);
  const dir = path.join(PLAYBACK_HLS_DIR, session.id);
  safeRemoveDirSync(dir);
  ensureDirSync(dir);

  const manifestPath = path.join(dir, "index.m3u8");
  const segmentPattern = path.join(dir, "seg-%05d.ts");
  session.hls = {
    enabled: true,
    status: "loading",
    error: null,
    dir,
    manifestPath,
    playlistPath: `/api/playback/sessions/${session.id}/hls/index.m3u8`,
    ffmpegProcess: null,
    inputStream: null,
    lastStderr: "",
    lastSegmentCount: 0,
    lastSegmentAt: nowMs(),
    lastManifestLogAt: 0
  };
  session.streamKind = "hls";
  pushPlaybackAttemptEvent("hls-started", {
    sessionId: session.id,
    providerId: session.providerId || null,
    sourceKey: compactText(session.sourceKey, 120) || null,
    fileName: compactText(session.file?.name, 220) || null,
    preset: PLAYBACK_HLS_PRESET,
    maxHeight: PLAYBACK_HLS_MAX_HEIGHT
  });

  const needsTranscode = session.needsTranscode !== false;
  const inputResolutionHint = extractResolutionHintFromText(session.file?.name);
  const shouldScaleDown = needsTranscode && inputResolutionHint > PLAYBACK_HLS_MAX_HEIGHT;
  const outputHeightHint =
    shouldScaleDown ? PLAYBACK_HLS_MAX_HEIGHT : inputResolutionHint || Math.min(PLAYBACK_HLS_MAX_HEIGHT, 1080);
  const videoMaxrateKbps = resolveHlsVideoMaxrateKbps(outputHeightHint);
  const videoBufsizeKbps = videoMaxrateKbps * 2;

  // Si el video es x264 (no HEVC), remux sin re-encode (mucho más rápido)
  const videoCodecArgs = needsTranscode
    ? [
        "-c:v", "libx264",
        "-preset", PLAYBACK_HLS_PRESET,
        "-crf", String(PLAYBACK_HLS_CRF),
        ...(shouldScaleDown ? ["-vf", `scale=-2:${PLAYBACK_HLS_MAX_HEIGHT}`] : []),
        "-maxrate", `${videoMaxrateKbps}k`,
        "-bufsize", `${videoBufsizeKbps}k`,
        "-g", "48",
        "-keyint_min", "48",
        "-sc_threshold", "0",
        "-tune", "zerolatency"
      ]
    : ["-c:v", "copy"];

  console.log(`[HLS-DEBUG] ${session.id}: needsTranscode=${needsTranscode} scaleDown=${shouldScaleDown} maxHeight=${PLAYBACK_HLS_MAX_HEIGHT} file=${(session.file?.name || "").slice(0, 60)}`);

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-fflags",
    "+genpts",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...videoCodecArgs,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-sn",
    "-f",
    "hls",
    "-hls_time",
    String(PLAYBACK_HLS_SEGMENT_SECONDS),
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    segmentPattern,
    manifestPath
  ];

  let ffmpeg;
  try {
    ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, { stdio: ["pipe", "ignore", "pipe"] });
  } catch (error) {
    throw new Error(`No se pudo iniciar ffmpeg (${FFMPEG_PATH}): ${error?.message || error}`);
  }
  session.hls.ffmpegProcess = ffmpeg;

  ffmpeg.stderr?.on("data", (chunk) => {
    const text = String(chunk || "");
    if (!text) return;
    session.hls.lastStderr = compactText(text, 320);
  });

  ffmpeg.on("error", (error) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession) return;
    const reason = `ffmpeg error: ${error?.message || "desconocido"}`;
    activeSession.status = "error";
    activeSession.error = reason;
    activeSession.hls.status = "error";
    activeSession.hls.error = reason;
    markSessionOutcome(activeSession, false, reason);
    pushPlaybackAttemptEvent("hls-error", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      reason: compactText(reason, 220)
    });
  });

  ffmpeg.on("exit", (code, signal) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession) return;
    pushPlaybackAttemptEvent("hls-exit", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      code: Number.isFinite(Number(code)) ? Number(code) : null,
      signal: signal || null,
      status: activeSession.hls?.status || "unknown",
      stderr: compactText(activeSession.hls?.lastStderr, 220) || null
    });

    if (activeSession.hls?.status === "ready") {
      return;
    }

    const reason = compactText(
      activeSession.hls?.lastStderr || `ffmpeg finalizo antes de preparar HLS (code ${code ?? "?"}).`,
      220
    );
    activeSession.status = "error";
    activeSession.error = reason;
    activeSession.hls.status = "error";
    activeSession.hls.error = reason;
    markSessionOutcome(activeSession, false, reason);
  });

  const inputStream = session.file.createReadStream();
  session.hls.inputStream = inputStream;
  inputStream.on("error", (error) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession || activeSession.hls?.status === "ready") return;
    const reason = `Error leyendo torrent para HLS: ${error?.message || "desconocido"}`;
    activeSession.status = "error";
    activeSession.error = reason;
    activeSession.hls.status = "error";
    activeSession.hls.error = reason;
    markSessionOutcome(activeSession, false, reason);
    pushPlaybackAttemptEvent("hls-input-error", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      reason: compactText(reason, 220)
    });
  });

  inputStream.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on("error", () => {
    // no-op: common when ffmpeg exits first
  });

  await waitForHlsManifest(manifestPath, PLAYBACK_HLS_START_TIMEOUT_MS, session.id);
  const activeSession = getSessionById(session.id);
  if (!activeSession) {
    throw new Error("Sesion cancelada.");
  }
  if (activeSession.status === "error") {
    throw new Error(activeSession.error || "Sesion con error durante HLS.");
  }

  activeSession.status = "ready";
  activeSession.hls.status = "ready";
  activeSession.hls.error = null;
  touchSession(activeSession);
  pushPlaybackAttemptEvent("hls-ready", {
    sessionId: activeSession.id,
    providerId: activeSession.providerId || null,
    sourceKey: compactText(activeSession.sourceKey, 120) || null,
    manifest: activeSession.hls.playlistPath || null
  });
}

async function startDirectUrlHlsTranscode(session) {
  if (!session?.id || !session?.directUrl) {
    throw new Error("Sesion o URL directa no disponible para HLS.");
  }
  if (!PLAYBACK_HLS_ENABLED) {
    throw new Error("HLS deshabilitado por configuracion.");
  }

  ensureDirSync(PLAYBACK_HLS_DIR);
  const dir = path.join(PLAYBACK_HLS_DIR, session.id);
  safeRemoveDirSync(dir);
  ensureDirSync(dir);

  const manifestPath = path.join(dir, "index.m3u8");
  const segmentPattern = path.join(dir, "seg-%05d.ts");
  session.hls = {
    enabled: true,
    status: "loading",
    error: null,
    dir,
    manifestPath,
    playlistPath: `/api/playback/sessions/${session.id}/hls/index.m3u8`,
    ffmpegProcess: null,
    inputStream: null,
    lastStderr: "",
    lastSegmentCount: 0,
    lastSegmentAt: nowMs(),
    lastManifestLogAt: 0
  };
  session.streamKind = "hls";
  pushPlaybackAttemptEvent("hls-direct-started", {
    sessionId: session.id,
    providerId: session.providerId || null,
    sourceKey: compactText(session.sourceKey, 120) || null,
    directUrl: compactText(session.directUrl, 220) || null,
    preset: PLAYBACK_HLS_PRESET,
    maxHeight: PLAYBACK_HLS_MAX_HEIGHT
  });

  const needsTranscode = session.needsTranscode !== false;
  const inputResolutionHint = extractResolutionHintFromText(session.displayName || "");
  const shouldScaleDown = needsTranscode && inputResolutionHint > PLAYBACK_HLS_MAX_HEIGHT;
  const outputHeightHint =
    shouldScaleDown ? PLAYBACK_HLS_MAX_HEIGHT : inputResolutionHint || Math.min(PLAYBACK_HLS_MAX_HEIGHT, 1080);
  const videoMaxrateKbps = resolveHlsVideoMaxrateKbps(outputHeightHint);
  const videoBufsizeKbps = videoMaxrateKbps * 2;

  const videoCodecArgs = needsTranscode
    ? [
        "-c:v", "libx264",
        "-preset", PLAYBACK_HLS_PRESET,
        "-crf", String(PLAYBACK_HLS_CRF),
        ...(shouldScaleDown ? ["-vf", `scale=-2:${PLAYBACK_HLS_MAX_HEIGHT}`] : []),
        "-maxrate", `${videoMaxrateKbps}k`,
        "-bufsize", `${videoBufsizeKbps}k`,
        "-g", "48",
        "-keyint_min", "48",
        "-sc_threshold", "0",
        "-tune", "zerolatency"
      ]
    : ["-c:v", "copy"];

  console.log(`[HLS-DIRECT-DEBUG] ${session.id}: needsTranscode=${needsTranscode} scaleDown=${shouldScaleDown} maxHeight=${PLAYBACK_HLS_MAX_HEIGHT} url=${(session.directUrl || "").slice(0, 80)}`);

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-fflags",
    "+genpts",
    "-headers",
    "User-Agent: streams-mvp/1.0\r\n",
    "-i",
    session.directUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...videoCodecArgs,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-sn",
    "-f",
    "hls",
    "-hls_time",
    String(PLAYBACK_HLS_SEGMENT_SECONDS),
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    segmentPattern,
    manifestPath
  ];

  let ffmpeg;
  try {
    ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    throw new Error(`No se pudo iniciar ffmpeg (${FFMPEG_PATH}): ${error?.message || error}`);
  }
  session.hls.ffmpegProcess = ffmpeg;

  ffmpeg.stderr?.on("data", (chunk) => {
    const text = String(chunk || "");
    if (!text) return;
    session.hls.lastStderr = compactText(text, 320);
  });

  ffmpeg.on("error", (error) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession) return;
    const reason = `ffmpeg error: ${error?.message || "desconocido"}`;
    activeSession.status = "error";
    activeSession.error = reason;
    activeSession.hls.status = "error";
    activeSession.hls.error = reason;
    markSessionOutcome(activeSession, false, reason);
    pushPlaybackAttemptEvent("hls-direct-error", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      reason: compactText(reason, 220)
    });
  });

  ffmpeg.on("exit", (code, signal) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession) return;
    pushPlaybackAttemptEvent("hls-direct-exit", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      code: Number.isFinite(Number(code)) ? Number(code) : null,
      signal: signal || null,
      status: activeSession.hls?.status || "unknown",
      stderr: compactText(activeSession.hls?.lastStderr, 220) || null
    });

    if (activeSession.hls?.status === "ready") {
      return;
    }

    const reason = compactText(
      activeSession.hls?.lastStderr || `ffmpeg finalizo antes de preparar HLS (code ${code ?? "?"}).`,
      220
    );
    activeSession.status = "error";
    activeSession.error = reason;
    activeSession.hls.status = "error";
    activeSession.hls.error = reason;
    markSessionOutcome(activeSession, false, reason);
  });

  // No hay inputStream ni pipe — ffmpeg lee directo de la URL HTTP

  await waitForHlsManifest(manifestPath, PLAYBACK_HLS_START_TIMEOUT_MS, session.id);
  const activeSession = getSessionById(session.id);
  if (!activeSession) {
    throw new Error("Sesion cancelada.");
  }
  if (activeSession.status === "error") {
    throw new Error(activeSession.error || "Sesion con error durante HLS.");
  }

  activeSession.status = "ready";
  activeSession.hls.status = "ready";
  activeSession.hls.error = null;
  touchSession(activeSession);
  pushPlaybackAttemptEvent("hls-direct-ready", {
    sessionId: activeSession.id,
    providerId: activeSession.providerId || null,
    sourceKey: compactText(activeSession.sourceKey, 120) || null,
    manifest: activeSession.hls.playlistPath || null
  });
}

module.exports = {
  createEmptySessionHlsState,
  readHlsManifestSegmentCount,
  getSessionHlsSegmentCount,
  destroySessionHlsArtifacts,
  startSessionHlsTranscode,
  startDirectUrlHlsTranscode,
  pushPlaybackAttemptEvent
};
