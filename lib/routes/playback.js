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
  getTrackers,
  rankCandidateForAuto
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
    fileIdx: Number.isInteger(candidate.fileIdx) ? candidate.fileIdx : null,
    sourceKey: buildCandidateSourceKey(candidate) || ""
  };
}

function isM3uVodCandidate(candidate) {
  return safeText(candidate?.providerId).toLowerCase() === "m3u-vod";
}

function prioritizeCandidatesForAutoPlayback(candidates, maxCandidates, preferredSourceKey = "") {
  const normalizedMax = clamp(Number(maxCandidates) || 14, 4, 80);
  const orderedAll = orderCandidatesForPlayback(candidates, "auto");
  const prioritizedM3uDirect = orderedAll.filter(
    (candidate) => isM3uVodCandidate(candidate) && Boolean(candidate?.directUrl)
  );
  const rest = orderedAll.filter(
    (candidate) => !(isM3uVodCandidate(candidate) && Boolean(candidate?.directUrl))
  );

  // Forzar M3U VOD al inicio sin bloquear todo el presupuesto de candidatos.
  const m3uFrontLimit = Math.max(2, Math.min(8, Math.floor(normalizedMax / 2)));
  let prioritized = [
    ...prioritizedM3uDirect.slice(0, m3uFrontLimit),
    ...rest,
    ...prioritizedM3uDirect.slice(m3uFrontLimit)
  ];

  if (preferredSourceKey) {
    prioritized = [
      ...prioritized.filter((candidate) => buildCandidateSourceKey(candidate) === preferredSourceKey),
      ...prioritized.filter((candidate) => buildCandidateSourceKey(candidate) !== preferredSourceKey)
    ];
  }

  console.log(
    `[M3U-VOD] priority m3uDirect=${prioritizedM3uDirect.length} injectedFront=${Math.min(prioritizedM3uDirect.length, m3uFrontLimit)} maxCandidates=${normalizedMax}`
  );
  return prioritized.slice(0, normalizedMax);
}

function logM3uVodPlayback(context, entry) {
  if (!entry || !isM3uVodCandidate(entry?.candidate)) return;
  const quality = safeText(entry?.bucket || "auto");
  const mode = safeText(entry?.mode || "direct");
  const displayName = compactText(
    entry?.candidate?.displayName || entry?.candidate?.stream?.title || "sin-titulo",
    140
  );
  console.log(
    `[PLAYBACK] REPRODUCIENDO M3U VOD (${context}) quality=${quality} mode=${mode} title=${displayName}`
  );
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
const PREFLIGHT_CACHE_TTL_SERIES_MS = 5 * 60 * 1000;
const PREFLIGHT_CACHE_TTL_MOVIE_MS = 3 * 60 * 1000;
const PREFLIGHT_CACHE_TTL_DEFAULT_MS = 45 * 1000;
const MAX_AUTO_ALTERNATIVES = 4; // hasta 4 alternativas extra (sin incluir la fuente seleccionada)
const MAX_AUTO_VALIDATED = 6; // cuántos candidatos validar en modo auto antes de parar

function getPreflightCacheTtl(type) {
  const t = safeText(type).toLowerCase();
  if (t === "series") return PREFLIGHT_CACHE_TTL_SERIES_MS;
  if (t === "movie") return PREFLIGHT_CACHE_TTL_MOVIE_MS;
  return PREFLIGHT_CACHE_TTL_DEFAULT_MS;
}

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
    const m3uBonus = isM3uVodCandidate(candidate) ? 260 : 0;
    return speedScore + 420 + m3uBonus;
  }
  return speedScore - 180;
}

function estimateAlternativeAvailabilityRank(entry) {
  const candidate = entry?.candidate || {};
  const seeders = Number(candidate.seeders || 0);
  const peers = Number(candidate.peers || 0);
  const quality = Number(candidate.resolution || 0) / 220;
  const sizeGb = Number(candidate.videoSizeBytes || 0) / (1024 * 1024 * 1024);
  const base = seeders * 8 + peers * 3 + Number(candidate.score || 0) * 0.5 + quality - sizeGb * 6;
  const modeBonus = entry?.mode === "session" ? 14 : 8;
  return base + modeBonus;
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

function buildValidatedEntryKey(entry) {
  if (!entry?.candidate) return "";
  const canonical = buildCandidateSourceKey(entry.candidate);
  const filePart = Number.isFinite(Number(entry.candidate.fileIdx)) ? `|f${entry.candidate.fileIdx}` : "";
  if (canonical) return `${canonical}${filePart}`;
  return `${entry.candidate.providerId || "unknown"}:${entry.candidate.displayName || "unknown"}:${entry.candidate.resolution || 0}${filePart}`;
}

function buildAutoAlternatives(entries, preferredEntry, limit = MAX_AUTO_ALTERNATIVES) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const alternatives = [];
  const seen = new Set();

  const addEntry = (entry) => {
    if (!entry || alternatives.length >= limit) return false;
    const payload = buildAutoPayloadFromEntry(entry);
    if (!payload) return false;
    const key = buildValidatedEntryKey(entry);
    if (key && seen.has(key)) return false;
    alternatives.push(payload);
    if (key) seen.add(key);
    return true;
  };

  const preferredKey = buildValidatedEntryKey(preferredEntry);
  if (preferredKey) {
    seen.add(preferredKey);
  }

  const scored = entries
    .map((entry) => ({
      entry,
      key: buildValidatedEntryKey(entry),
      rank: estimateAlternativeAvailabilityRank(entry)
    }))
    .sort((a, b) => Number(b.rank) - Number(a.rank));

  for (const item of scored) {
    if (alternatives.length >= limit) break;
    if (!item.entry) continue;
    if (preferredEntry && item.entry === preferredEntry) continue;
    if (item.key && seen.has(item.key)) continue;
    addEntry(item.entry);
  }

  return alternatives;
}

async function probeDirectStream(directUrl, timeoutMs = 6000, options = {}) {
  const url = safeText(directUrl);
  const allowMatroska = Boolean(options?.allowMatroska);
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
    const urlLooksPlayable = allowMatroska
      ? /\.(m3u8|mp4|m4v|webm|mkv)(?:$|[?#])/i.test(url)
      : /\.(m3u8|mp4|m4v|webm)(?:$|[?#])/i.test(url);
    const blockedTypes = allowMatroska
      ? ["text/html", "video/x-msvideo", "video/avi", "video/x-ms-wmv"]
      : ["text/html", "video/x-matroska", "video/matroska", "video/x-msvideo", "video/avi", "video/x-ms-wmv"];
    const allowedTypes = [
      "video/mp4",
      "video/webm",
      "video/x-m4v",
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl",
      ...(allowMatroska ? ["video/x-matroska", "video/matroska"] : [])
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
    if (cached && now - Number(cached.cachedAt || 0) <= getPreflightCacheTtl(type)) {
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
              ttlMs: getPreflightCacheTtl(type),
              ageMs: now - Number(cached.cachedAt || now)
            }
          });
        }
      } else {
        return res.json({
          ...cached.payload,
          cache: {
            hit: true,
            ttlMs: getPreflightCacheTtl(type),
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

    const orderedAuto = prioritizeCandidatesForAutoPlayback(candidates, maxCandidates);
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
      } else if (isM3uVodCandidate(current?.candidate) !== isM3uVodCandidate(entry?.candidate)) {
        selected = isM3uVodCandidate(entry?.candidate) ? entry : current;
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
      const probe = await probeDirectStream(candidate.directUrl, probeTimeoutMs, {
        allowMatroska: isM3uVodCandidate(candidate)
      });
      const sourceKey = buildCandidateSourceKey(candidate);
      attempts.push({
        mode: "direct",
        providerId: candidate.providerId,
        displayName: compactText(candidate.displayName, 120),
        ok: probe.ok,
        reason: probe.reason || null
      });
      if (safeText(candidate.providerId).toLowerCase() === "m3u-vod") {
        console.log(
          `[M3U-VOD] preflight probe ${probe.ok ? "OK" : "FAIL"} reason=${probe.reason || "ok"} status=${probe.status || "-"} contentType=${safeText(probe.contentType) || "-"} title=${compactText(candidate.displayName, 120)}`
        );
      }
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
    logM3uVodPlayback("preflight", selectedEntry);

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
        ttlMs: getPreflightCacheTtl(type)
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

    // --- DEBUG: diagnóstico de candidatos ---
    {
      let totalRawStreams = 0;
      let providersWithStreams = 0;
      for (const r of aggregated.results || []) {
        if (r?.ok && Array.isArray(r?.streams)) {
          totalRawStreams += r.streams.length;
          if (r.streams.length > 0) providersWithStreams++;
        }
      }
      const allowedCount = candidates.filter((c) => c.allowedLanguage).length;
      const noSeedersCount = candidates.filter((c) => Number(c.seeders || 0) <= 0 && Number(c.peers || 0) <= 0 && !c.directUrl).length;
      console.log(`[AUTO-DEBUG] ${type}/${itemId} S${season || "-"}E${episode || "-"} | providers=${aggregated.providerCount} withStreams=${providersWithStreams} rawStreams=${totalRawStreams} candidates=${candidates.length} allowedLang=${allowedCount} noSeeders=${noSeedersCount} quality=${quality} audio=${audioSelection?.audioPreference || "?"}`);
      if (candidates.length <= 30) {
        for (const c of candidates.slice(0, 20)) {
          console.log(`  [CAND] score=${c.score?.toFixed?.(1)} lang=${c.allowedLanguage ? "OK" : "NO"} hints=[${(c.languageHints || []).join(",")}] seeders=${c.seeders} peers=${c.peers} res=${c.resolution} ${c.directUrl ? "DIRECT" : "TORRENT"} provider=${c.providerId} name=${(c.displayName || "").slice(0, 80)}`);
        }
      }
    }

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
    const orderedAuto = prioritizeCandidatesForAutoPlayback(candidates, maxCandidates, preferredSourceKey);
    const ordered =
      normalizedQuality === "auto"
        ? orderedAuto
        : [
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) === normalizedQuality),
            ...orderedAuto.filter((candidate) => qualityBucketFromResolution(candidate.resolution) !== normalizedQuality)
          ];
    const orderedWithPreferred = ordered;

    // --- Loop unificado: validar candidatos en orden de score ---
    const attempts = [];
    const deadlineAt = Date.now() + validationBudgetMs;
    const qualityOrder = ["4k", "1080p", "720p", "sd"];
    const validatedByQuality = new Map();
    const validatedNativeByQuality = new Map();
    const allValidatedEntries = []; // todas las entradas validadas (para alternativas)
    const attemptedSources = new Set();
    const maxAttempts = normalizedQuality === "auto" ? MAX_AUTO_VALIDATED + 4 : 10;
    let totalAttempts = 0;
    let autoValidatedCount = 0;
    let directProbes = 0;
    let torrentAttempts = 0;
    const maxDirectProbes = normalizedQuality === "auto" ? 6 : 6;
    const maxTorrentAttempts = normalizedQuality === "auto" ? 8 : 6;
    const torrentWaitMs = normalizedQuality === "auto"
      ? clamp(Math.min(waitReadyMs, 30000), 10000, waitReadyMs)
      : waitReadyMs;

    const upsertValidated = (entry, bucket) => {
      allValidatedEntries.push(entry); // guardar TODAS las entradas validadas
      autoValidatedCount++;
      const current = validatedByQuality.get(bucket);
      let selected = current;
      if (!current) {
        selected = entry;
      } else if (current.streamKind !== entry.streamKind) {
        selected = entry.streamKind === "direct" ? entry : current;
      } else if (isM3uVodCandidate(current?.candidate) !== isM3uVodCandidate(entry?.candidate)) {
        selected = isM3uVodCandidate(entry?.candidate) ? entry : current;
      } else {
        selected = Number(entry?.candidate?.score || 0) > Number(current?.candidate?.score || 0) ? entry : current;
      }
      if (selected === entry) {
        // No destruir la sesión reemplazada - se usa como alternativa
        validatedByQuality.set(bucket, entry);
        if (entry.streamKind === "direct") {
          validatedNativeByQuality.set(bucket, entry);
        } else {
          validatedNativeByQuality.delete(bucket);
        }
      }
    };

    // --- Fase 1: Validar directos (secuencial, rápido) ---
    console.log(`[AUTO-DEBUG] Validation: ${orderedWithPreferred.length} candidates, budget=${validationBudgetMs}ms`);
    for (const candidate of orderedWithPreferred) {
      if (!candidate.directUrl) continue;
      if (directProbes >= maxDirectProbes) break;
      if (Date.now() >= deadlineAt) break;

      const sourceKey = buildCandidateSourceKey(candidate) || `${candidate.providerId}:${candidate.displayName}:${candidate.resolution}`;
      if (attemptedSources.has(sourceKey)) continue;
      attemptedSources.add(sourceKey);
      directProbes += 1;
      totalAttempts += 1;

      const bucket = qualityBucketFromResolution(candidate.resolution);
      const probe = await probeDirectStream(candidate.directUrl, probeTimeoutMs, {
        allowMatroska: isM3uVodCandidate(candidate)
      });
      registerPlaybackOutcome(candidate.providerId, sourceKey, probe.ok, probe.reason || "direct-probe");
      attempts.push({
        mode: "direct",
        providerId: candidate.providerId,
        displayName: compactText(candidate.displayName, 120),
        ok: probe.ok,
        reason: probe.reason || null
      });
      if (safeText(candidate.providerId).toLowerCase() === "m3u-vod") {
        console.log(
          `[M3U-VOD] autoplay probe ${probe.ok ? "OK" : "FAIL"} reason=${probe.reason || "ok"} status=${probe.status || "-"} contentType=${safeText(probe.contentType) || "-"} title=${compactText(candidate.displayName, 120)}`
        );
      }
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
        if (normalizedQuality === "auto" && autoValidatedCount >= MAX_AUTO_VALIDATED) break;
      }
    }

    // --- Fase 2: Torrents en PARALELO (iniciar varios a la vez, tomar el primero que conecte) ---
    const PARALLEL_BATCH_SIZE = normalizedQuality === "auto" ? 6 : 4;
    const WINNER_GRACE_MS = normalizedQuality === "auto" ? 3500 : 1800;
    const TARGET_READY_TORRENTS = normalizedQuality === "auto" ? 4 : 2;
    const MAX_EXTRA_BATCHES_AFTER_WINNER = normalizedQuality === "auto" ? 1 : 0;
    const torrentCandidates = [];
    for (const candidate of orderedWithPreferred) {
      if (!candidate.magnet) continue;
      if (torrentCandidates.length >= maxTorrentAttempts) break;
      const sourceKey = buildCandidateSourceKey(candidate) || `${candidate.providerId}:${candidate.displayName}:${candidate.resolution}`;
      if (attemptedSources.has(sourceKey)) continue;

      const providerAlwaysTry = ["torrentio", "knightcrawler", "mediafusion", "cyberflix"].includes(
        safeText(candidate.providerId).toLowerCase()
      );
      if (
        normalizedQuality === "auto" &&
        !candidate.webFriendly &&
        !providerAlwaysTry &&
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
      torrentCandidates.push({ candidate, sourceKey });
    }

    // Iniciar torrents en batches y polear TODAS las sesiones activas juntas.
    // Las sesiones NO se destruyen entre batches — una sesion del batch 1 puede
    // volverse "ready" durante el polling del batch 2.
    const allActiveSessions = []; // { candidate, sourceKey, session, error }
    let torrentWinner = null;
    const torrentPhaseStart = Date.now();
    let extraBatchesAfterWinner = 0;
    const countReadyTorrents = () => {
      let count = 0;
      for (const entry of allActiveSessions) {
        if (!entry?.session?.id) continue;
        const session = getSessionById(entry.session.id);
        if (session?.status === "ready") count += 1;
      }
      return count;
    };

    for (let batchStart = 0; batchStart < torrentCandidates.length; batchStart += PARALLEL_BATCH_SIZE) {
      if (Date.now() >= deadlineAt) { console.log(`[AUTO-DEBUG] Budget expired before batch`); break; }
      if (autoValidatedCount >= MAX_AUTO_VALIDATED) break;
      if (torrentWinner) {
        const readyCount = countReadyTorrents();
        if (readyCount >= TARGET_READY_TORRENTS) break;
        if (extraBatchesAfterWinner >= MAX_EXTRA_BATCHES_AFTER_WINNER) break;
        extraBatchesAfterWinner += 1;
        console.log(
          `[AUTO-DEBUG] Winner found, launching extra batch for alternatives (${extraBatchesAfterWinner}/${MAX_EXTRA_BATCHES_AFTER_WINNER}, ready=${readyCount}/${TARGET_READY_TORRENTS})`
        );
      }

      const batch = torrentCandidates.slice(batchStart, batchStart + PARALLEL_BATCH_SIZE);
      const budgetLeft = deadlineAt - Date.now();
      if (budgetLeft < 3000) { console.log(`[AUTO-DEBUG] Budget too low for batch (${budgetLeft}ms)`); break; }

      console.log(`[AUTO-DEBUG] Starting batch of ${batch.length} torrents (budget left=${budgetLeft}ms, active sessions=${allActiveSessions.filter(e => e.session).length})`);

      // Crear sesiones del batch en paralelo
      const newSessions = await Promise.all(
        batch.map(async ({ candidate, sourceKey }) => {
          attemptedSources.add(sourceKey);
          torrentAttempts += 1;
          totalAttempts += 1;
          try {
            console.log(`[AUTO-DEBUG]   Starting: ${(candidate.displayName || "").slice(0, 70)}`);
            const session = await createPlaybackSession({
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
            return { candidate, sourceKey, session, error: null };
          } catch (error) {
            return { candidate, sourceKey, session: null, error };
          }
        })
      );
      allActiveSessions.push(...newSessions);

      // Polling: revisar TODAS las sesiones activas (este batch + anteriores)
      const pollWaitMs = Math.min(torrentWaitMs, deadlineAt - Date.now());
      const pollStart = Date.now();
      let winnerDetectedAt = 0;
      while (Date.now() - pollStart < pollWaitMs) {
        for (const entry of allActiveSessions) {
          if (!entry.session) continue;
          const s = getSessionById(entry.session.id);
          if (!s) continue;
          if (s.status === "ready") {
            if (!torrentWinner) {
              torrentWinner = entry;
              winnerDetectedAt = Date.now();
            }
            continue;
          }
          if (s.status === "error") {
            entry.error = new Error(s.error || "session-error");
            entry.session = null;
          }
        }
        if (!torrentWinner) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        const readyCount = countReadyTorrents();
        const graceExceeded = winnerDetectedAt > 0 && Date.now() - winnerDetectedAt >= WINNER_GRACE_MS;
        if (readyCount >= TARGET_READY_TORRENTS || graceExceeded) {
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!torrentWinner) {
        console.log(`[AUTO-DEBUG] Batch poll done, no winner yet (${Date.now() - pollStart}ms). Launching next batch...`);
      } else {
        console.log(
          `[AUTO-DEBUG] Batch poll done with winner (${Date.now() - pollStart}ms). readyTorrents=${countReadyTorrents()}`
        );
      }
    }

    // Registrar resultados y limpiar sesiones.
    // Si otras sesiones ya quedaron ready cuando se encontro el winner, guardarlas como alternativas.
    for (const entry of allActiveSessions) {
      const bucket = qualityBucketFromResolution(entry.candidate.resolution);
      const finalSession = entry?.session?.id ? getSessionById(entry.session.id) : null;
      const isReady = Boolean(finalSession && finalSession.status === "ready");
      const shouldKeepAsValidated = torrentWinner === entry || isReady;
      if (shouldKeepAsValidated && finalSession) {
        touchSession(finalSession);
        const payload = sessionPublicInfo(finalSession);
        upsertValidated({
          bucket,
          mode: "session",
          streamKind: finalSession.streamKind || "direct",
          streamUrl: payload.streamUrl,
          sessionId: finalSession.id,
          session: payload,
          candidate: entry.candidate
        }, bucket);
        attempts.push({
          mode: "torrent",
          providerId: entry.candidate.providerId,
          displayName: compactText(entry.candidate.displayName, 120),
          ok: true,
          reason: torrentWinner === entry ? null : "secondary-ready"
        });
        if (torrentWinner === entry) {
          console.log(`[AUTO-DEBUG] WINNER in ${Date.now() - torrentPhaseStart}ms: ${(entry.candidate.displayName || "").slice(0, 70)}`);
        } else {
          console.log(`[AUTO-DEBUG] ALT-READY in ${Date.now() - torrentPhaseStart}ms: ${(entry.candidate.displayName || "").slice(0, 70)}`);
        }
      } else {
        const reason = entry.error?.message || "timeout-parallel";
        attempts.push({
          mode: "torrent",
          providerId: entry.candidate.providerId,
          displayName: compactText(entry.candidate.displayName, 120),
          ok: false,
          reason: compactText(reason, 180)
        });
        if (entry.session?.id) {
          destroySession(entry.session.id, "autoplay-parallel-loser");
        }
      }
    }

    if (torrentWinner) {
      console.log(`[AUTO-DEBUG] Torrent phase success, validated=${autoValidatedCount}. Returning immediately.`);
    } else {
      console.log(`[AUTO-DEBUG] Torrent phase failed, all ${allActiveSessions.length} sessions timed out in ${Date.now() - torrentPhaseStart}ms`);
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
        const rank = estimateAutoEntryRank(entry);
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
    logM3uVodPlayback("autoplay", selectedEntry);

    let sessionPayload = selectedEntry.session;
    if (selectedEntry.sessionId) {
      const liveSession = getSessionById(selectedEntry.sessionId);
      if (!liveSession) {
        return res.status(502).json({ error: "La sesion validada ya no esta disponible." });
      }
      touchSession(liveSession);
      sessionPayload = sessionPublicInfo(liveSession);
    }

    // Construir alternativas usando TODAS las entradas validadas (no solo best-per-bucket)
    const alternatives = buildAutoAlternatives(allValidatedEntries, selectedEntry, MAX_AUTO_ALTERNATIVES);

    // Destruir sesiones que no se usarán (ni como seleccionada ni como alternativa)
    const usedSessionIds = new Set();
    if (selectedEntry.sessionId) usedSessionIds.add(selectedEntry.sessionId);
    for (const alt of alternatives) {
      if (alt.sessionId) usedSessionIds.add(alt.sessionId);
    }
    for (const entry of allValidatedEntries) {
      if (!entry?.sessionId) continue;
      if (usedSessionIds.has(entry.sessionId)) continue;
      destroySession(entry.sessionId, "autoplay-unused");
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
      alternatives,
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
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.setHeader("X-HLS-Segment-Count", String(session.hls.lastSegmentCount || 0));
      // Servir el manifest raw de ffmpeg tal cual.
      // ffmpeg usa -hls_playlist_type event, asi que el manifest crece sin ENDLIST
      // hasta que el transcode termine. hls.js en modo live lo re-pollea automaticamente.
      return res.sendFile(assetPath);
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

  // Prefetch de siguiente episodio (background, no bloquea)
  app.post("/api/playback/prefetch-next", (req, res) => {
    const type = safeText(req.body?.type).toLowerCase();
    const itemId = safeText(req.body?.itemId);
    const season = safeText(req.body?.season);
    const nextEpisode = String((Number(req.body?.episode) || 0) + 1);
    const audioSelection = parseAudioSelection(req);

    if (type !== "series" || !itemId || !season) {
      return res.json({ prefetched: false, reason: "not-series" });
    }

    res.json({ prefetched: true, nextEpisode: Number(nextEpisode) });

    setImmediate(async () => {
      try {
        const aggregated = await fetchAggregatedStreams({
          type, itemId, season, episode: nextEpisode
        });
        const candidates = buildCandidatesFromResults(aggregated.results, audioSelection);
        const ordered = orderCandidatesForPlayback(candidates, "auto").slice(0, 3);
        if (!ordered.length) return;

        const cacheKey = buildPreflightCacheKey({
          type, itemId, season, episode: nextEpisode,
          quality: "auto", maxCandidates: 3,
          audioPreference: audioSelection.audioPreference,
          originalLanguage: audioSelection.originalLanguage
        });
        playbackPreflightCache.set(cacheKey, {
          cachedAt: nowMs(),
          payload: { candidates: ordered, prefetched: true }
        });
      } catch {
        // Silencioso - es prefetch
      }
    });
  });
}

module.exports = { registerPlaybackRoutes };
