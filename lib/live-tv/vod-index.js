const { safeText, extractResolutionHintFromText } = require("../utils");
const { vodState } = require("../state");
const { normalizeLooseText } = require("./parser");

const EPISODE_PATTERNS = [
  /[sStT]\s*(\d{1,2})\s*[eExX]\s*(\d{1,2})/,
  /[sStT](\d{1,2})[eExX](\d{1,2})/,
  /\b(\d{1,2})x(\d{1,2})\b/,
  /\bT(\d{1,2})E(\d{1,2})\b/i
];

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

function detectQuality(value) {
  const text = safeText(value).toLowerCase();
  if (!text) return null;
  if (text.includes("2160") || text.includes("4k") || text.includes("uhd")) return "2160p";
  if (text.includes("1080") || text.includes("fhd")) return "1080p";
  if (text.includes("720")) return "720p";
  if (text.includes("480")) return "480p";
  if (/\bhd\b/i.test(text)) return "720p";
  if (/\bsd\b/i.test(text)) return "480p";
  return null;
}

function qualityRank(quality) {
  const value = safeText(quality).toLowerCase();
  if (value === "2160p" || value === "4k") return 5;
  if (value === "1080p") return 4;
  if (value === "720p") return 3;
  if (value === "480p") return 2;
  return 1;
}

function estimateVideoSizeFromQuality(quality) {
  const rank = qualityRank(quality);
  if (rank >= 5) return 6 * 1024 * 1024 * 1024;
  if (rank === 4) return 3 * 1024 * 1024 * 1024;
  if (rank === 3) return 2 * 1024 * 1024 * 1024;
  return 1 * 1024 * 1024 * 1024;
}

function parseEpisodeData(name) {
  const raw = safeText(name);
  for (const pattern of EPISODE_PATTERNS) {
    const match = raw.match(pattern);
    if (!match) continue;
    const season = Number.parseInt(match[1], 10);
    const episode = Number.parseInt(match[2], 10);
    if (Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
      return { season, episode };
    }
  }
  return { season: null, episode: null };
}

function stripNoise(value) {
  return safeText(value)
    .replace(/[sStT]\s*\d{1,2}\s*[eExX]\s*\d{1,2}/gi, " ")
    .replace(/[sStT]\d{1,2}[eExX]\d{1,2}/g, " ")
    .replace(/\b\d{1,2}x\d{1,2}\b/gi, " ")
    .replace(/\b(19\d{2}|20\d{2})\b/g, " ")
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|fhd|hd|sd)\b/gi, " ")
    .replace(/\b(dual\s*audio|cam|cast|completo|latino|subtitulado|temporada|episodio|capitulo)\b/gi, " ")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVodEntry(entry) {
  const name = safeText(entry?.name) || "Sin titulo";
  const streamUrl = safeText(entry?.streamUrl);
  const groupTitle = safeText(entry?.groupTitle) || null;
  const sourceFile = safeText(entry?.sourceFile) || null;
  const logo = safeText(entry?.logo) || null;
  const { season, episode } = parseEpisodeData(name);
  const yearMatch = name.match(YEAR_PATTERN);
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const quality = detectQuality(name) || detectQuality(streamUrl);
  const cleanedTitle = stripNoise(name);
  const normalizedTitle = normalizeLooseText(cleanedTitle || name);
  const resolutionHint = extractResolutionHintFromText(`${quality || ""} ${name}`);

  return {
    name,
    streamUrl,
    groupTitle,
    logo,
    sourceFile,
    normalizedTitle,
    season,
    episode,
    year: Number.isFinite(year) ? year : null,
    quality,
    resolutionHint,
    searchText: normalizeLooseText(`${name} ${groupTitle || ""}`)
  };
}

function sortVodEntries(items) {
  return [...items].sort((a, b) => {
    const qualityDiff = qualityRank(b.quality) - qualityRank(a.quality);
    if (qualityDiff !== 0) return qualityDiff;
    const resolutionDiff = Number(b.resolutionHint || 0) - Number(a.resolutionHint || 0);
    if (resolutionDiff !== 0) return resolutionDiff;
    return safeText(a.name).localeCompare(safeText(b.name));
  });
}

function buildVodIndex(entries) {
  const all = Array.isArray(entries) ? entries : [];
  const normalized = [];
  const byTitle = new Map();
  const byEpisode = new Map();

  for (const item of all) {
    const parsed = normalizeVodEntry(item);
    if (!parsed.streamUrl || !parsed.normalizedTitle) continue;
    normalized.push(parsed);

    if (!byTitle.has(parsed.normalizedTitle)) {
      byTitle.set(parsed.normalizedTitle, []);
    }
    byTitle.get(parsed.normalizedTitle).push(parsed);

    if (Number.isFinite(parsed.season) && Number.isFinite(parsed.episode)) {
      const key = `${parsed.normalizedTitle}:s${parsed.season}e${parsed.episode}`;
      if (!byEpisode.has(key)) {
        byEpisode.set(key, []);
      }
      byEpisode.get(key).push(parsed);
    }
  }

  for (const [key, items] of byTitle.entries()) {
    byTitle.set(key, sortVodEntries(items));
  }
  for (const [key, items] of byEpisode.entries()) {
    byEpisode.set(key, sortVodEntries(items));
  }

  vodState.loadedAt = new Date().toISOString();
  vodState.entries = normalized;
  vodState.byTitle = byTitle;
  vodState.byEpisode = byEpisode;
  vodState.totalCount = normalized.length;

  return {
    loadedAt: vodState.loadedAt,
    totalCount: vodState.totalCount,
    titleKeys: byTitle.size,
    episodeKeys: byEpisode.size
  };
}

function rankSearchMatch(entry, normalizedTitle, seasonNum, episodeNum) {
  let score = 0;
  if (entry.normalizedTitle === normalizedTitle) score += 120;
  else if (entry.normalizedTitle.startsWith(normalizedTitle)) score += 80;
  else if (entry.normalizedTitle.includes(normalizedTitle)) score += 55;
  else if (normalizedTitle.includes(entry.normalizedTitle)) score += 35;

  if (Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
    if (entry.season === seasonNum && entry.episode === episodeNum) score += 70;
    else if (entry.season === seasonNum) score += 12;
  }

  score += qualityRank(entry.quality) * 6;
  score += Math.min(Number(entry.resolutionHint || 0) / 120, 15);
  return score;
}

function dedupeByStreamUrl(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = safeText(item?.streamUrl).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function searchVodIndex(title, { season = "", episode = "" } = {}) {
  const normalizedTitle = normalizeLooseText(title);
  if (!normalizedTitle) return [];

  const seasonNum = Number.parseInt(String(season || ""), 10);
  const episodeNum = Number.parseInt(String(episode || ""), 10);
  const hasEpisodeTarget =
    Number.isFinite(seasonNum) && seasonNum > 0 && Number.isFinite(episodeNum) && episodeNum > 0;

  let candidates = [];
  if (hasEpisodeTarget) {
    const key = `${normalizedTitle}:s${seasonNum}e${episodeNum}`;
    candidates = [...(vodState.byEpisode.get(key) || [])];
  }

  if (!candidates.length) {
    candidates = [...(vodState.byTitle.get(normalizedTitle) || [])];
  }

  if (!candidates.length) {
    const fallback = [];
    for (const entry of vodState.entries) {
      if (!entry?.normalizedTitle) continue;
      if (entry.normalizedTitle.includes(normalizedTitle) || normalizedTitle.includes(entry.normalizedTitle)) {
        fallback.push(entry);
      }
    }
    candidates = fallback;
  }

  const ranked = candidates
    .map((entry) => ({
      entry,
      score: rankSearchMatch(entry, normalizedTitle, seasonNum, episodeNum)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const qualityDiff = qualityRank(b.entry.quality) - qualityRank(a.entry.quality);
      if (qualityDiff !== 0) return qualityDiff;
      return safeText(a.entry.name).localeCompare(safeText(b.entry.name));
    })
    .map((item) => item.entry);

  return dedupeByStreamUrl(ranked).slice(0, 120);
}

module.exports = {
  buildVodIndex,
  searchVodIndex,
  estimateVideoSizeFromQuality
};
