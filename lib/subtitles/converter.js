async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toWebVtt(rawText) {
  const body = String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r+/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  if (body.startsWith("WEBVTT")) return body;
  return `WEBVTT\n\n${body}`;
}

function normalizeSubtitleExtension(value) {
  const { safeText } = require("../utils");
  const ext = safeText(value).toLowerCase();
  if (!ext) return ".vtt";
  if (ext.startsWith(".")) return ext;
  return `.${ext}`;
}

function sanitizeSubtitleProxyExtension(value, fallback = ".srt") {
  const normalized = normalizeSubtitleExtension(value);
  const allowed = new Set([".srt", ".vtt", ".zip", ".rar", ".7z"]);
  if (allowed.has(normalized)) return normalized;
  return normalizeSubtitleExtension(fallback);
}

module.exports = {
  streamToBuffer,
  toWebVtt,
  normalizeSubtitleExtension,
  sanitizeSubtitleProxyExtension
};
