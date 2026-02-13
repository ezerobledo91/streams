import type { StreamCandidate } from "../types";
import { isSpanishLanguage } from "./audio-preferences";
import { extractReleaseHints, normalizeReleaseText } from "./release-hints";
import { scoreSubtitleTrackMatch } from "./subtitle-scoring";
import type { UiSubtitleTrack } from "./subtitle-tracks";

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateSubtitleCoverageScore(
  candidate: StreamCandidate,
  subtitlePool: UiSubtitleTrack[],
  expectedEpisodeKey: string,
  preferredSubtitleUrl: string
): number {
  const spanishTracks = subtitlePool.filter((item) => isSpanishLanguage(item.language));
  if (!spanishTracks.length) {
    return -10;
  }

  let best = -80;
  const sample = spanishTracks.slice(0, 30);
  for (const track of sample) {
    const match = scoreSubtitleTrackMatch(track, candidate, "", preferredSubtitleUrl, expectedEpisodeKey);
    if (match > best) {
      best = match;
    }
  }

  if (best < -35) return -22;
  return clampNumber(best, -18, 130);
}

export function estimateAutoPlaybackScore(
  candidate: StreamCandidate,
  subtitlePool: UiSubtitleTrack[],
  expectedEpisodeKey: string,
  preferredSubtitleUrl: string
): number {
  const sizeGb = candidate.videoSizeBytes > 0 ? candidate.videoSizeBytes / (1024 * 1024 * 1024) : 0;
  const reliabilityPenalty = Number(candidate.stream.behaviorHints?.reliabilityPenalty || 0);

  let score = Number(candidate.score || 0) * 0.72;

  if (candidate.webFriendly) score += 24;
  else if (candidate.magnet) score += 12;
  else score -= 18;

  if (candidate.likelyIncompatible) score -= 58;
  if (candidate.seeders <= 0 && candidate.peers <= 0) score -= 14;

  score += Math.min(candidate.seeders, 120) * 0.95;
  score += Math.min(candidate.peers, 240) * 0.22;

  if (candidate.resolution >= 2160) score += 20;
  else if (candidate.resolution >= 1080) score += 15;
  else if (candidate.resolution >= 720) score += 9;
  else if (candidate.resolution > 0) score += 3;

  if (sizeGb > 0) {
    const targetGb =
      candidate.resolution >= 2160
        ? 24
        : candidate.resolution >= 1080
          ? 8
          : candidate.resolution >= 720
            ? 4
            : 2.4;
    const distance = Math.abs(sizeGb - targetGb);
    score -= clampNumber(distance * 1.8, 0, 16);
    if (sizeGb > 20 && candidate.resolution <= 1080) {
      score -= 10;
    }
  }

  score -= clampNumber(reliabilityPenalty, 0, 100) * 1.4;
  if (!candidate.webFriendly && candidate.videoSizeBytes > 12 * 1024 * 1024 * 1024) {
    score -= 18;
  }

  score += estimateSubtitleCoverageScore(candidate, subtitlePool, expectedEpisodeKey, preferredSubtitleUrl) * 0.34;
  return score;
}

function extractMagnetInfoHash(value: string | null): string {
  const match = String(value || "").match(/xt=urn:btih:([a-z0-9]+)/i);
  if (!match?.[1]) return "";
  return match[1].toLowerCase();
}

export function buildActiveStreamKey(candidate: StreamCandidate | null): string {
  if (!candidate) return "";
  const filePart = Number.isInteger(candidate.fileIdx) ? `|f${candidate.fileIdx}` : "";
  const hash =
    String(candidate.stream.behaviorHints?.reliabilitySourceKey || "").trim().toLowerCase() ||
    String(candidate.stream.infoHash || "").trim().toLowerCase() ||
    extractMagnetInfoHash(candidate.magnet) ||
    String(candidate.directUrl || "").trim().toLowerCase();
  if (hash) return `${hash}${filePart}`;
  return `${normalizeReleaseText(candidate.displayName).slice(0, 140)}${filePart}`;
}

export function candidateIdentityKey(candidate: StreamCandidate): string {
  const infoHash = String(candidate.stream.infoHash || "").trim().toLowerCase() || extractMagnetInfoHash(candidate.magnet);
  const filePart = Number.isInteger(candidate.fileIdx) ? `|f${candidate.fileIdx}` : "";
  if (infoHash) return `hash:${infoHash}${filePart}`;
  if (candidate.directUrl) return `url:${candidate.directUrl.toLowerCase()}`;
  return `name:${normalizeReleaseText(candidate.displayName)}|${candidate.resolution}|${Math.round(candidate.videoSizeBytes / (1024 * 1024))}${filePart}`;
}

export function isCandidateBrowserCompatible(candidate: StreamCandidate): boolean {
  if (candidate.directUrl && !candidate.magnet) {
    if (!candidate.webFriendly) return false;
    return true;
  }
  if (candidate.magnet) {
    return candidate.videoSizeBytes <= 30 * 1024 * 1024 * 1024;
  }
  return false;
}

function pickBestCandidate(current: StreamCandidate, incoming: StreamCandidate): StreamCandidate {
  if (incoming.score !== current.score) {
    return incoming.score > current.score ? incoming : current;
  }
  if (incoming.seeders !== current.seeders) {
    return incoming.seeders > current.seeders ? incoming : current;
  }
  if (incoming.resolution !== current.resolution) {
    return incoming.resolution > current.resolution ? incoming : current;
  }
  if (incoming.webFriendly !== current.webFriendly) {
    return incoming.webFriendly ? incoming : current;
  }
  return incoming.videoSizeBytes > current.videoSizeBytes ? incoming : current;
}

export function dedupeCandidates(items: StreamCandidate[]): StreamCandidate[] {
  const byKey = new Map<string, StreamCandidate>();
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

export function diversifyByProvider(items: StreamCandidate[]): StreamCandidate[] {
  if (items.length <= 4) return items;

  const buckets = new Map<string, StreamCandidate[]>();
  for (const candidate of items) {
    const providerId = candidate.providerId || "unknown";
    if (!buckets.has(providerId)) {
      buckets.set(providerId, []);
    }
    buckets.get(providerId)?.push(candidate);
  }

  const providerOrder = [...buckets.entries()]
    .sort((a, b) => (b[1][0]?.score || 0) - (a[1][0]?.score || 0))
    .map(([providerId]) => providerId);
  const out: StreamCandidate[] = [];
  while (out.length < items.length) {
    let added = false;
    for (const providerId of providerOrder) {
      const queue = buckets.get(providerId);
      if (!queue?.length) continue;
      out.push(queue.shift() as StreamCandidate);
      added = true;
    }
    if (!added) break;
  }
  return out;
}

export function getSeriesEpisodeMatchBucket(candidate: StreamCandidate, expectedEpisodeKey: string): number {
  if (!expectedEpisodeKey) return 1;
  const text = `${candidate.displayName} ${candidate.stream.title || ""} ${candidate.stream.description || ""} ${candidate.stream.behaviorHints?.filename || ""}`;
  const hints = extractReleaseHints(text);
  if (!hints.episodeKey) return 1;
  return hints.episodeKey === expectedEpisodeKey ? 0 : 2;
}

export function filterSeriesCandidatesByEpisode(
  items: StreamCandidate[],
  isSeries: boolean,
  season: number,
  episode: number
): StreamCandidate[] {
  if (!isSeries) return items;
  const expectedEpisodeKey = `${season}x${episode}`;

  const exact: StreamCandidate[] = [];
  const unknown: StreamCandidate[] = [];
  for (const candidate of items) {
    const bucket = getSeriesEpisodeMatchBucket(candidate, expectedEpisodeKey);
    if (bucket === 0) {
      exact.push(candidate);
      continue;
    }
    if (bucket === 1) {
      unknown.push(candidate);
    }
  }

  if (exact.length) {
    return [...exact, ...unknown];
  }
  return unknown;
}
