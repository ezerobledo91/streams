export interface ReleaseHints {
  tokens: Set<string>;
  resolution: number;
  codec: string;
  source: string;
  episodeKey: string;
}

export const RELEASE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "web",
  "rip",
  "dl",
  "aac",
  "yts",
  "xvid",
  "proper",
  "repack",
  "subs",
  "sub",
  "spanish",
  "latino",
  "espanol"
]);

export function normalizeReleaseText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReleaseHints(value: string): ReleaseHints {
  const text = normalizeReleaseText(value);
  const tokens = new Set<string>();
  for (const token of text.split(" ")) {
    if (!token || token.length < 3 || RELEASE_STOPWORDS.has(token)) continue;
    tokens.add(token);
    if (tokens.size >= 30) break;
  }

  const resolution =
    text.includes("2160") || text.includes("4k")
      ? 2160
      : text.includes("1440")
        ? 1440
        : text.includes("1080")
          ? 1080
          : text.includes("720")
            ? 720
            : text.includes("480")
              ? 480
              : 0;
  const codec =
    text.includes("x265") || text.includes("h265") || text.includes("hevc")
      ? "x265"
      : text.includes("x264") || text.includes("h264")
        ? "x264"
        : "";
  const source = text.includes("web dl") || text.includes("webdl")
    ? "web-dl"
    : text.includes("webrip")
      ? "webrip"
      : text.includes("bluray")
        ? "bluray"
        : text.includes("brrip")
          ? "brrip"
          : text.includes("hdtv")
            ? "hdtv"
            : "";

  const seMatch = text.match(/\bs(\d{1,2})e(\d{1,2})\b/);
  const xMatch = text.match(/\b(\d{1,2})x(\d{1,2})\b/);
  const seasonEpisodeWordsMatch =
    text.match(/\bseason\s*(\d{1,2})\s*episode\s*(\d{1,2})\b/) ||
    text.match(/\btemporada\s*(\d{1,2})\s*episodio\s*(\d{1,2})\b/);
  const seasonOnlyWordsMatch = text.match(/\bseason\s*(\d{1,2})\b/) || text.match(/\btemporada\s*(\d{1,2})\b/);
  const episodeOnlyWordsMatch =
    text.match(/\bepisode\s*(\d{1,2})\b/) ||
    text.match(/\bepisodio\s*(\d{1,2})\b/) ||
    text.match(/\bep\s*(\d{1,2})\b/);
  const episodeKey = seMatch
    ? `${Number(seMatch[1])}x${Number(seMatch[2])}`
    : xMatch
      ? `${Number(xMatch[1])}x${Number(xMatch[2])}`
      : seasonEpisodeWordsMatch
        ? `${Number(seasonEpisodeWordsMatch[1])}x${Number(seasonEpisodeWordsMatch[2])}`
        : seasonOnlyWordsMatch && episodeOnlyWordsMatch
          ? `${Number(seasonOnlyWordsMatch[1])}x${Number(episodeOnlyWordsMatch[1])}`
          : "";

  return { tokens, resolution, codec, source, episodeKey };
}
