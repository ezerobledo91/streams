const { safeText } = require("../utils");

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPattern(text, pattern) {
  const source = escapeRegExp(safeText(pattern).toLowerCase().trim());
  if (!source) return false;
  const normalized = source.replace(/\s+/g, "\\s+");
  const regex = new RegExp(`(?:^|[^a-z0-9])${normalized}(?=$|[^a-z0-9])`, "i");
  return regex.test(String(text || ""));
}

function normalizeLanguageCode(value) {
  const raw = safeText(value).toLowerCase().trim();
  if (!raw) return "";
  if (raw === "spa") return "es";
  if (raw === "eng") return "en";
  if (raw === "mx" || raw === "es-mx" || raw === "es_mx") return "es-419";
  if (raw === "es-la" || raw === "es_419" || raw.startsWith("es-419")) return "es-419";
  if (raw.includes("-")) return raw.split("-")[0];
  return raw;
}

function getAudioPriorityOrder(preference, originalLanguage) {
  const normalizedPreference = safeText(preference).toLowerCase() === "es" ? "es" : "original";
  if (normalizedPreference === "es") {
    return ["es-419", "es", "multi", "und", "en"];
  }

  const normalizedOriginal = normalizeLanguageCode(originalLanguage);
  if (!normalizedOriginal || normalizedOriginal === "und") {
    return ["en", "es-419", "es", "multi", "und"];
  }

  if (normalizedOriginal === "es-419" || normalizedOriginal === "es") {
    return ["es-419", "es", "multi", "und", "en"];
  }

  // Idioma original primero, luego inglés, luego otros idiomas explícitos,
  // multi/und al final para evitar doblajes no deseados
  return [...new Set([normalizedOriginal, "en", "es-419", "es", "multi", "und"])];
}

function buildAllowedLanguageSet(audioOptions = {}) {
  const allowed = new Set(["en", "es", "es-419", "multi", "und"]);
  const normalizedOriginal = normalizeLanguageCode(audioOptions?.originalLanguage);
  if (normalizedOriginal) {
    allowed.add(normalizedOriginal);
  }
  return allowed;
}

function hasPreferredLanguageHint(hints, allowedSet) {
  let explicitCount = 0;
  for (const hint of hints || []) {
    const normalized = normalizeLanguageCode(hint);
    if (!normalized || normalized === "und") continue;
    explicitCount += 1;
    if (allowedSet.has(normalized)) return true;
  }
  return explicitCount === 0;
}

function extractCandidateLanguageHints(stream) {
  const text = [
    stream?.title,
    stream?.name,
    stream?.description,
    stream?.behaviorHints?.filename
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hints = new Set();
  if (!text) {
    hints.add("und");
    return hints;
  }

  if (
    containsPattern(text, "multi") ||
    containsPattern(text, "multi-audio") ||
    containsPattern(text, "multi audio") ||
    containsPattern(text, "dual audio")
  ) {
    hints.add("multi");
  }

  const map = [
    {
      lang: "es-419",
      patterns: ["latino", "latam", "audio latino", "es-la", "es_419", "hispano", "es-mx", "mexico", "mx"]
    },
    { lang: "es", patterns: ["espanol", "castellano", "spanish", "spa"] },
    { lang: "en", patterns: ["english", "ingles", "eng", "en-us", "en-gb"] },
    { lang: "pt", patterns: ["portuguese", "portugues", "pt-br", "ptbr", "por"] },
    { lang: "fr", patterns: ["french", "fra", "fre"] },
    { lang: "it", patterns: ["italian", "ita"] },
    { lang: "de", patterns: ["german", "deu", "ger"] },
    { lang: "ja", patterns: ["japanese", "jpn", "jap"] },
    { lang: "ko", patterns: ["korean", "kor"] },
    { lang: "zh", patterns: ["chinese", "chi", "mandarin", "cantonese"] },
    { lang: "ru", patterns: ["russian", "rus"] }
  ];

  for (const item of map) {
    if (item.patterns.some((pattern) => containsPattern(text, pattern))) {
      hints.add(item.lang);
    }
  }

  if (!hints.size) {
    hints.add("und");
  }

  return hints;
}

function resolveLanguageRank(hints, priorityOrder) {
  let best = 999;
  for (const hint of hints) {
    const idx = priorityOrder.indexOf(hint);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

function languageScoreAdjustment(languageRank) {
  if (languageRank === 0) return 40;
  if (languageRank === 1) return 28;
  if (languageRank === 2) return 16;
  if (languageRank === 3) return 8;
  if (languageRank === 4) return 2;
  if (languageRank === 5) return 0;
  return -80;
}

function parseInteger(value) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseNumberFromText(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return parseInteger(match[1]);
    }
  }
  return 0;
}

function extractSeeders(stream) {
  const direct = parseInteger(stream?.seeders || stream?.seeds || stream?.behaviorHints?.seeders || stream?.behaviorHints?.seeds || 0);
  if (direct > 0) return direct;
  const text = [stream?.title, stream?.name, stream?.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [
    /seeders?\D+(\d+)/i,
    /seeds?\D+(\d+)/i,
    /(\d+)\s*seeders?/i,
    /(\d+)\s*seeds?/i,
    /semillas?\D+(\d+)/i,
    /\bs[:=]\s*(\d+)\b/i
  ]);
}

function extractPeers(stream) {
  const direct = parseInteger(stream?.peers || stream?.behaviorHints?.peers || 0);
  if (direct > 0) return direct;
  const text = [stream?.title, stream?.name, stream?.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [/peers?\D+(\d+)/i, /(\d+)\s*peers?/i, /leechers?\D+(\d+)/i]);
}

function extractResolution(stream) {
  const text = [stream?.title, stream?.name, stream?.description].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return 2160;
  if (text.includes("1440")) return 1440;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  if (text.includes("480")) return 480;
  return 0;
}

function extractVideoSizeBytes(stream) {
  const fromHint = Number(stream?.behaviorHints?.videoSize || 0);
  if (Number.isFinite(fromHint) && fromHint > 0) return fromHint;

  const text = [stream?.title, stream?.name, stream?.description].filter(Boolean).join(" ");
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|tb)/iu);
  if (!match) return 0;

  const raw = Number(match[1].replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const unit = match[2].toLowerCase();
  if (unit === "mb") return raw * 1024 * 1024;
  if (unit === "gb") return raw * 1024 * 1024 * 1024;
  if (unit === "tb") return raw * 1024 * 1024 * 1024 * 1024;
  return 0;
}

function getTrackers(stream) {
  const trackers = [];
  if (Array.isArray(stream?.sources)) {
    for (const source of stream.sources) {
      if (source?.startsWith("tracker:")) {
        trackers.push(source.slice("tracker:".length));
      }
    }
  }
  return [...new Set(trackers)];
}

function getFileExtension(stream) {
  const fromFilename = String(stream?.behaviorHints?.filename || "").trim().toLowerCase();
  const fromTitle = String(stream?.title || stream?.name || "").trim().toLowerCase();
  let source = fromFilename || fromTitle;
  if (!source && typeof stream?.url === "string" && /^https?:\/\//i.test(stream.url)) {
    try {
      source = new URL(stream.url).pathname.toLowerCase();
    } catch {
      source = "";
    }
  }
  const match = source.match(/\.([a-z0-9]{2,5})(?:\s|$)/i);
  if (!match?.[1]) return "unknown";
  return match[1].toLowerCase();
}

function isWebFriendlyExtension(ext) {
  return ext === "mp4" || ext === "webm" || ext === "m4v" || ext === "m3u8";
}

function buildMagnet(stream, displayName) {
  if (typeof stream?.url === "string" && stream.url.startsWith("magnet:")) {
    return stream.url;
  }

  if (Array.isArray(stream?.sources)) {
    const sourceMagnet = stream.sources.find((value) => typeof value === "string" && value.startsWith("magnet:"));
    if (sourceMagnet) return sourceMagnet;
  }

  const infoHash = String(stream?.infoHash || "").trim();
  if (!infoHash) return null;

  const params = [`xt=urn:btih:${infoHash}`];
  if (displayName) {
    params.push(`dn=${encodeURIComponent(displayName)}`);
  }
  for (const tracker of getTrackers(stream)) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }
  return `magnet:?${params.join("&")}`;
}

function getDirectUrl(stream) {
  if (typeof stream?.url !== "string") return null;
  const value = stream.url.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return null;
}

function isLikelyUnavailableStream(stream) {
  const text = [stream?.name, stream?.title, stream?.description].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return (
    text.includes("non-debrid") ||
    text.includes("disabled") ||
    text.includes("not available") ||
    text.includes("premium required") ||
    text.includes("[⛔")
  );
}

function calculateScore(stream, providerId, audioOptions = {}) {
  const seeders = extractSeeders(stream);
  const peers = extractPeers(stream);
  const resolution = extractResolution(stream);
  const videoSizeBytes = extractVideoSizeBytes(stream);
  const sizeGb = videoSizeBytes > 0 ? videoSizeBytes / (1024 * 1024 * 1024) : 0;
  const trackers = getTrackers(stream).length;
  const hasTorrent = Boolean(stream?.infoHash || String(stream?.url || "").startsWith("magnet:"));
  const fileExtension = getFileExtension(stream);
  const webFriendly = isWebFriendlyExtension(fileExtension);
  const likelyIncompatible = fileExtension === "mkv" || fileExtension === "avi";
  const providerBonus = safeText(providerId).toLowerCase() === "prowlarr" ? 8 : 0;
  const reliabilityPenalty = Number(stream?.behaviorHints?.reliabilityPenalty || 0);
  const audioPriority = getAudioPriorityOrder(audioOptions?.audioPreference, audioOptions?.originalLanguage);
  const languageHints = extractCandidateLanguageHints(stream);
  const allowedLanguageSet = buildAllowedLanguageSet(audioOptions);
  const allowedLanguage = hasPreferredLanguageHint(languageHints, allowedLanguageSet);
  const languageRank = resolveLanguageRank(languageHints, audioPriority);
  const languageBonus = languageScoreAdjustment(languageRank);

  let formatBonus = -4;
  if (webFriendly) formatBonus = 10;
  else if (fileExtension === "mkv") formatBonus = -12;
  else if (fileExtension === "avi") formatBonus = -16;

  const largeFilePenalty = videoSizeBytes > 12 * 1024 * 1024 * 1024 ? 16 : 0;
  const incompatiblePenalty = likelyIncompatible ? 8 : 0;

  const score =
    seeders * 6 +
    peers * 2 +
    resolution / 120 +
    trackers * 1.5 +
    (hasTorrent ? 8 : 4) +
    providerBonus +
    languageBonus +
    formatBonus -
    sizeGb * 1.4 -
    reliabilityPenalty -
    incompatiblePenalty -
    largeFilePenalty -
    (allowedLanguage ? 0 : 220);
  return {
    score,
    seeders,
    peers,
    resolution,
    videoSizeBytes,
    fileExtension,
    webFriendly,
    likelyIncompatible,
    languageRank,
    languageHints: [...languageHints],
    allowedLanguage
  };
}

function toCandidate(stream, provider, index, audioOptions = {}) {
  const displayName = stream?.title || stream?.name || `Stream ${index + 1}`;
  const magnet = buildMagnet(stream, displayName);
  const directUrl = getDirectUrl(stream);
  if (!magnet && directUrl && isLikelyUnavailableStream(stream)) return null;
  if (!magnet && !directUrl) return null;

  const metrics = calculateScore(stream, provider?.id, audioOptions);
  const fileIdx = Number.isFinite(Number(stream?.fileIdx)) ? Number(stream.fileIdx) : null;

  return {
    providerId: provider?.id || "unknown",
    providerName: provider?.name || "Provider",
    providerBaseUrl: provider?.baseUrl || "",
    displayName,
    magnet,
    directUrl,
    stream,
    fileIdx,
    ...metrics
  };
}

function candidateIdentityKey(candidate) {
  const infoHash = String(candidate?.stream?.infoHash || "").trim().toLowerCase();
  const filePart = Number.isInteger(candidate?.fileIdx) ? `|f${candidate.fileIdx}` : "";
  if (infoHash) return `hash:${infoHash}${filePart}`;
  if (candidate?.directUrl) return `url:${candidate.directUrl.toLowerCase()}`;
  return `name:${safeText(candidate?.displayName).toLowerCase()}|${candidate?.resolution || 0}|${Math.round(Number(candidate?.videoSizeBytes || 0) / (1024 * 1024))}${filePart}`;
}

function pickBestCandidate(current, incoming) {
  if (Boolean(incoming?.webFriendly) !== Boolean(current?.webFriendly)) {
    return incoming?.webFriendly ? incoming : current;
  }
  const incomingKnownExt = safeText(incoming?.fileExtension) && safeText(incoming?.fileExtension) !== "unknown";
  const currentKnownExt = safeText(current?.fileExtension) && safeText(current?.fileExtension) !== "unknown";
  if (Boolean(incomingKnownExt) !== Boolean(currentKnownExt)) {
    return incomingKnownExt ? incoming : current;
  }
  if ((incoming?.score || 0) !== (current?.score || 0)) {
    return (incoming?.score || 0) > (current?.score || 0) ? incoming : current;
  }
  if ((incoming?.seeders || 0) !== (current?.seeders || 0)) {
    return (incoming?.seeders || 0) > (current?.seeders || 0) ? incoming : current;
  }
  if ((incoming?.resolution || 0) !== (current?.resolution || 0)) {
    return (incoming?.resolution || 0) > (current?.resolution || 0) ? incoming : current;
  }
  return (incoming?.videoSizeBytes || 0) > (current?.videoSizeBytes || 0) ? incoming : current;
}

function dedupeCandidates(items) {
  const byKey = new Map();
  for (const candidate of items) {
    const key = candidateIdentityKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    byKey.set(key, pickBestCandidate(existing, candidate));
  }
  return [...byKey.values()];
}

function qualityBucketFromResolution(resolution) {
  const value = Number(resolution || 0);
  if (value >= 2160) return "4k";
  if (value >= 1080) return "1080p";
  if (value >= 720) return "720p";
  return "sd";
}

function rankCandidateForAuto(candidate) {
  let rank = Number(candidate?.score || 0);
  const reliabilityPenalty = Number(candidate?.stream?.behaviorHints?.reliabilityPenalty || 0);
  const sizeGb = Number(candidate?.videoSizeBytes || 0) / (1024 * 1024 * 1024);
  rank -= reliabilityPenalty * 1.5;

  if (candidate?.directUrl) {
    rank += candidate?.webFriendly ? 120 : 75;
  } else if (candidate?.magnet) {
    rank += 18;
    if (candidate?.webFriendly) {
      rank += 140;
    } else if (candidate?.likelyIncompatible) {
      rank -= 18;
    } else if (safeText(candidate?.fileExtension) === "unknown") {
      rank -= 6;
    }
    rank -= sizeGb * 5.5;
    if (sizeGb > 8) rank -= 26;
    if (sizeGb > 14) rank -= 42;
  }

  if (candidate?.resolution >= 2160) rank += 9;
  else if (candidate?.resolution >= 1080) rank += 7;
  else if (candidate?.resolution >= 720) rank += 5;

  if (candidate?.likelyIncompatible) rank -= 8;
  if (Number(candidate?.videoSizeBytes || 0) > 20 * 1024 * 1024 * 1024) rank -= 6;
  if ((candidate?.seeders || 0) <= 0 && (candidate?.peers || 0) <= 0) rank -= 6;

  return rank;
}

function orderCandidatesForPlayback(items, quality = "auto") {
  const normalizedQuality = safeText(quality).toLowerCase();
  let source = dedupeCandidates(Array.isArray(items) ? items : []);

  if (normalizedQuality && normalizedQuality !== "auto") {
    const byQuality = source.filter((item) => qualityBucketFromResolution(item.resolution) === normalizedQuality);
    if (byQuality.length) {
      source = byQuality;
    }
  }

  source.sort((a, b) => {
    const languageAllowedDiff = Number(Boolean(b.allowedLanguage)) - Number(Boolean(a.allowedLanguage));
    if (languageAllowedDiff !== 0) return languageAllowedDiff;

    const rankDiff = rankCandidateForAuto(b) - rankCandidateForAuto(a);
    if (Math.abs(rankDiff) >= 0.25) return rankDiff;

    const languageDiff = Number(a?.languageRank ?? 999) - Number(b?.languageRank ?? 999);
    if (languageDiff !== 0) return languageDiff;

    const directDiff = Number(Boolean(b.directUrl)) - Number(Boolean(a.directUrl));
    if (directDiff !== 0) return directDiff;

    const resDiff = Number(b.resolution || 0) - Number(a.resolution || 0);
    if (resDiff !== 0) return resDiff;

    const seedDiff = Number(b.seeders || 0) - Number(a.seeders || 0);
    if (seedDiff !== 0) return seedDiff;

    return Number(b.score || 0) - Number(a.score || 0);
  });

  return source.filter((item) => item.directUrl || item.magnet);
}

function buildCandidatesFromResults(results, audioOptions = {}) {
  const out = [];
  const list = Array.isArray(results) ? results : [];
  for (const result of list) {
    if (!result?.ok || !Array.isArray(result?.streams)) continue;
    result.streams.forEach((stream, index) => {
      const candidate = toCandidate(stream, result.provider, index, audioOptions);
      if (candidate) out.push(candidate);
    });
  }
  const preferredOnly = out.filter((item) => item.allowedLanguage);
  if (preferredOnly.length) {
    return dedupeCandidates(preferredOnly);
  }
  return dedupeCandidates(out);
}

module.exports = {
  getTrackers,
  toCandidate,
  buildCandidatesFromResults,
  qualityBucketFromResolution,
  orderCandidatesForPlayback
};
