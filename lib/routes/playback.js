const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { safeText, clamp, compactText, nowMs, buildStreamSourceKey, normalizeProviderId } = require("../utils");
const { PLAYBACK_HLS_READY_SEGMENTS, PLAYBACK_HLS_STALL_MS, PLAYBACK_HLS_STALL_MIN_SPEED_BPS } = require("../config");
const { playbackAttemptLog, playbackPreflightCache } = require("../state");
const { registerPlaybackOutcome, markSessionOutcome } = require("../reliability/tracker");
const {
  createPlaybackSession,
  getSessionById,
  touchSession,
  waitForSessionStatusChange,
  destroySession
} = require("../playback/sessions");
const { sessionPublicInfo, pipeTorrentFileToResponse } = require("../playback/stream");
const { readHlsManifestSegmentCount, pushPlaybackAttemptEvent } = require("../playback/hls");
const { streamToBuffer, toWebVtt } = require("../subtitles/converter");
const { fetchAggregatedStreams } = require("../streams/service");
const {
  buildCandidatesFromResults,
  orderCandidatesForPlayback,
  qualityBucketFromResolution,
  getTrackers
} = require("../playback/candidates");

function summarizeCandidate(candidate) {
  return {
    providerId: candidate.providerId,
    providerName: candidate.providerName,
    displayName: candidate.displayName,
    resolution: candidate.resolution,
    score: Number(candidate.score || 0),
    seeders: Number(candidate.seeders || 0),
    peers: Number(candidate.peers || 0),
    webFriendly: Boolean(candidate.webFriendly),
    fileExtension: candidate.fileExtension,
    likelyIncompatible: Boolean(candidate.likelyIncompatible),
    hasMagnet: Boolean(candidate.magnet),
    hasDirectUrl: Boolean(candidate.directUrl),
    fileIdx: Number.isInteger(candidate.fileIdx) ? candidate.fileIdx : null
  };
}

function buildCandidateSourceKey(candidate) {
  return (
    buildStreamSourceKey(candidate?.stream?.behaviorHints?.reliabilitySourceKey) ||
    buildStreamSourceKey(candidate?.stream?.infoHash) ||
    buildStreamSourceKey(candidate?.magnet) ||
    buildStreamSourceKey(candidate?.directUrl) ||
    ""
  );
}

const QUALITY_ORDER = ["4k", "1080p", "720p", "sd"];
const PREFLIGHT_CACHE_TTL_MS = 45 * 1000;

function normalizeAudioPreference(value) {
  return safeText(value).toLowerCase() === "es" ? "es" : "original";
}

function normalizeLanguageCode(value) {
  const raw = safeText(value).toLowerCase().trim();
  if (!raw) return "";
  if (raw === "spa") return "es";
  if (raw === "eng") return "en";
  if (raw === "es-la" || raw === "es_419" || raw.startsWith("es-419")) return "es-419";
  if (raw.includes("-")) return raw.split("-")[0];
  return raw;
}

function parseAudioSelection(req) {
  return {
    audioPreference: normalizeAudioPreference(req.body?.audioPreference || req.query.audioPreference),
    originalLanguage: normalizeLanguageCode(req.body?.originalLanguage || req.query.originalLanguage)
  };
}

function pickAvailableQualities(entriesByQuality) {
  return QUALITY_ORDER.filter((item) => entriesByQuality.has(item));
}

function estimateAutoEntryRank(entry) {
  const candidate = entry?.candidate || {};
  const sizeGb = Number(candidate.videoSizeBytes || 0) / (1024 * 1024 * 1024);
  const qualityBonus =
    entry?.bucket === "4k" ? 24 : entry?.bucket === "1080p" ? 16 : entry?.bucket === "720p" ? 10 : 4;
  const speedScore =
    Number(candidate.seeders || 0) * 5 +
    Number(candidate.peers || 0) * 1.5 +
    Number(candidate.score || 0) * 0.75 -
    sizeGb * 12 +
    qualityBonus;
  if (entry?.streamKind === "direct") {
    return speedScore + 420;
  }
  return speedScore - 180;
}

function pickAutoEntry(entriesByQuality) {
  let bestEntry = null;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const bucket of QUALITY_ORDER) {
    const entry = entriesByQuality.get(bucket);
    if (!entry) continue;
    const rank = estimateAutoEntryRank(entry);
    if (rank > bestRank) {
      bestRank = rank;
      bestEntry = entry;
    }
  }
  return bestEntry;
}

function pickSelectedEntry(entriesByQuality, availableQualities, normalizedQuality) {
  if (normalizedQuality !== "auto") {
    return entriesByQuality.get(normalizedQuality) || null;
  }
  return entriesByQuality.get(availableQualities[0]) || null;
}

function buildPreflightCacheKey({
  type,
  itemId,
  season,
  episode,
  quality,
  maxCandidates,
  audioPreference,
  originalLanguage
}) {
  const normalizedType = safeText(type).toLowerCase();
  const normalizedItem = safeText(itemId).toLowerCase();
  const normalizedSeason = safeText(season);
  const normalizedEpisode = safeText(episode);
  const normalizedQuality = safeText(quality).toLowerCase();
  const normalizedPreference = normalizeAudioPreference(audioPreference);
  const normalizedOriginal = normalizeLanguageCode(originalLanguage);
  return `${normalizedType}|${normalizedItem}|${normalizedSeason}|${normalizedEpisode}|${normalizedQuality}|${Number(maxCandidates || 0)}|${normalizedPreference}|${normalizedOriginal}`;
}

function ensurePreflightCacheLimit(maxItems = 240) {
  if (playbackPreflightCache.size <= maxItems) return;
  const entries = [...playbackPreflightCache.entries()].sort(
    (a, b) => Number(a?.[1]?.cachedAt || 0) - Number(b?.[1]?.cachedAt || 0)
  );
  const toDelete = playbackPreflightCache.size - maxItems;
  for (let index = 0; index < toDelete && index < entries.length; index += 1) {
    playbackPreflightCache.delete(entries[index][0]);
  }
}

function buildAutoPayloadFromEntry(entry) {
  if (!entry) return null;
  return {
    mode: entry.mode,
    status: "ready",
    streamUrl: entry.streamUrl,
    streamKind: entry.streamKind || "direct",
    sessionId: entry.sessionId || null,
    session: entry.session || null,
    chosen: summarizeCandidate(entry.candidate),
    selectedQuality: entry.bucket
  };
}

async function probeDirectStream(directUrl, timeoutMs = 6000) {
  const url = safeText(directUrl);
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "url-invalida" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        range: "bytes=0-1",
        accept: "video/*,application/vnd.apple.mpegurl,*/*",
        "user-agent": "streams-mvp/1.0"
      }
    });

    if (!response.ok && response.status !== 206 && response.status !== 405 && response.status !== 416) {
      return {
        ok: false,
        status: response.status,
        reason: `http-${response.status}`
      };
    }

    if (response.status === 405 || response.status === 416) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "video/*,application/vnd.apple.mpegurl,*/*",
          "user-agent": "streams-mvp/1.0"
        }
      });
      if (!response.ok && response.status !== 206) {
        return {
          ok: false,
          status: response.status,
          reason: `http-${response.status}`
        };
      }
    }

    const contentType = safeText(response.headers.get("content-type")).toLowerCase();
    const urlLooksPlayable = /\.(m3u8|mp4|m4v|webm)(?:$|[?#])/i.test(url);
    const blockedTypes = ["text/html", "video/x-matroska", "video/x-msvideo", "video/avi", "video/x-ms-wmv"];
    const allowedTypes = [
      "video/mp4",
      "video/webm",
      "video/x-m4v",
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl"
    ];
    const contentLooksPlayable = allowedTypes.some((type) => contentType.includes(type));
    const contentLooksBlocked = blockedTypes.some((type) => contentType.includes(type));

    if (contentLooksBlocked) {
      return {
        ok: false,
        status: response.status,
        contentType,
        reason: "content-type-incompatible"
      };
    }

    if (!contentLooksPlayable && !urlLooksPlayable) {
      return {
        ok: false,
        status: response.status,
        contentType,
        reason: "direct-not-compatible"
      };
    }

    return {
      ok: true,
      status: response.status,
      contentType
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "timeout" : safeText(error?.message) || "probe-failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function registerPlaybackRoutes(app) {
  app.get("/api/playback/attempts", (req, res) => {
    const limit = clamp(Number.parseInt(req.query.limit, 10) || 120, 20, 1000);
    const sessionId = safeText(req.query.sessionId);
    const providerIdRaw = safeText(req.query.providerId);
    const providerId = providerIdRaw ? normalizeProviderId(providerIdRaw) : "";
    const event = safeText(req.query.event).toLowerCase();

    const items = [];
    for (let index = playbackAttemptLog.length - 1; index >= 0; index -= 1) {
      const item = playbackAttemptLog[index];
      if (sessionId && item.sessionId !== sessionId) continue;
      if (providerId && normalizeProviderId(item.providerId) !== providerId) continue;
      if (event && safeText(item.event).toLowerCase() !== event) continue;
      items.push(item);
      if (items.length >= limit) break;
    }

    return res.json({
      total: playbackAttemptLog.length,
      returned: items.length,
      limit,
      items
    });
  });

  app.post("/api/playback/sessions", async (req, res) => {
    try {
      const session = await createPlaybackSession({
        magnet: req.body?.magnet,
        infoHash: req.body?.infoHash,
        displayName: req.body?.displayName,
        trackers: req.body?.trackers,
        fileIdx: req.body?.fileIdx,
        providerId: req.body?.providerId,
        sourceKey: req.body?.sourceKey,
        season: req.body?.season,
        episode: req.body?.episode
      });
      const waitReadyMs = clamp(Number.parseInt(req.query.waitReadyMs ?? req.body?.waitReadyMs, 10) || 0, 0, 120000);
      const finalSession = waitReadyMs ? await waitForSessionStatusChange(session.id, waitReadyMs) : session;
      if (!finalSession) {
        return res.status(404).json({ error: "Sesion no encontrada." });
      }
      return res.status(201).json(sessionPublicInfo(finalSession));
    } catch (error) {
      const providerId = safeText(req.body?.providerId) ? normalizeProviderId(req.body.providerId) : "";
      const sourceKey =
        buildStreamSourceKey(req.body?.sourceKey) ||
        buildStreamSourceKey(req.body?.infoHash) ||
        buildStreamSourceKey(req.body?.magnet);
      if (providerId) {
        registerPlaybackOutcome(providerId, sourceKey, false, error?.message || "No se pudo crear sesion.");
      }
      return res.status(400).json({ error: error.message || "No se pudo crear sesion de playback." });
    }
  });

  app.post("/api/playback/preflight", async (req, res) => {
    const startedAt = nowMs();
    const type = safeText(req.body?.type || req.query.type);
    const itemId = safeText(req.body?.itemId || req.query.itemId);
    const season = safeText(req.body?.season || req.query.season);
    const episode = safeText(req.body?.episode || req.query.episode);
    const quality = safeText(req.body?.quality || req.query.quality || "auto").toLowerCase();
    const normalizedQuality = ["auto", "4k", "1080p", "720p", "sd"].includes(quality) ? quality : "auto";
    const audioSelection = parseAudioSelection(req);
    const probeTimeoutMs = clamp(Number.parseInt(req.body?.probeTimeoutMs || req.query.probeTimeoutMs, 10) || 4500, 1500, 12000);
    const maxCandidates = clamp(Number.parseInt(req.body?.maxCandidates || req.query.maxCandidates, 10) || 18, 4, 60);
    const validationBudgetMs = clamp(
      Number.parseInt(req.body?.validationBudgetMs || req.query.validationBudgetMs, 10) || 12000,
      3000,
      30000
    );
    const warmupWaitMs = clamp(Number.parseInt(req.body?.warmupWaitMs || req.query.warmupWaitMs, 10) || 12000, 3000, 30000);
    const warmupEnabled = safeText((req.body?.warmup ?? req.query.warmup) || "true").toLowerCase() !== "false";

    if (!type || !itemId) {
      return res.status(400).json({ error: "Debes enviar type e itemId." });
    }

    const cacheKey = buildPreflightCacheKey({
      type,
      itemId,
      season,
      episode,
      quality: normalizedQuality,
      maxCandidates,
      audioPreference: audioSelection.audioPreference,
      originalLanguage: audioSelection.originalLanguage
    });
    const now = nowMs();
    const cached = playbackPreflightCache.get(cacheKey);
    if (cached && now - Number(cached.cachedAt || 0) <= PREFLIGHT_CACHE_TTL_MS) {
      const cachedRecommended = cached.payload?.recommended;
      if (cachedRecommended?.mode === "session" && cachedRecommended?.sessionId) {
        const liveSession = getSessionById(cachedRecommended.sessionId);
        if (!liveSession || liveSession.status !== "ready") {
          playbackPreflightCache.delete(cacheKey);
        } else {
          touchSession(liveSession);
          const liveInfo = sessionPublicInfo(liveSession);
          cached.payload.recommended = {
            ...cached.payload.recommended,
            streamUrl: liveInfo.streamUrl,
            streamKind: liveInfo.streamKind || cached.payload.recommended.streamKind || "direct",
            session: liveInfo
          };
          return res.json({
            ...cached.payload,
            cache: {
              hit: true,
              ttlMs: PREFLIGHT_CACHE_TTL_MS,
              ageMs: now - Number(cached.cachedAt || now)
            }
          });
        }
      } else {
        return res.json({
          ...cached.payload,
          cache: {
            hit: true,
            ttlMs: PREFLIGHT_CACHE_TTL_MS,
            ageMs: now - Number(cached.cachedAt || now)
          }
        });
      }
    }

    let aggregated;
    try {
      aggregated = await fetchAggregatedStreams({
        type,
        itemId,
        season,
        episode,
        onlyActive: true
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "No se pudieron resolver streams." });
    }

    const candidates = buildCandidatesFromResults(aggregated.results, audioSelection);
    if (!candidates.length) {
      return res.status(404).json({
        error: "No se encontraron streams candidatos.",
        summary: {
          requestedType: aggregated.requestedType,
          requestedItemId: aggregated.requestedItemId,
          resolvedType: aggregated.resolvedType,
          resolvedItemId: aggregated.resolvedItemId,
          providerCount: aggregated.providerCount
        }
      });
    }

    const orderedAuto = orderCandidatesForPlayback(candidates, "auto").slice(0, maxCandidates);
    const ordered =
      normalizedQuality === "auto"
        ? orderedAuto
        : [
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) === normalizedQuality),
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) !== normalizedQuality)
          ];
    const directCandidates = ordered.filter((candidate) => Boolean(candidate.directUrl));
    const fallbackCandidates = ordered.filter((candidate) => Boolean(candidate.magnet));
    const fallbackCandidatesForValidation =
      normalizedQuality === "auto"
        ? [
            ...fallbackCandidates.filter((candidate) => Boolean(candidate.webFriendly)),
            ...fallbackCandidates.filter((candidate) => !candidate.webFriendly && !candidate.likelyIncompatible),
            ...fallbackCandidates.filter((candidate) => Boolean(candidate.likelyIncompatible))
          ]
        : fallbackCandidates;

    const attempts = [];
    const validatedByQuality = new Map();
    const validatedNativeByQuality = new Map();
    const deadlineAt = nowMs() + validationBudgetMs;
    const attemptedSources = new Set();
    const upsertValidatedEntry = (entry, bucket) => {
      const current = validatedByQuality.get(bucket);
      let selected = current;
      if (!current) {
        selected = entry;
      } else if (current.streamKind !== entry.streamKind) {
        selected = entry.streamKind === "direct" ? entry : current;
      } else {
        selected = Number(entry?.candidate?.score || 0) > Number(current?.candidate?.score || 0) ? entry : current;
      }

      if (selected === entry) {
        if (current?.sessionId && current.sessionId !== entry.sessionId) {
          destroySession(current.sessionId, "preflight-replaced-quality");
        }
        validatedByQuality.set(bucket, entry);
        if (entry.streamKind === "direct") {
          validatedNativeByQuality.set(bucket, entry);
        } else {
          validatedNativeByQuality.delete(bucket);
        }
      } else if (entry.sessionId) {
        destroySession(entry.sessionId, "preflight-lower-score-quality");
      }
    };

    const maxDirectProbeCandidates = normalizedQuality === "auto" ? 6 : 10;
    let directProbesTried = 0;
    for (const candidate of directCandidates) {
      if (nowMs() >= deadlineAt) break;
      if (directProbesTried >= maxDirectProbeCandidates) break;
      const bucket = qualityBucketFromResolution(candidate.resolution);
      if (validatedByQuality.has(bucket)) continue;
      directProbesTried += 1;
      const probe = await probeDirectStream(candidate.directUrl, probeTimeoutMs);
      const sourceKey = buildCandidateSourceKey(candidate);
      attempts.push({
        mode: "direct",
        providerId: candidate.providerId,
        displayName: compactText(candidate.displayName, 120),
        ok: probe.ok,
        reason: probe.reason || null
      });
      registerPlaybackOutcome(candidate.providerId, sourceKey, probe.ok, probe.reason || "direct-probe");
      if (!probe.ok) continue;
      upsertValidatedEntry(
        {
          bucket,
          mode: "direct",
          streamKind: "direct",
          streamUrl: candidate.directUrl,
          sessionId: null,
          session: null,
          candidate
        },
        bucket
      );
    }

    if (warmupEnabled) {
      const maxFallbackAttempts = normalizedQuality === "auto" ? 4 : 8;
      let fallbackAttempts = 0;
      for (const candidate of fallbackCandidatesForValidation) {
        if (nowMs() >= deadlineAt) break;
        if (fallbackAttempts >= maxFallbackAttempts) break;
        fallbackAttempts += 1;
        const sourceKey = buildCandidateSourceKey(candidate) || `${candidate.providerId}:${candidate.displayName}:${candidate.resolution}`;
        if (attemptedSources.has(sourceKey)) continue;
        attemptedSources.add(sourceKey);

        const bucket = qualityBucketFromResolution(candidate.resolution);
        if (validatedByQuality.get(bucket)?.streamKind === "direct") continue;
        if (
          normalizedQuality === "auto" &&
          !candidate?.webFriendly &&
          Number(candidate?.seeders || 0) <= 0 &&
          Number(candidate?.peers || 0) <= 0
        ) {
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: false,
            reason: "sin-seeders"
          });
          continue;
        }

        let createdSession = null;
        try {
          createdSession = await createPlaybackSession({
            magnet: candidate.magnet,
            infoHash: candidate.stream?.infoHash,
            displayName: candidate.displayName,
            trackers: getTrackers(candidate.stream),
            fileIdx: candidate.fileIdx,
            providerId: candidate.providerId,
            sourceKey: buildCandidateSourceKey(candidate),
            season,
            episode
          });

          const finalSession = await waitForSessionStatusChange(createdSession.id, warmupWaitMs);
          if (!finalSession) throw new Error("Sesion no encontrada tras crear playback.");
          if (finalSession.status !== "ready") throw new Error(finalSession.error || "Sesion no quedo lista en timeout.");

          touchSession(finalSession);
          const sessionPayload = sessionPublicInfo(finalSession);
          upsertValidatedEntry(
            {
              bucket,
              mode: "session",
              streamKind: finalSession.streamKind || "direct",
              streamUrl: sessionPayload.streamUrl,
              sessionId: finalSession.id,
              session: sessionPayload,
              candidate
            },
            bucket
          );
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: true,
            reason: null
          });
        } catch (error) {
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: false,
            reason: compactText(error?.message, 180) || "session-failed"
          });
          if (createdSession?.id) {
            destroySession(createdSession.id, "preflight-failed");
          }
        }
      }
    }

    const availableQualities = pickAvailableQualities(validatedByQuality);
    const selectedEntry =
      normalizedQuality === "auto"
        ? pickAutoEntry(validatedNativeByQuality) || pickAutoEntry(validatedByQuality)
        : pickSelectedEntry(validatedByQuality, availableQualities, normalizedQuality);

    for (const entry of validatedByQuality.values()) {
      if (!entry?.sessionId) continue;
      if (selectedEntry?.sessionId && entry.sessionId === selectedEntry.sessionId) continue;
      destroySession(entry.sessionId, "preflight-unused-quality");
    }

    const recommended = buildAutoPayloadFromEntry(selectedEntry);
    const preferredSourceKey = selectedEntry ? buildCandidateSourceKey(selectedEntry.candidate) : "";
    const qualityOptions = QUALITY_ORDER.filter((bucket) => validatedByQuality.has(bucket)).map((bucket) => {
      const entry = validatedByQuality.get(bucket);
      return {
        quality: bucket,
        mode: entry.mode,
        streamKind: entry.streamKind || "direct",
        providerId: entry?.candidate?.providerId || "",
        providerName: entry?.candidate?.providerName || "",
        displayName: entry?.candidate?.displayName || "",
        score: Number(entry?.candidate?.score || 0)
      };
    });
    const ttfqMs = nowMs() - startedAt;

    const responsePayload = {
      requestedType: aggregated.requestedType,
      requestedItemId: aggregated.requestedItemId,
      resolvedType: aggregated.resolvedType,
      resolvedItemId: aggregated.resolvedItemId,
      providerCount: aggregated.providerCount,
      selectedQuality: recommended?.selectedQuality || null,
      availableQualities,
      qualityOptions,
      recommended,
      preferredSourceKey: preferredSourceKey || null,
      attempts,
      metrics: {
        ttfqMs
      },
      cache: {
        hit: false,
        ttlMs: PREFLIGHT_CACHE_TTL_MS
      }
    };

    playbackPreflightCache.set(cacheKey, {
      cachedAt: nowMs(),
      payload: responsePayload
    });
    ensurePreflightCacheLimit();
    pushPlaybackAttemptEvent("preflight-ready", {
      providerCount: aggregated.providerCount,
      requestedType: aggregated.requestedType,
      requestedItemId: compactText(aggregated.requestedItemId, 120),
      selectedQuality: responsePayload.selectedQuality,
      availableQualities: responsePayload.availableQualities.join(","),
      ttfqMs,
      cacheHit: false
    });

    return res.json(responsePayload);
  });

  app.post("/api/playback/metrics", (req, res) => {
    const metric = safeText(req.body?.metric || req.query.metric || "unknown");
    const status = safeText(req.body?.status || req.query.status || "ok").toLowerCase();
    const valueMsRaw = Number.parseFloat(req.body?.valueMs ?? req.query.valueMs);
    const valueMs = Number.isFinite(valueMsRaw) ? Math.max(0, Math.round(valueMsRaw)) : null;

    pushPlaybackAttemptEvent("client-metric", {
      metric: compactText(metric, 48),
      status: compactText(status, 32),
      valueMs,
      type: compactText(req.body?.type || req.query.type, 16) || null,
      itemId: compactText(req.body?.itemId || req.query.itemId, 120) || null,
      quality: compactText(req.body?.quality || req.query.quality, 24) || null,
      streamKind: compactText(req.body?.streamKind || req.query.streamKind, 24) || null,
      mode: compactText(req.body?.mode || req.query.mode, 24) || null
    });

    return res.json({ ok: true });
  });

  app.post("/api/playback/auto", async (req, res) => {
    const type = safeText(req.body?.type || req.query.type);
    const itemId = safeText(req.body?.itemId || req.query.itemId);
    const season = safeText(req.body?.season || req.query.season);
    const episode = safeText(req.body?.episode || req.query.episode);
    const quality = safeText(req.body?.quality || req.query.quality || "auto").toLowerCase();
    const audioSelection = parseAudioSelection(req);
    const preferredSourceKey =
      buildStreamSourceKey(req.body?.preferredSourceKey || req.query.preferredSourceKey) ||
      buildStreamSourceKey(req.body?.preferredInfoHash || req.query.preferredInfoHash) ||
      "";
    const waitReadyMs = clamp(Number.parseInt(req.body?.waitReadyMs || req.query.waitReadyMs, 10) || 20000, 6000, 120000);
    const probeTimeoutMs = clamp(Number.parseInt(req.body?.probeTimeoutMs || req.query.probeTimeoutMs, 10) || 3500, 1500, 15000);
    const maxCandidates = clamp(Number.parseInt(req.body?.maxCandidates || req.query.maxCandidates, 10) || 14, 4, 80);
    const validationBudgetMs = clamp(
      Number.parseInt(req.body?.validationBudgetMs || req.query.validationBudgetMs, 10) || 18000,
      5000,
      60000
    );

    if (!type || !itemId) {
      return res.status(400).json({ error: "Debes enviar type e itemId." });
    }

    let aggregated;
    try {
      aggregated = await fetchAggregatedStreams({
        type,
        itemId,
        season,
        episode,
        onlyActive: true
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "No se pudieron resolver streams." });
    }

    const candidates = buildCandidatesFromResults(aggregated.results, audioSelection);
    if (!candidates.length) {
      return res.status(404).json({
        error: "No se encontraron streams candidatos.",
        summary: {
          requestedType: aggregated.requestedType,
          requestedItemId: aggregated.requestedItemId,
          resolvedType: aggregated.resolvedType,
          resolvedItemId: aggregated.resolvedItemId,
          providerCount: aggregated.providerCount
        }
      });
    }

    const normalizedQuality = ["auto", "4k", "1080p", "720p", "sd"].includes(quality) ? quality : "auto";
    const orderedAuto = orderCandidatesForPlayback(candidates, "auto").slice(0, maxCandidates);
    const ordered =
      normalizedQuality === "auto"
        ? orderedAuto
        : [
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) === normalizedQuality),
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) !== normalizedQuality)
          ];
    const orderedWithPreferred = preferredSourceKey
      ? [
          ...ordered.filter((candidate) => buildCandidateSourceKey(candidate) === preferredSourceKey),
          ...ordered.filter((candidate) => buildCandidateSourceKey(candidate) !== preferredSourceKey)
        ]
      : ordered;

    // --- Loop unificado: validar candidatos en orden de score ---
    const attempts = [];
    const deadlineAt = Date.now() + validationBudgetMs;
    const qualityOrder = ["4k", "1080p", "720p", "sd"];
    const validatedByQuality = new Map();
    const validatedNativeByQuality = new Map();
    const attemptedSources = new Set();
    const maxAttempts = normalizedQuality === "auto" ? 5 : 8;
    let totalAttempts = 0;
    let directProbes = 0;
    let torrentAttempts = 0;
    const maxDirectProbes = normalizedQuality === "auto" ? 3 : 6;
    const maxTorrentAttempts = normalizedQuality === "auto" ? 3 : 5;
    const torrentWaitMs = normalizedQuality === "auto"
      ? clamp(Math.min(waitReadyMs, 12000), 6000, waitReadyMs)
      : waitReadyMs;

    const upsertValidated = (entry, bucket) => {
      const current = validatedByQuality.get(bucket);
      let selected = current;
      if (!current) {
        selected = entry;
      } else if (current.streamKind !== entry.streamKind) {
        selected = entry.streamKind === "direct" ? entry : current;
      } else {
        selected = Number(entry?.candidate?.score || 0) > Number(current?.candidate?.score || 0) ? entry : current;
      }
      if (selected === entry) {
        if (current?.sessionId && current.sessionId !== entry.sessionId) {
          destroySession(current.sessionId, "autoplay-replaced");
        }
        validatedByQuality.set(bucket, entry);
        if (entry.streamKind === "direct") {
          validatedNativeByQuality.set(bucket, entry);
        } else {
          validatedNativeByQuality.delete(bucket);
        }
      } else if (entry.sessionId) {
        destroySession(entry.sessionId, "autoplay-lower-score");
      }
    };

    for (const candidate of orderedWithPreferred) {
      if (Date.now() >= deadlineAt) break;
      if (totalAttempts >= maxAttempts) break;

      const sourceKey = buildCandidateSourceKey(candidate) || `${candidate.providerId}:${candidate.displayName}:${candidate.resolution}`;
      if (attemptedSources.has(sourceKey)) continue;

      const bucket = qualityBucketFromResolution(candidate.resolution);

      // Si ya tenemos un directo validado para este bucket, skip
      if (validatedNativeByQuality.has(bucket)) continue;

      if (candidate.directUrl) {
        // --- Validar directo ---
        if (directProbes >= maxDirectProbes) continue;
        directProbes += 1;
        totalAttempts += 1;
        attemptedSources.add(sourceKey);

        const probe = await probeDirectStream(candidate.directUrl, probeTimeoutMs);
        registerPlaybackOutcome(candidate.providerId, sourceKey, probe.ok, probe.reason || "direct-probe");
        attempts.push({
          mode: "direct",
          providerId: candidate.providerId,
          displayName: compactText(candidate.displayName, 120),
          ok: probe.ok,
          reason: probe.reason || null
        });
        if (probe.ok) {
          upsertValidated({
            bucket,
            mode: "direct",
            streamKind: "direct",
            streamUrl: candidate.directUrl,
            sessionId: null,
            session: null,
            candidate
          }, bucket);
          // Early termination: si encontramos un directo en modo auto, responder inmediatamente
          if (normalizedQuality === "auto") break;
        }
      } else if (candidate.magnet) {
        // --- Validar torrent ---
        if (torrentAttempts >= maxTorrentAttempts) continue;

        // Skip sin seeders en modo auto a menos que sea webFriendly
        if (
          normalizedQuality === "auto" &&
          !candidate.webFriendly &&
          Number(candidate.seeders || 0) <= 0 &&
          Number(candidate.peers || 0) <= 0
        ) {
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: false,
            reason: "sin-seeders"
          });
          continue;
        }

        torrentAttempts += 1;
        totalAttempts += 1;
        attemptedSources.add(sourceKey);

        let createdSession = null;
        try {
          createdSession = await createPlaybackSession({
            magnet: candidate.magnet,
            infoHash: candidate.stream?.infoHash,
            displayName: candidate.displayName,
            trackers: getTrackers(candidate.stream),
            fileIdx: candidate.fileIdx,
            providerId: candidate.providerId,
            sourceKey: buildCandidateSourceKey(candidate),
            season,
            episode
          });

          const finalSession = await waitForSessionStatusChange(createdSession.id, torrentWaitMs);
          if (!finalSession) throw new Error("Sesion no encontrada tras crear playback.");
          if (finalSession.status !== "ready") throw new Error(finalSession.error || "Sesion no quedo lista en timeout.");

          touchSession(finalSession);
          const payload = sessionPublicInfo(finalSession);
          upsertValidated({
            bucket,
            mode: "session",
            streamKind: finalSession.streamKind || "direct",
            streamUrl: payload.streamUrl,
            sessionId: finalSession.id,
            session: payload,
            candidate
          }, bucket);
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: true,
            reason: null
          });
          // Early termination: primer torrent validado en modo auto
          if (normalizedQuality === "auto") break;
        } catch (error) {
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: false,
            reason: compactText(error?.message, 180) || "session-failed"
          });
          if (createdSession?.id) {
            destroySession(createdSession.id, "autoplay-failed");
          }
        }
      }
    }

    // --- Rescue: si no validamos nada y queda budget, intentar un candidato más con wait extendido ---
    if (!validatedByQuality.size && normalizedQuality === "auto") {
      const rescueWaitMs = clamp(Math.min(waitReadyMs, 20000), 8000, waitReadyMs);
      for (const candidate of orderedWithPreferred) {
        if (Date.now() >= deadlineAt + rescueWaitMs) break;
        if (!candidate.magnet) continue;
        const sourceKey = buildCandidateSourceKey(candidate) || `${candidate.providerId}:${candidate.displayName}:${candidate.resolution}`;
        if (attemptedSources.has(sourceKey)) continue;
        attemptedSources.add(sourceKey);

        const bucket = qualityBucketFromResolution(candidate.resolution);
        let createdSession = null;
        try {
          createdSession = await createPlaybackSession({
            magnet: candidate.magnet,
            infoHash: candidate.stream?.infoHash,
            displayName: candidate.displayName,
            trackers: getTrackers(candidate.stream),
            fileIdx: candidate.fileIdx,
            providerId: candidate.providerId,
            sourceKey: buildCandidateSourceKey(candidate),
            season,
            episode
          });
          const finalSession = await waitForSessionStatusChange(createdSession.id, rescueWaitMs);
          if (!finalSession) throw new Error("Sesion no encontrada.");
          if (finalSession.status !== "ready") throw new Error(finalSession.error || "Timeout.");
          touchSession(finalSession);
          const payload = sessionPublicInfo(finalSession);
          upsertValidated({
            bucket,
            mode: "session",
            streamKind: finalSession.streamKind || "direct",
            streamUrl: payload.streamUrl,
            sessionId: finalSession.id,
            session: payload,
            candidate
          }, bucket);
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: true,
            reason: null
          });
          break;
        } catch (error) {
          attempts.push({
            mode: "torrent",
            providerId: candidate.providerId,
            displayName: compactText(candidate.displayName, 120),
            ok: false,
            reason: compactText(error?.message, 180) || "rescue-failed"
          });
          if (createdSession?.id) destroySession(createdSession.id, "autoplay-rescue-failed");
        }
      }
    }

    // --- Seleccionar mejor resultado validado ---
    const availableQualities = qualityOrder.filter((item) => validatedByQuality.has(item));
    if (!availableQualities.length) {
      return res.status(502).json({
        error: "No se pudo validar ningun stream reproducible por el momento.",
        attempts,
        summary: {
          requestedType: aggregated.requestedType,
          requestedItemId: aggregated.requestedItemId,
          resolvedType: aggregated.resolvedType,
          resolvedItemId: aggregated.resolvedItemId,
          providerCount: aggregated.providerCount,
          candidatesEvaluated: ordered.length
        }
      });
    }

    if (normalizedQuality !== "auto" && !validatedByQuality.has(normalizedQuality)) {
      for (const entry of validatedByQuality.values()) {
        if (entry?.sessionId) destroySession(entry.sessionId, "autoplay-quality-not-available");
      }
      return res.status(409).json({
        error: "La calidad solicitada no pudo validarse.",
        availableQualities
      });
    }

    const pickBestEntry = (map) => {
      let bestEntry = null;
      let bestRank = Number.NEGATIVE_INFINITY;
      for (const bucket of qualityOrder) {
        const entry = map.get(bucket);
        if (!entry) continue;
        const c = entry.candidate || {};
        const sizeGb = Number(c.videoSizeBytes || 0) / (1024 * 1024 * 1024);
        const qb = entry.bucket === "4k" ? 24 : entry.bucket === "1080p" ? 16 : entry.bucket === "720p" ? 10 : 4;
        const rank = Number(c.seeders || 0) * 5 + Number(c.peers || 0) * 1.5 + Number(c.score || 0) * 0.75 - sizeGb * 12 + qb + (entry.streamKind === "direct" ? 420 : -180);
        if (rank > bestRank) { bestRank = rank; bestEntry = entry; }
      }
      return bestEntry;
    };

    const selectedEntry = normalizedQuality === "auto"
      ? (pickBestEntry(validatedNativeByQuality) || pickBestEntry(validatedByQuality))
      : (validatedByQuality.get(normalizedQuality) || null);

    if (!selectedEntry) {
      return res.status(502).json({
        error: "No se pudo determinar stream final validado.",
        availableQualities
      });
    }

    for (const entry of validatedByQuality.values()) {
      if (!entry?.sessionId) continue;
      if (entry.sessionId === selectedEntry.sessionId) continue;
      destroySession(entry.sessionId, "autoplay-unused");
    }

    let sessionPayload = selectedEntry.session;
    if (selectedEntry.sessionId) {
      const liveSession = getSessionById(selectedEntry.sessionId);
      if (!liveSession) {
        return res.status(502).json({ error: "La sesion validada ya no esta disponible." });
      }
      touchSession(liveSession);
      sessionPayload = sessionPublicInfo(liveSession);
    }

    return res.json({
      mode: selectedEntry.mode,
      status: "ready",
      streamUrl: selectedEntry.streamUrl,
      streamKind: selectedEntry.streamKind || "direct",
      sessionId: selectedEntry.sessionId || null,
      session: sessionPayload || null,
      chosen: summarizeCandidate(selectedEntry.candidate),
      selectedQuality: selectedEntry.bucket,
      availableQualities
    });
  });

  app.get("/api/playback/sessions/:id/status", (req, res) => {
    const waitMs = clamp(Number.parseInt(req.query.waitMs, 10) || 0, 0, 8000);
    const knownStatus = safeText(req.query.knownStatus).toLowerCase();
    const knownHlsStatus = safeText(req.query.knownHlsStatus).toLowerCase();
    const knownSegmentsRaw = Number.parseInt(req.query.knownSegments, 10);
    const knownSegments = Number.isFinite(knownSegmentsRaw) && knownSegmentsRaw >= 0 ? knownSegmentsRaw : null;

    const respondWithSession = (sessionRef) => {
      touchSession(sessionRef);
      if (sessionRef.status === "error") {
        markSessionOutcome(sessionRef, false, sessionRef.error || "Error de sesion.");
        pushPlaybackAttemptEvent("status-error", {
          sessionId: sessionRef.id,
          providerId: sessionRef.providerId || null,
          sourceKey: compactText(sessionRef.sourceKey, 120) || null,
          reason: compactText(sessionRef.error, 180) || null
        });
      }
      return res.json(sessionPublicInfo(sessionRef));
    };

    const currentSession = getSessionById(req.params.id);
    if (!currentSession) {
      return res.status(404).json({ error: "Sesion no encontrada." });
    }

    if (!waitMs || currentSession.status !== "loading") {
      return respondWithSession(currentSession);
    }

    const startedAt = nowMs();
    const checkAndRespond = () => {
      const sessionRef = getSessionById(req.params.id);
      if (!sessionRef) {
        return res.status(404).json({ error: "Sesion no encontrada." });
      }
      const info = sessionPublicInfo(sessionRef);
      const currentStatus = safeText(info.status).toLowerCase();
      const currentHlsStatus = safeText(info?.hls?.status).toLowerCase();
      const currentSegments = Number(info?.hls?.segmentCount || 0);
      const statusChanged = knownStatus ? currentStatus !== knownStatus : currentStatus !== "loading";
      const hlsChanged = knownHlsStatus ? currentHlsStatus !== knownHlsStatus : currentHlsStatus !== "loading";
      const segmentsReadyTransition =
        knownSegments !== null
          ? knownSegments < PLAYBACK_HLS_READY_SEGMENTS && currentSegments >= PLAYBACK_HLS_READY_SEGMENTS
          : false;
      const timedOut = nowMs() - startedAt >= waitMs;
      if (currentStatus !== "loading" || statusChanged || hlsChanged || segmentsReadyTransition || timedOut) {
        return respondWithSession(sessionRef);
      }
      return null;
    };

    const immediate = checkAndRespond();
    if (immediate) return;

    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(timer);
        return;
      }
      const done = checkAndRespond();
      if (done) {
        clearInterval(timer);
      }
    }, 250);
  });

  app.delete("/api/playback/sessions/:id", (req, res) => {
    destroySession(req.params.id);
    return res.status(204).send();
  });

  app.get("/api/playback/sessions/:id/hls/:asset", (req, res) => {
    const session = getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Sesion no encontrada." });
    }
    touchSession(session);
    const asset = safeText(req.params.asset);
    const assetLower = asset.toLowerCase();
    const isManifest = assetLower.endsWith(".m3u8");

    if (!session.hls?.enabled) {
      return res.status(404).json({ error: "Sesion sin HLS activo." });
    }
    if (session.status === "error") {
      if (isManifest) {
        const endedManifest = [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-TARGETDURATION:4",
          "#EXT-X-MEDIA-SEQUENCE:0",
          "#EXT-X-ENDLIST"
        ].join("\n");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(endedManifest);
      }
      return res.status(410).json({ error: session.error || "Sesion con error." });
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(asset)) {
      return res.status(400).json({ error: "Asset invalido." });
    }

    const baseDir = path.resolve(session.hls.dir || "");
    const assetPath = path.resolve(path.join(baseDir, asset));
    if (!baseDir || !assetPath.startsWith(baseDir)) {
      return res.status(400).json({ error: "Asset invalido." });
    }

    if (!fs.existsSync(assetPath)) {
      if (session.hls.status === "loading") {
        return res.status(425).json({ error: "HLS en preparacion." });
      }
      return res.status(404).json({ error: "Asset HLS no encontrado." });
    }

    if (isManifest) {
      const segmentCount = readHlsManifestSegmentCount(assetPath);
      const tsNow = nowMs();
      if (segmentCount > session.hls.lastSegmentCount) {
        session.hls.lastSegmentCount = segmentCount;
        session.hls.lastSegmentAt = tsNow;
      }

      const torrentSpeed = Number(session.torrent?.downloadSpeed || 0);
      const torrentProgress = Number(session.torrent?.progress || 0);
      const sessionAgeMs = tsNow - Number(session.createdAt || tsNow);
      const effectiveStallMs = sessionAgeMs < 120000 ? Math.max(PLAYBACK_HLS_STALL_MS, 90000) : PLAYBACK_HLS_STALL_MS;
      const stalled =
        session.status === "ready" &&
        segmentCount >= PLAYBACK_HLS_READY_SEGMENTS &&
        tsNow - Number(session.hls.lastSegmentAt || 0) > effectiveStallMs &&
        torrentProgress < 0.995 &&
        torrentSpeed < PLAYBACK_HLS_STALL_MIN_SPEED_BPS;
      if (stalled) {
        const reason = "Stream HLS estancado por baja velocidad. Cambiando de fuente/calidad suele resolverlo.";
        session.status = "error";
        session.error = reason;
        session.hls.status = "error";
        session.hls.error = reason;
        markSessionOutcome(session, false, reason);
        pushPlaybackAttemptEvent("hls-stalled", {
          sessionId: session.id,
          providerId: session.providerId || null,
          sourceKey: compactText(session.sourceKey, 120) || null,
          segmentCount,
          speed: torrentSpeed
        });
        return res.status(504).json({ error: reason });
      }
    }

    markSessionOutcome(session, true, "hls-started");
    const tsNow = nowMs();
    if (!isManifest || tsNow - Number(session.hls.lastManifestLogAt || 0) >= 5000) {
      if (isManifest) {
        session.hls.lastManifestLogAt = tsNow;
      }
      pushPlaybackAttemptEvent("hls-served", {
        sessionId: session.id,
        providerId: session.providerId || null,
        sourceKey: compactText(session.sourceKey, 120) || null,
        asset
      });
    }

    if (isManifest) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-HLS-Segment-Count", String(session.hls.lastSegmentCount || 0));
    } else {
      const contentType = mime.lookup(assetPath) || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    }
    return res.sendFile(assetPath);
  });

  app.get("/api/playback/sessions/:id/stream", (req, res) => {
    const session = getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Sesion no encontrada." });
    }

    touchSession(session);
    if (session.status === "loading") {
      return res.status(425).json({ error: "Sesion en preparacion. Intenta nuevamente en unos segundos." });
    }
    if (session.status === "error") {
      markSessionOutcome(session, false, session.error || "Sesion con error.");
      return res.status(502).json({ error: session.error || "Sesion con error." });
    }
    if (!session.file) {
      markSessionOutcome(session, false, "Archivo de sesion no disponible.");
      return res.status(500).json({ error: "Archivo de sesion no disponible." });
    }

    const file = session.file;
    const fileSize = Number(file.length || 0);
    const contentType = mime.lookup(file.name || "") || "application/octet-stream";
    const range = req.headers.range;

    if (!range) {
      markSessionOutcome(session, true, "stream-started");
      pushPlaybackAttemptEvent("stream-started", {
        sessionId: session.id,
        providerId: session.providerId || null,
        sourceKey: compactText(session.sourceKey, 120) || null,
        fileName: compactText(file?.name, 220) || null,
        fileLength: Number(file?.length || 0),
        range: null
      });
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      pipeTorrentFileToResponse(file, res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (!match) {
      return res.status(416).send("Invalid range");
    }

    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;

    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1;
    if (start > end) {
      return res.status(416).send("Invalid range");
    }

    markSessionOutcome(session, true, "stream-started");
    pushPlaybackAttemptEvent("stream-started", {
      sessionId: session.id,
      providerId: session.providerId || null,
      sourceKey: compactText(session.sourceKey, 120) || null,
      fileName: compactText(file?.name, 220) || null,
      fileLength: Number(file?.length || 0),
      range: `bytes=${start}-${end}`
    });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    pipeTorrentFileToResponse(file, res, { start, end });
  });

  app.get("/api/playback/sessions/:id/subtitles/:subtitleId", async (req, res) => {
    const session = getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Sesion no encontrada." });
    }

    touchSession(session);
    if (session.status === "loading") {
      return res.status(425).json({ error: "Sesion en preparacion. Intenta nuevamente en unos segundos." });
    }
    if (session.status === "error") {
      return res.status(502).json({ error: session.error || "Sesion con error." });
    }

    const subtitleId = safeText(req.params.subtitleId);
    const subtitle = (Array.isArray(session.subtitles) ? session.subtitles : []).find(
      (item) => safeText(item?.id) === subtitleId
    );
    if (!subtitle?.file) {
      return res.status(404).json({ error: "Subtitulo no encontrado." });
    }

    try {
      const ext = safeText(subtitle.extension).toLowerCase();
      if (ext === ".vtt" || ext === ".srt") {
        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        const raw = await streamToBuffer(subtitle.file.createReadStream());
        const text = toWebVtt(raw.toString("utf8"));
        return res.send(text);
      }

      return res.status(415).json({ error: "Formato de subtitulo no soportado." });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "No se pudo cargar subtitulo." });
    }
  });
}

module.exports = { registerPlaybackRoutes };
