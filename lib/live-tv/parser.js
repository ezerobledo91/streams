const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { safeText } = require("../utils");

function readTextSmart(filePath) {
  const raw = fs.readFileSync(filePath);
  const utf8 = raw.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  const latin = raw.toString("latin1");
  const utf8Urls = (utf8.match(/https?:\/\//gi) || []).length;
  const latinUrls = (latin.match(/https?:\/\//gi) || []).length;
  return latinUrls >= utf8Urls ? latin : utf8;
}

function normalizeLooseText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLiveCategoryId(rawValue, fileBaseName = "") {
  const normalized = normalizeLooseText(rawValue || fileBaseName);
  if (!normalized) return "variado";
  if (normalized.includes("deporte") || normalized.includes("sport")) return "deportes";
  if (normalized.includes("noticia") || normalized.includes("news")) return "noticias";
  if (normalized.includes("pelicula") || normalized.includes("movie") || normalized.includes("cine")) {
    return "peliculas-series";
  }
  if (normalized.includes("serie")) return "peliculas-series";
  if (normalized.includes("infantil") || normalized.includes("kids") || normalized.includes("cartoon")) {
    return "infantil";
  }
  if (normalized.includes("musica") || normalized.includes("music") || normalized.includes("radio")) {
    return "musica";
  }
  if (normalized.includes("documental")) return "documentales";
  if (normalized.includes("relig")) return "religion";
  if (normalized.includes("argentina")) return "argentina";
  const fallback = normalized.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return fallback || "variado";
}

function categoryLabelFromId(id) {
  const mapping = {
    deportes: "Deportes",
    noticias: "Noticias",
    "peliculas-series": "Peliculas y Series",
    infantil: "Infantil",
    musica: "Musica",
    documentales: "Documentales",
    religion: "Religion",
    entretenimiento: "Entretenimiento",
    argentina: "Argentina",
    variado: "Variado"
  };
  if (mapping[id]) return mapping[id];
  return String(id || "Variado")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function parseExtinfHead(head) {
  const attrs = {};
  const attrRegex = /([A-Za-z0-9_-]+)=("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRegex.exec(head)) !== null) {
    attrs[String(match[1] || "").toLowerCase()] = String(match[3] ?? match[4] ?? "").trim();
  }
  return attrs;
}

function parseM3uExtinf(line) {
  const body = String(line || "").replace(/^#EXTINF:/i, "").trim();
  const commaIndex = body.indexOf(",");
  const head = commaIndex >= 0 ? body.slice(0, commaIndex).trim() : body;
  let title = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : "";
  const attrs = parseExtinfHead(head);

  if (!title) {
    title = head
      .replace(/^-?\d+(\.\d+)?\s*/, "")
      .replace(/[A-Za-z0-9_-]+=("([^"]*)"|'([^']*)')/g, " ")
      .trim();
  }

  return { attrs, title: safeText(title) };
}

function looksLikeStreamUrl(value) {
  return /^(https?|rtmp|rtsp|udp|mms):\/\//i.test(String(value || "").trim());
}

function canonicalizeHttpUrl(value) {
  const raw = safeText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw;
  }
}

function scoreLiveChannel(channel) {
  let score = 0;
  if (channel.logo) score += 2;
  if (channel.webPlayable) score += 2;
  if (/^https:\/\//i.test(channel.streamUrl)) score += 1;
  if (channel.language) score += 1;
  if (channel.country) score += 1;
  return score;
}

function makeLiveChannelId(channel) {
  return crypto
    .createHash("sha1")
    .update(`${safeText(channel.name)}|${safeText(channel.streamUrl)}`)
    .digest("hex")
    .slice(0, 18);
}

function normalizeLiveChannel(raw, fileBaseName, sourceFileName = `${fileBaseName}.m3u`) {
  const name = safeText(raw.name || raw.tvgName || raw.tvgId) || "Canal";
  const categoryId = normalizeLiveCategoryId(raw.groupTitle, fileBaseName);
  const categoryName = categoryLabelFromId(categoryId);
  const streamUrl = safeText(raw.streamUrl);

  const channel = {
    id: "",
    name,
    logo: safeText(raw.logo) || null,
    streamUrl,
    webPlayable: /^https?:\/\//i.test(streamUrl),
    category: {
      id: categoryId,
      name: categoryName
    },
    groupTitle: safeText(raw.groupTitle) || null,
    tvgName: safeText(raw.tvgName) || null,
    tvgId: safeText(raw.tvgId) || null,
    language: safeText(raw.language).toLowerCase() || null,
    country: safeText(raw.country).toUpperCase() || null,
    sourceFile: sourceFileName,
    searchText: normalizeLooseText(
      `${name} ${raw.groupTitle} ${raw.tvgName} ${raw.tvgId} ${raw.language} ${raw.country} ${categoryName}`
    )
  };

  channel.id = makeLiveChannelId(channel);
  return channel;
}

function parseLiveTvPlaylist(filePath) {
  const content = readTextSmart(filePath).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const sourceFileName = path.basename(filePath);
  const lines = content.split("\n");
  const channels = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      pending = parseM3uExtinf(line);
      continue;
    }

    if (line.startsWith("#")) continue;
    if (!looksLikeStreamUrl(line)) continue;

    const attrs = pending?.attrs || {};
    const channel = normalizeLiveChannel(
      {
        name: pending?.title || attrs["tvg-name"] || attrs["tvg-id"] || "Canal",
        streamUrl: line,
        groupTitle: attrs["group-title"],
        tvgName: attrs["tvg-name"],
        tvgId: attrs["tvg-id"],
        logo: attrs["tvg-logo"],
        language: attrs["tvg-language"],
        country: attrs["tvg-country"]
      },
      fileBaseName,
      sourceFileName
    );

    channels.push(channel);
    pending = null;
  }

  return channels;
}

module.exports = {
  normalizeLooseText,
  normalizeLiveCategoryId,
  categoryLabelFromId,
  parseM3uExtinf,
  canonicalizeHttpUrl,
  scoreLiveChannel,
  makeLiveChannelId,
  parseLiveTvPlaylist
};
