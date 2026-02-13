const { safeText, normalizeInfoHash, extractInfoHashFromText } = require("../utils");
const { DEFAULT_PUBLIC_TRACKERS } = require("../config");

function formatBytesCompact(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "N/D";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let out = size;
  let idx = 0;
  while (out >= 1024 && idx < units.length - 1) {
    out /= 1024;
    idx += 1;
  }
  const precision = idx >= 2 ? 2 : 0;
  return `${out.toFixed(precision)} ${units[idx]}`;
}

function parseResolutionFromText(value) {
  const text = safeText(value).toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return 2160;
  if (text.includes("1440")) return 1440;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  if (text.includes("480")) return 480;
  return 0;
}

function mapProwlarrSearchResultToStream(entry) {
  const infoHash =
    normalizeInfoHash(entry?.infoHash) ||
    extractInfoHashFromText(entry?.guid) ||
    extractInfoHashFromText(entry?.magnetUrl) ||
    extractInfoHashFromText(entry?.downloadUrl);
  if (!infoHash) return null;

  const seeders = Number.parseInt(entry?.seeders, 10);
  const leechers = Number.parseInt(entry?.leechers, 10);
  const size = Number(entry?.size || 0);
  const indexerName = safeText(entry?.indexer) || "Prowlarr";
  const publishDate = safeText(entry?.publishDate);
  const title = safeText(entry?.title) || `Torrent ${infoHash.slice(0, 8)}`;

  const magnetValue = safeText(entry?.magnetUrl);
  const sources = [];
  if (magnetValue.startsWith("magnet:")) {
    sources.push(magnetValue);
  }

  for (const tracker of DEFAULT_PUBLIC_TRACKERS) {
    sources.push(`tracker:${tracker}`);
  }

  return {
    title,
    name: title,
    description: `[Prowlarr:${indexerName}] seeders ${Number.isFinite(seeders) ? seeders : 0} | size ${formatBytesCompact(size)}${publishDate ? ` | ${publishDate}` : ""}`,
    infoHash,
    seeders: Number.isFinite(seeders) ? seeders : 0,
    peers: Number.isFinite(leechers) ? leechers : 0,
    behaviorHints: {
      videoSize: Number.isFinite(size) && size > 0 ? size : undefined,
      filename: safeText(entry?.fileName) || undefined,
      bingeGroup: "prowlarr"
    },
    sources
  };
}

function pickBestProwlarrStream(current, incoming) {
  const currentSeeders = Number(current?.seeders || 0);
  const incomingSeeders = Number(incoming?.seeders || 0);
  if (incomingSeeders !== currentSeeders) {
    return incomingSeeders > currentSeeders ? incoming : current;
  }

  const currentRes = parseResolutionFromText(current?.title || current?.name);
  const incomingRes = parseResolutionFromText(incoming?.title || incoming?.name);
  if (incomingRes !== currentRes) {
    return incomingRes > currentRes ? incoming : current;
  }

  const currentSize = Number(current?.behaviorHints?.videoSize || 0);
  const incomingSize = Number(incoming?.behaviorHints?.videoSize || 0);
  return incomingSize > currentSize ? incoming : current;
}

function filterEpisodeProwlarrStreams(streams, seasonNum, episodeNum) {
  if (!Array.isArray(streams) || !streams.length || !seasonNum || !episodeNum) {
    return Array.isArray(streams) ? streams : [];
  }

  const tokenA = `s${String(seasonNum).padStart(2, "0")}e${String(episodeNum).padStart(2, "0")}`;
  const tokenB = `${seasonNum}x${episodeNum}`;
  const seasonOnly = `s${String(seasonNum).padStart(2, "0")}`;
  const filtered = streams.filter((item) => {
    const text = `${safeText(item?.title)} ${safeText(item?.name)} ${safeText(item?.description)}`.toLowerCase();
    return (
      text.includes(tokenA) ||
      text.includes(tokenB) ||
      text.includes(`season ${seasonNum}`) ||
      text.includes(`temporada ${seasonNum}`) ||
      text.includes(seasonOnly)
    );
  });

  return filtered.length ? filtered : streams;
}

function dedupeProwlarrStreams(streams, limit = 140) {
  const byHash = new Map();
  for (const stream of streams || []) {
    const hash = normalizeInfoHash(stream?.infoHash);
    if (!hash) continue;
    const existing = byHash.get(hash);
    if (!existing) {
      byHash.set(hash, stream);
      continue;
    }
    byHash.set(hash, pickBestProwlarrStream(existing, stream));
  }

  return [...byHash.values()]
    .sort((a, b) => {
      const seedDiff = Number(b?.seeders || 0) - Number(a?.seeders || 0);
      if (seedDiff !== 0) return seedDiff;
      const resDiff = parseResolutionFromText(b?.title || b?.name) - parseResolutionFromText(a?.title || a?.name);
      if (resDiff !== 0) return resDiff;
      return Number(b?.behaviorHints?.videoSize || 0) - Number(a?.behaviorHints?.videoSize || 0);
    })
    .slice(0, limit);
}

module.exports = {
  formatBytesCompact,
  parseResolutionFromText,
  mapProwlarrSearchResultToStream,
  pickBestProwlarrStream,
  filterEpisodeProwlarrStreams,
  dedupeProwlarrStreams
};
