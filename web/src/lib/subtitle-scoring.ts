import type { StreamCandidate } from "../types";
import type { UiSubtitleTrack } from "./subtitle-tracks";
import { extractReleaseHints } from "./release-hints";

export function scoreSubtitleTrackMatch(
  track: UiSubtitleTrack,
  candidate: StreamCandidate | null,
  activeReleaseText: string,
  preferredSubtitleUrl: string,
  expectedEpisodeKey: string
): number {
  if (!candidate) return track.source === "torrent" ? 8 : 0;
  const candidateText = `${candidate.displayName} ${candidate.stream.title || ""} ${candidate.stream.description || ""} ${activeReleaseText || ""}`;
  const candidateHints = extractReleaseHints(candidateText);
  const subtitleHints = extractReleaseHints(`${track.label} ${track.url}`);

  let score = track.source === "torrent" ? 16 : 0;
  if (track.extension === ".srt") {
    score += 3;
  }

  const candidateEpisodeKey = expectedEpisodeKey || candidateHints.episodeKey;
  if (candidateEpisodeKey && subtitleHints.episodeKey) {
    if (candidateEpisodeKey === subtitleHints.episodeKey) {
      score += 44;
    } else {
      score -= 60;
    }
  } else if (candidateEpisodeKey && !subtitleHints.episodeKey && track.source !== "torrent") {
    score -= 12;
  }
  if (candidateHints.resolution && subtitleHints.resolution && candidateHints.resolution === subtitleHints.resolution) {
    score += 16;
  }
  if (candidateHints.codec && subtitleHints.codec && candidateHints.codec === subtitleHints.codec) {
    score += 12;
  }
  if (candidateHints.source && subtitleHints.source && candidateHints.source === subtitleHints.source) {
    score += 10;
  }

  let overlap = 0;
  for (const token of subtitleHints.tokens) {
    if (candidateHints.tokens.has(token)) {
      overlap += 1;
    }
  }

  score += Math.min(overlap, 12) * 3;
  if (preferredSubtitleUrl && preferredSubtitleUrl === track.url) {
    score += 120;
  }
  return score;
}
