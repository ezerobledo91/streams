import { normalizeLanguageCode } from "./audio-preferences";
import { normalizeReleaseText } from "./release-hints";

export interface UiSubtitleTrack {
  id: string;
  label: string;
  language: string;
  extension: string;
  url: string;
  source: "torrent" | "addon";
}

export function dedupeSubtitleTracks(items: UiSubtitleTrack[]): UiSubtitleTrack[] {
  const out: UiSubtitleTrack[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${normalizeLanguageCode(item.language)}|${item.url.toLowerCase()}`;
    if (!item.url || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 40) break;
  }

  return out;
}

export function normalizeSubtitleVariantKey(track: UiSubtitleTrack): string {
  const normalized = normalizeReleaseText(track.label || "");
  if (!normalized) {
    return `${normalizeLanguageCode(track.language)}|${track.source}`;
  }

  const compact = normalized
    .replace(/\b(es|spa|spanish|espanol|castellano|latino|latam)\b/g, " ")
    .replace(/\b\d{3,4}p\b/g, " ")
    .replace(/\b(?:h264|h265|x264|x265|hevc|webrip|web dl|webdl|bluray)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const base = compact || normalized;
  return `${normalizeLanguageCode(track.language)}|${base}`;
}
