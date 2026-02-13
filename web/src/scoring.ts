import type { StreamCandidate, StreamItem } from "./types";

function parseInteger(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseNumberFromText(text: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return parseInteger(match[1]);
    }
  }
  return 0;
}

function extractSeeders(stream: StreamItem): number {
  const direct = parseInteger(
    stream.seeders || stream.seeds || stream.behaviorHints?.seeders || stream.behaviorHints?.seeds || 0
  );
  if (direct > 0) return direct;
  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [
    /seeders?\D+(\d+)/i,
    /seeds?\D+(\d+)/i,
    /(\d+)\s*seeders?/i,
    /(\d+)\s*seeds?/i,
    /semillas?\D+(\d+)/i,
    /(?:\u{1F464}|\u{1F465})\s*(\d+)/u,
    /\bs[:=]\s*(\d+)\b/i
  ]);
}

function extractPeers(stream: StreamItem): number {
  const direct = parseInteger(stream.peers || stream.behaviorHints?.peers || 0);
  if (direct > 0) return direct;
  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  return parseNumberFromText(text, [/peers?\D+(\d+)/i, /(\d+)\s*peers?/i, /leechers?\D+(\d+)/i]);
}

function extractResolution(stream: StreamItem): number {
  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return 2160;
  if (text.includes("1440")) return 1440;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  if (text.includes("480")) return 480;
  return 0;
}

function extractVideoSizeBytes(stream: StreamItem): number {
  const fromHint = Number(stream.behaviorHints?.videoSize || 0);
  if (Number.isFinite(fromHint) && fromHint > 0) return fromHint;

  const text = [stream.title, stream.name, stream.description].filter(Boolean).join(" ");
  const match = text.match(/(?:\u{1F4BE}\s*)?(\d+(?:[.,]\d+)?)\s*(gb|mb|tb)/iu);
  if (!match) return 0;

  const raw = Number(match[1].replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const unit = match[2].toLowerCase();
  if (unit === "mb") return raw * 1024 * 1024;
  if (unit === "gb") return raw * 1024 * 1024 * 1024;
  if (unit === "tb") return raw * 1024 * 1024 * 1024 * 1024;
  return 0;
}

export function getTrackers(stream: StreamItem): string[] {
  const trackers: string[] = [];
  if (Array.isArray(stream.sources)) {
    for (const source of stream.sources) {
      if (source?.startsWith("tracker:")) {
        trackers.push(source.slice("tracker:".length));
      }
    }
  }
  return [...new Set(trackers)];
}

function getFileExtension(stream: StreamItem): string {
  const fromFilename = String(stream.behaviorHints?.filename || "").trim().toLowerCase();
  const fromTitle = String(stream.title || stream.name || "").trim().toLowerCase();
  let source = fromFilename || fromTitle;
  if (!source && typeof stream.url === "string" && /^https?:\/\//i.test(stream.url)) {
    try {
      source = new URL(stream.url).pathname.toLowerCase();
    } catch {
      source = "";
    }
  }
  const match = source.match(/\.([a-z0-9]{2,4})(?:\s|$)/i);
  if (!match?.[1]) return "unknown";
  return match[1].toLowerCase();
}

function isWebFriendlyExtension(ext: string): boolean {
  return ext === "mp4" || ext === "webm" || ext === "m4v";
}

function getProviderScoreBonus(providerId: string): number {
  const id = String(providerId || "").toLowerCase();
  if (id === "prowlarr") return 8;
  return 0;
}

function buildMagnet(stream: StreamItem, displayName: string): string | null {
  if (typeof stream.url === "string" && stream.url.startsWith("magnet:")) {
    return stream.url;
  }

  if (Array.isArray(stream.sources)) {
    const sourceMagnet = stream.sources.find((value) => typeof value === "string" && value.startsWith("magnet:"));
    if (sourceMagnet) return sourceMagnet;
  }

  const infoHash = String(stream.infoHash || "").trim();
  if (!infoHash) return null;

  const params: string[] = [`xt=urn:btih:${infoHash}`];
  if (displayName) {
    params.push(`dn=${encodeURIComponent(displayName)}`);
  }
  for (const tracker of getTrackers(stream)) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }
  return `magnet:?${params.join("&")}`;
}

function getDirectUrl(stream: StreamItem): string | null {
  if (typeof stream.url !== "string") return null;
  const value = stream.url.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return null;
}

function isLikelyUnavailableStream(stream: StreamItem): boolean {
  const text = [stream.name, stream.title, stream.description].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return (
    text.includes("non-debrid") ||
    text.includes("disabled") ||
    text.includes("not available") ||
    text.includes("premium required") ||
    text.includes("[\u26d4")
  );
}

function calculateScore(stream: StreamItem, providerId: string) {
  const seeders = extractSeeders(stream);
  const peers = extractPeers(stream);
  const resolution = extractResolution(stream);
  const videoSizeBytes = extractVideoSizeBytes(stream);
  const sizeGb = videoSizeBytes > 0 ? videoSizeBytes / (1024 * 1024 * 1024) : 0;
  const trackers = getTrackers(stream).length;
  const hasTorrent = Boolean(stream.infoHash || String(stream.url || "").startsWith("magnet:"));
  const fileExtension = getFileExtension(stream);
  const webFriendly = isWebFriendlyExtension(fileExtension);
  const likelyIncompatible = fileExtension === "mkv" || fileExtension === "avi";
  const providerBonus = getProviderScoreBonus(providerId);
  const reliabilityPenalty = Number(stream.behaviorHints?.reliabilityPenalty || 0);

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
    formatBonus -
    sizeGb * 1.4 -
    reliabilityPenalty -
    incompatiblePenalty -
    largeFilePenalty;
  return {
    score,
    seeders,
    peers,
    resolution,
    videoSizeBytes,
    fileExtension,
    webFriendly,
    likelyIncompatible
  };
}

export function toCandidate(
  stream: StreamItem,
  provider: { id: string; name: string; baseUrl: string },
  index: number
): StreamCandidate | null {
  const displayName = stream.title || stream.name || `Stream ${index + 1}`;
  const magnet = buildMagnet(stream, displayName);
  const directUrl = getDirectUrl(stream);
  if (!magnet && directUrl && isLikelyUnavailableStream(stream)) return null;
  if (!magnet && !directUrl) return null;

  const metrics = calculateScore(stream, provider.id);
  const fileIdx = Number.isFinite(Number(stream.fileIdx)) ? Number(stream.fileIdx) : null;

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerBaseUrl: provider.baseUrl,
    displayName,
    magnet,
    directUrl,
    stream,
    fileIdx,
    ...metrics
  };
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "N/D";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(2)} ${units[idx]}`;
}

export function formatSpeed(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(1)} ${units[idx]}`;
}
