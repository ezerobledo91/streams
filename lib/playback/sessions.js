const fs = require("fs");
const path = require("path");
const { safeText, compactText, nowMs, buildStreamSourceKey, safeRemoveDirSync } = require("../utils");
const { shouldUseHlsForFileName } = require("../utils");
const {
  PLAYBACK_MAX_SESSIONS,
  PLAYBACK_SESSION_TTL_MS,
  PLAYBACK_HLS_DIR,
  DEFAULT_PUBLIC_TRACKERS,
  BROWSER_NATIVE_VIDEO_EXTENSIONS,
  PLAYBACK_HLS_ENABLED,
  PLAYBACK_HLS_FORCE
} = require("../config");
const { playbackSessions } = require("../state");
const { normalizeProviderId } = require("../utils");
const { markSessionOutcome } = require("../reliability/tracker");
const { ensurePlaybackClient, buildSessionMagnet } = require("./client");
const { pickTorrentFile, isLikelyHevc } = require("./files");
const { pickSubtitleFiles } = require("../subtitles/detector");
const {
  createEmptySessionHlsState,
  destroySessionHlsArtifacts,
  startSessionHlsTranscode,
  startDirectUrlHlsTranscode,
  pushPlaybackAttemptEvent
} = require("./hls");

function getSessionById(sessionId) {
  return playbackSessions.get(sessionId) || null;
}

function touchSession(session) {
  session.lastAccessAt = nowMs();
}

async function waitForSessionStatusChange(sessionId, timeoutMs = 0) {
  const { clamp } = require("../utils");
  const maxWait = clamp(Number(timeoutMs) || 0, 0, 180000);
  if (!maxWait) {
    return getSessionById(sessionId);
  }
  const startedAt = nowMs();
  while (nowMs() - startedAt < maxWait) {
    const session = getSessionById(sessionId);
    if (!session) return null;
    if (session.status !== "loading") {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getSessionById(sessionId);
}

function destroySession(sessionId, reason = "manual") {
  const session = playbackSessions.get(sessionId);
  if (!session) return false;

  destroySessionHlsArtifacts(session);

  try {
    if (session.torrent && !session.torrent.destroyed) {
      session.torrent.destroy();
    }
  } catch {
    // no-op
  }

  pushPlaybackAttemptEvent("session-destroyed", {
    sessionId: session.id,
    providerId: session.providerId || null,
    sourceKey: compactText(session.sourceKey, 120) || null,
    reason: compactText(reason, 120) || null,
    status: session.status,
    reliabilityOutcome: session.reliabilityOutcome || "none",
    error: compactText(session.error, 180) || null
  });
  playbackSessions.delete(sessionId);
  return true;
}

function cleanupPlaybackSessions() {
  const now = nowMs();
  for (const [sessionId, session] of playbackSessions.entries()) {
    if (now - session.lastAccessAt > PLAYBACK_SESSION_TTL_MS) {
      destroySession(sessionId, "ttl-expired");
    }
  }
  cleanupOrphanedHlsDirs();
}

function cleanupOrphanedHlsDirs() {
  try {
    if (!fs.existsSync(PLAYBACK_HLS_DIR)) return;
    const entries = fs.readdirSync(PLAYBACK_HLS_DIR, { withFileTypes: true });
    const activeSessionIds = new Set(playbackSessions.keys());
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!activeSessionIds.has(entry.name)) {
        const orphanDir = path.join(PLAYBACK_HLS_DIR, entry.name);
        safeRemoveDirSync(orphanDir);
        console.log(`[HLS-CLEANUP] Directorio huerfano eliminado: ${entry.name}`);
      }
    }
  } catch {
    // no-op
  }
}

function enforcePlaybackSessionLimit() {
  if (playbackSessions.size < PLAYBACK_MAX_SESSIONS) return;

  const rank = (session) => {
    if (session.status === "loading") return 0;
    if (session.status === "error") return 1;
    return 2;
  };

  const ordered = [...playbackSessions.values()].sort((a, b) => {
    const rankA = rank(a);
    const rankB = rank(b);
    if (rankA !== rankB) return rankA - rankB;
    return Number(a.lastAccessAt || a.createdAt || 0) - Number(b.lastAccessAt || b.createdAt || 0);
  });

  const overflow = playbackSessions.size - PLAYBACK_MAX_SESSIONS + 1;
  for (let index = 0; index < overflow && index < ordered.length; index += 1) {
    destroySession(ordered[index].id, "limit-evict");
  }
}

async function createPlaybackSession({
  magnet,
  infoHash,
  displayName,
  trackers,
  fileIdx,
  providerId,
  sourceKey,
  season,
  episode,
  forceHls
}) {
  cleanupPlaybackSessions();
  enforcePlaybackSessionLimit();

  const magnetUri = buildSessionMagnet({ magnet, infoHash, displayName, trackers });
  if (!magnetUri) {
    throw new Error("No se pudo construir magnet para la sesion.");
  }

  const requestedPreferredFileIdx = Number.isInteger(Number(fileIdx)) ? Number(fileIdx) : null;
  const requestedExpectedEpisodeKey =
    Number.isInteger(Number(season)) && Number(season) > 0 && Number.isInteger(Number(episode)) && Number(episode) > 0
      ? `${Number(season)}x${Number(episode)}`
      : "";
  const requestedSourceKey = safeText(sourceKey) || buildStreamSourceKey(infoHash) || buildStreamSourceKey(magnetUri);
  const normalizedSourceKey = safeText(requestedSourceKey);

  if (normalizedSourceKey) {
    for (const existingSession of playbackSessions.values()) {
      if (safeText(existingSession?.sourceKey) !== normalizedSourceKey) continue;
      if ((existingSession?.preferredFileIdx ?? null) !== requestedPreferredFileIdx) continue;
      if (safeText(existingSession?.expectedEpisodeKey) !== requestedExpectedEpisodeKey) continue;
      if (existingSession?.status === "error") continue;
      if (forceHls && existingSession.streamKind !== "hls") {
        // Destruir sesión directa existente para liberar el torrent antes de recrear con HLS
        destroySession(existingSession.id, "force-hls-replace");
        continue;
      }
      touchSession(existingSession);
      pushPlaybackAttemptEvent("session-reused", {
        sessionId: existingSession.id,
        providerId: existingSession.providerId || null,
        sourceKey: compactText(existingSession.sourceKey, 120) || null,
        status: existingSession.status
      });
      return existingSession;
    }
  }

  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    id,
    status: "loading",
    error: null,
    streamKind: "direct",
    magnet: magnetUri,
    providerId: safeText(providerId) ? normalizeProviderId(providerId) : "",
    sourceKey: requestedSourceKey,
    reliabilityOutcome: "none",
    reliabilityReason: "",
    torrent: null,
    file: null,
    subtitles: [],
    hls: createEmptySessionHlsState(),
    preferredFileIdx: requestedPreferredFileIdx,
    expectedEpisodeKey: requestedExpectedEpisodeKey,
    createdAt: nowMs(),
    forceHls: Boolean(forceHls),
    lastAccessAt: nowMs()
  };
  playbackSessions.set(id, session);
  pushPlaybackAttemptEvent("session-created", {
    sessionId: id,
    providerId: session.providerId || null,
    sourceKey: compactText(session.sourceKey, 120) || null,
    preferredFileIdx: session.preferredFileIdx,
    expectedEpisodeKey: session.expectedEpisodeKey || null,
    displayName: compactText(displayName, 180) || null
  });

  const client = await ensurePlaybackClient();

  const sourceKeyForClient = safeText(session.sourceKey);
  if (sourceKeyForClient) {
    for (const [existingId, existingSession] of playbackSessions.entries()) {
      if (existingId === id) continue;
      if (safeText(existingSession?.sourceKey) !== sourceKeyForClient) continue;
      if (existingSession?.status === "error") {
        destroySession(existingId, "duplicate-source-error");
      } else if (forceHls && existingSession.streamKind !== "hls") {
        destroySession(existingId, "force-hls-replace-dup");
      }
    }
  }

  const announce = (Array.isArray(trackers) && trackers.length ? trackers : DEFAULT_PUBLIC_TRACKERS)
    .map((item) => safeText(item))
    .filter(Boolean);

  const torrent = client.add(magnetUri, {
    announce: announce.length ? announce : undefined,
    destroyStoreOnDestroy: true
  });
  session.torrent = torrent;

  torrent.on("ready", () => {
    try {
      const file = pickTorrentFile(torrent, session.preferredFileIdx, session.expectedEpisodeKey);
      if (!file) {
        session.status = "error";
        session.error = session.expectedEpisodeKey
          ? "El torrent no contiene el episodio solicitado."
          : "El torrent no contiene archivo de video soportado.";
        markSessionOutcome(session, false, session.error);
        pushPlaybackAttemptEvent("session-error", {
          sessionId: session.id,
          providerId: session.providerId || null,
          sourceKey: compactText(session.sourceKey, 120) || null,
          reason: session.error
        });
        return;
      }
      session.file = file;
      session.subtitles = pickSubtitleFiles(torrent, file);
      const forceHlsHevc = PLAYBACK_HLS_ENABLED && isLikelyHevc(file?.name);
      const userForceHls = Boolean(session.forceHls) && PLAYBACK_HLS_ENABLED;
      if (forceHlsHevc || userForceHls || shouldUseHlsForFileName(file?.name, PLAYBACK_HLS_ENABLED, PLAYBACK_HLS_FORCE, BROWSER_NATIVE_VIDEO_EXTENSIONS)) {
        session.streamKind = "hls";
        session.needsTranscode = forceHlsHevc;
        session.status = "loading";
        touchSession(session);
        void startSessionHlsTranscode(session).catch((error) => {
          const activeSession = getSessionById(session.id);
          if (!activeSession) return;
          activeSession.status = "error";
          activeSession.error = compactText(error?.message || "No se pudo preparar HLS.", 220);
          activeSession.hls.status = "error";
          activeSession.hls.error = activeSession.error;
          markSessionOutcome(activeSession, false, activeSession.error);
          pushPlaybackAttemptEvent("hls-error", {
            sessionId: activeSession.id,
            providerId: activeSession.providerId || null,
            sourceKey: compactText(activeSession.sourceKey, 120) || null,
            reason: compactText(activeSession.error, 220)
          });
        });
      } else {
        session.streamKind = "direct";
        session.status = "ready";
        touchSession(session);
        pushPlaybackAttemptEvent("session-ready", {
          sessionId: session.id,
          providerId: session.providerId || null,
          sourceKey: compactText(session.sourceKey, 120) || null,
          fileName: compactText(file?.name, 220) || null,
          fileLength: Number(file?.length || 0),
          numPeers: Number(torrent?.numPeers || 0),
          downloadSpeed: Number(torrent?.downloadSpeed || 0),
          progress: Number(torrent?.progress || 0),
          streamKind: "direct"
        });
      }
    } catch (error) {
      session.status = "error";
      session.error = error.message || "No se pudo preparar archivo del torrent.";
      markSessionOutcome(session, false, session.error);
      pushPlaybackAttemptEvent("session-error", {
        sessionId: session.id,
        providerId: session.providerId || null,
        sourceKey: compactText(session.sourceKey, 120) || null,
        reason: compactText(session.error, 180)
      });
    }
  });

  torrent.on("error", (error) => {
    session.status = "error";
    session.error = error?.message || "Error en motor torrent.";
    markSessionOutcome(session, false, session.error);
    pushPlaybackAttemptEvent("torrent-error", {
      sessionId: session.id,
      providerId: session.providerId || null,
      sourceKey: compactText(session.sourceKey, 120) || null,
      reason: compactText(session.error, 180)
    });
  });

  return session;
}

async function createDirectHlsSession({
  directUrl,
  displayName,
  providerId,
  sourceKey
}) {
  cleanupPlaybackSessions();
  enforcePlaybackSessionLimit();

  const normalizedDirectUrl = safeText(directUrl);
  if (!normalizedDirectUrl) {
    throw new Error("No se envio directUrl para crear sesion HLS.");
  }
  if (!PLAYBACK_HLS_ENABLED) {
    throw new Error("HLS deshabilitado por configuracion.");
  }

  const requestedSourceKey = safeText(sourceKey) || buildStreamSourceKey(normalizedDirectUrl);
  const normalizedSourceKey = safeText(requestedSourceKey);

  if (normalizedSourceKey) {
    for (const existingSession of playbackSessions.values()) {
      if (safeText(existingSession?.sourceKey) !== normalizedSourceKey) continue;
      if (existingSession?.status === "error") continue;
      if (existingSession?.streamKind !== "hls") {
        destroySession(existingSession.id, "force-hls-replace-direct");
        continue;
      }
      touchSession(existingSession);
      pushPlaybackAttemptEvent("session-reused", {
        sessionId: existingSession.id,
        providerId: existingSession.providerId || null,
        sourceKey: compactText(existingSession.sourceKey, 120) || null,
        status: existingSession.status
      });
      return existingSession;
    }
  }

  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedDisplayName = safeText(displayName);
  const shouldTranscodeVideo = isLikelyHevc(normalizedDisplayName || normalizedDirectUrl);
  const session = {
    id,
    status: "loading",
    error: null,
    streamKind: "hls",
    magnet: null,
    directUrl: normalizedDirectUrl,
    providerId: safeText(providerId) ? normalizeProviderId(providerId) : "",
    sourceKey: requestedSourceKey,
    reliabilityOutcome: "none",
    reliabilityReason: "",
    torrent: null,
    file: null,
    subtitles: [],
    hls: createEmptySessionHlsState(),
    preferredFileIdx: null,
    expectedEpisodeKey: "",
    createdAt: nowMs(),
    forceHls: true,
    lastAccessAt: nowMs(),
    needsTranscode: shouldTranscodeVideo,
    displayName: normalizedDisplayName
  };
  playbackSessions.set(id, session);
  pushPlaybackAttemptEvent("session-created", {
    sessionId: id,
    providerId: session.providerId || null,
    sourceKey: compactText(session.sourceKey, 120) || null,
    preferredFileIdx: null,
    expectedEpisodeKey: null,
    displayName: compactText(displayName, 180) || null
  });

  if (normalizedSourceKey) {
    for (const [existingId, existingSession] of playbackSessions.entries()) {
      if (existingId === id) continue;
      if (safeText(existingSession?.sourceKey) !== normalizedSourceKey) continue;
      if (existingSession?.status === "error") {
        destroySession(existingId, "duplicate-source-error");
      } else if (existingSession?.streamKind !== "hls") {
        destroySession(existingId, "force-hls-replace-dup-direct");
      }
    }
  }

  void startDirectUrlHlsTranscode(session).catch((error) => {
    const activeSession = getSessionById(session.id);
    if (!activeSession) return;
    activeSession.status = "error";
    activeSession.error = compactText(error?.message || "No se pudo preparar HLS directo.", 220);
    activeSession.hls.status = "error";
    activeSession.hls.error = activeSession.error;
    markSessionOutcome(activeSession, false, activeSession.error);
    pushPlaybackAttemptEvent("hls-direct-error", {
      sessionId: activeSession.id,
      providerId: activeSession.providerId || null,
      sourceKey: compactText(activeSession.sourceKey, 120) || null,
      reason: compactText(activeSession.error, 220)
    });
  });

  return session;
}

module.exports = {
  getSessionById,
  touchSession,
  waitForSessionStatusChange,
  destroySession,
  cleanupPlaybackSessions,
  cleanupOrphanedHlsDirs,
  createPlaybackSession,
  createDirectHlsSession
};
