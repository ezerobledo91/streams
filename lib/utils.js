const fs = require("fs");
const path = require("path");

function safeText(value) {
  return String(value || "").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compactText(value, max = 180) {
  return safeText(value).slice(0, max);
}

function ensureDirSync(targetDir) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    // no-op
  }
}

function safeRemoveDirSync(targetDir) {
  if (!safeText(targetDir)) return;
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch {
    // no-op
  }
}

function nowMs() {
  return Date.now();
}

function normalizeManifestUrl(value) {
  const raw = safeText(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!parsed.protocol.startsWith("http")) {
      return null;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function deriveBaseUrlFromManifestUrl(manifestUrl) {
  try {
    const parsed = new URL(manifestUrl);
    const cleanPath = parsed.pathname
      .replace(/\/manifest\.json$/i, "")
      .replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return null;
  }
}

function extractResolutionHintFromText(value) {
  const text = safeText(value).toLowerCase();
  if (!text) return 0;
  if (text.includes("2160") || text.includes("4k")) return 2160;
  if (text.includes("1440")) return 1440;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  if (text.includes("480")) return 480;
  return 0;
}

function normalizeInfoHash(value) {
  const clean = safeText(value).toLowerCase();
  if (/^[a-f0-9]{40}$/.test(clean)) {
    return clean;
  }
  return "";
}

function extractInfoHashFromText(value) {
  const match = safeText(value).match(/\b([a-f0-9]{40})\b/i);
  if (!match?.[1]) return "";
  return normalizeInfoHash(match[1]);
}

function normalizeProviderId(value) {
  const base = safeText(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return base.slice(0, 80) || "unknown";
}

function buildStreamSourceKey(value) {
  const directHash = normalizeInfoHash(value);
  if (directHash) return directHash;

  const text = safeText(value);
  if (!text) return "";
  const fromText = extractInfoHashFromText(text);
  if (fromText) return fromText;

  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      parsed.hash = "";
      return `url:${parsed.origin}${parsed.pathname}`;
    } catch {
      return "";
    }
  }

  return "";
}

function shouldUseHlsForFileName(fileName, hlsEnabled, hlsForce, nativeExtensions) {
  if (!hlsEnabled) return false;
  if (hlsForce) return true;
  const ext = path.extname(safeText(fileName)).toLowerCase();
  if (!ext) return true;
  return !nativeExtensions.has(ext);
}

module.exports = {
  safeText,
  clamp,
  compactText,
  ensureDirSync,
  safeRemoveDirSync,
  nowMs,
  normalizeManifestUrl,
  deriveBaseUrlFromManifestUrl,
  extractResolutionHintFromText,
  normalizeInfoHash,
  extractInfoHashFromText,
  normalizeProviderId,
  buildStreamSourceKey,
  shouldUseHlsForFileName
};
