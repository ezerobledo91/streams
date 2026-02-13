const { safeText } = require("../utils");

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".m4v",
  ".mkv",
  ".mov",
  ".avi",
  ".ts",
  ".m2ts",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".flv",
  ".ogv",
  ".3gp"
]);

function isLikelySampleOrExtra(file) {
  const name = safeText(file?.name).toLowerCase();
  const length = Number(file?.length || 0);
  if (!name) return false;

  if (/\b(sample|trailer|teaser|featurette|behind[-_. ]the[-_. ]scenes|extras?)\b/i.test(name)) {
    return true;
  }
  if (length > 0 && length < 120 * 1024 * 1024 && /\b(sample|clip)\b/i.test(name)) {
    return true;
  }
  return false;
}

function isLikelyVideoFile(file) {
  const name = safeText(file?.name).toLowerCase();
  if (!name) return false;
  const extMatch = name.match(/(\.[a-z0-9]{2,5})$/i);
  if (!extMatch?.[1]) return false;
  return VIDEO_EXTENSIONS.has(extMatch[1].toLowerCase());
}

function extractEpisodeKeyFromFileName(fileName) {
  const text = safeText(fileName).toLowerCase();
  if (!text) return "";

  const seMatch = text.match(/\bs(\d{1,2})e(\d{1,2})\b/);
  if (seMatch?.[1] && seMatch?.[2]) {
    return `${Number(seMatch[1])}x${Number(seMatch[2])}`;
  }

  const xMatch = text.match(/\b(\d{1,2})x(\d{1,2})\b/);
  if (xMatch?.[1] && xMatch?.[2]) {
    return `${Number(xMatch[1])}x${Number(xMatch[2])}`;
  }

  const seasonEpisodeMatch = text.match(/\bseason\s*(\d{1,2})\s*episode\s*(\d{1,2})\b/);
  if (seasonEpisodeMatch?.[1] && seasonEpisodeMatch?.[2]) {
    return `${Number(seasonEpisodeMatch[1])}x${Number(seasonEpisodeMatch[2])}`;
  }

  return "";
}

function pickBestVideoFileFromList(list) {
  if (!Array.isArray(list) || !list.length) return null;

  const videoOnly = list.filter(isLikelyVideoFile);
  if (!videoOnly.length) return null;

  const noSamples = videoOnly.filter((file) => !isLikelySampleOrExtra(file));
  const sourceList = noSamples.length ? noSamples : videoOnly;

  const preferredExtensions = [".mp4", ".webm", ".m4v"];
  const fallbackExtensions = [".mkv", ".mov", ".avi"];

  const lowerName = (file) => String(file.name || "").toLowerCase();
  const preferred = sourceList.filter((file) =>
    preferredExtensions.some((ext) => lowerName(file).endsWith(ext))
  );
  const fallback = sourceList.filter((file) =>
    fallbackExtensions.some((ext) => lowerName(file).endsWith(ext))
  );

  if (preferred.length) {
    const filtered = preferred.filter((file) => Number(file.length || 0) <= 12 * 1024 * 1024 * 1024);
    const source = filtered.length ? filtered : preferred;
    return source.sort((a, b) => b.length - a.length)[0];
  }

  if (fallback.length) {
    return fallback.sort((a, b) => Number(b.length || 0) - Number(a.length || 0))[0];
  }

  return sourceList.sort((a, b) => Number(b.length || 0) - Number(a.length || 0))[0] || null;
}

function pickTorrentFile(torrent, preferredFileIdx = null, expectedEpisodeKey = "") {
  const files = Array.isArray(torrent?.files) ? torrent.files : [];
  if (!files.length) return null;

  const normalizedExpectedEpisodeKey = safeText(expectedEpisodeKey).toLowerCase();
  if (normalizedExpectedEpisodeKey) {
    const exactEpisodeFiles = files.filter(
      (file) => extractEpisodeKeyFromFileName(file?.name) === normalizedExpectedEpisodeKey
    );
    const bestExact = pickBestVideoFileFromList(exactEpisodeFiles);
    if (bestExact) return bestExact;

    const unknownEpisodeFiles = files.filter((file) => !extractEpisodeKeyFromFileName(file?.name));
    const bestUnknown = pickBestVideoFileFromList(unknownEpisodeFiles);
    if (bestUnknown) return bestUnknown;
    return null;
  }

  if (Number.isInteger(preferredFileIdx) && files[preferredFileIdx]) {
    return files[preferredFileIdx];
  }

  return pickBestVideoFileFromList(files);
}

module.exports = {
  extractEpisodeKeyFromFileName,
  pickBestVideoFileFromList,
  pickTorrentFile
};
