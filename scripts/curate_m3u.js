#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const IPTV_ORG_CHANNELS_URL = "https://iptv-org.github.io/api/channels.json";
const ACCEPTED_EXTENSIONS = new Set([".m3u", ".m3u8", ".txt"]);
const ACCEPTED_PROTOCOLS = /^(https?|rtmp|rtsp|udp|mms):\/\//i;
const LOGO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const LATAM_COUNTRIES = new Set([
  "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT",
  "HN", "MX", "NI", "PA", "PY", "PE", "PR", "UY", "VE"
]);

const ARGENTINA_HINTS = [
  "argentina", "argentino", "buenos aires", "caba",
  "telefe", "eltrece", "el trece", "tv publica", "cronica", "a24", "c5n",
  "deportv", "tyc sports", "argentinisima",
  "canal 9 argentina", "canal 26 argentina"
];

const SPANISH_HINTS = [
  "espanol", "español", "spanish", "castellano", "latino", "latam",
  "audio es", "sub esp", "doblado"
];

const BLOCKED_HINTS = [
  "adult", "porno", "porn", "sex", "xxx", "hentai", "playboy", "naughty"
];

const DROP_PROVIDER_HINTS = [
  "pluto", "pluto tv", "plutotv"
];

const NON_CHANNEL_HINTS = [
  "episodio", "episodios", "capitulo", "capitulos", "temporada", "temporadas",
  "season", "episode", "chapter", "sketch", "sketches", "stand up", "stand-up",
  "formato corto", "formatos cortos", "especiales", "specials", "on demand", "vod",
  "maraton", "playlist", "peliculas gratis", "series gratis", "animaciones"
];

const MOVIE_CHANNEL_HINTS = [
  "hbo", "hbo 2", "hbo plus", "hbo family", "hbo signature", "hbo xtreme",
  "cinemax", "tnt", "tnt series", "tnt novelas", "space", "cinecanal", "cine cal",
  "warner", "axn", "fx", "fox movies", "studio universal", "amc",
  "paramount", "star channel", "golden", "golden edge"
];

const MOVIE_EXCLUDE_HINTS = [
  "sport", "sports", "deporte", "deportes", "noticia", "noticias", "news",
  "radio", "music", "musica", "kids", "infantil", "international"
];

const CATEGORY_RULES = [
  {
    id: "deportes",
    label: "Deportes",
    patterns: [
      "deporte", "sports", "sport", "espn", "fox sports", "tyc", "tnt sports",
      "futbol", "soccer", "nba", "nfl", "mlb", "motogp", "formula", "tenis", "golf"
    ]
  },
  {
    id: "noticias",
    label: "Noticias",
    patterns: [
      "noticias", "news", "informacion", "a24", "tn", "cronica", "cnn",
      "dw", "euronews", "france 24", "rt ", "tele sur", "nacion"
    ]
  },
  {
    id: "peliculas-series",
    label: "Peliculas y Series",
    patterns: [
      "movie", "movies", "pelicula", "peliculas", "cine", "cinema", "series", "hbo",
      "star channel", "axn", "warner", "paramount", "space", "fx", "cinecanal"
    ]
  },
  {
    id: "infantil",
    label: "Infantil",
    patterns: [
      "kids", "infantil", "cartoon", "disney", "nick", "nickelodeon",
      "discovery kids", "boomerang", "baby", "toon"
    ]
  },
  {
    id: "musica",
    label: "Musica",
    patterns: [
      "musica", "music", "mtv", "vh1", "hit", "radio", "concert", "cumbia", "rock"
    ]
  },
  {
    id: "documentales",
    label: "Documentales",
    patterns: [
      "documental", "documentary", "history", "nat geo", "national geographic",
      "discovery", "animal planet"
    ]
  },
  {
    id: "religion",
    label: "Religion",
    patterns: [
      "relig", "jesus", "crist", "catol", "evangel", "biblia", "god tv"
    ]
  }
];

function parseArgs(argv) {
  const options = {
    input: "C:\\Users\\ezerr\\OneDrive\\Escritorio\\Ezequiel\\apps\\listas m3u",
    output: "",
    fetchLogos: true,
    refreshLogoCache: false,
    probe: false,
    probeTimeoutMs: 3500,
    probeConcurrency: 12,
    probeLimit: 0,
    channelFilters: []
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      options.input = argv[++i];
      continue;
    }
    if (arg === "--output" && argv[i + 1]) {
      options.output = argv[++i];
      continue;
    }
    if (arg === "--no-logo-fetch") {
      options.fetchLogos = false;
      continue;
    }
    if (arg === "--refresh-logo-cache") {
      options.refreshLogoCache = true;
      continue;
    }
    if (arg === "--probe") {
      options.probe = true;
      continue;
    }
    if (arg === "--probe-timeout" && argv[i + 1]) {
      options.probeTimeoutMs = Number.parseInt(argv[++i], 10) || options.probeTimeoutMs;
      continue;
    }
    if (arg === "--probe-concurrency" && argv[i + 1]) {
      options.probeConcurrency = Number.parseInt(argv[++i], 10) || options.probeConcurrency;
      continue;
    }
    if (arg === "--probe-limit" && argv[i + 1]) {
      options.probeLimit = Number.parseInt(argv[++i], 10) || 0;
      continue;
    }
    if (arg === "--channel" && argv[i + 1]) {
      options.channelFilters.push(argv[++i]);
      continue;
    }
  }

  options.input = path.resolve(options.input);
  options.output = options.output
    ? path.resolve(options.output)
    : path.join(options.input, "_curated");
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextSmart(filePath) {
  const raw = fs.readFileSync(filePath);
  const utf8 = raw.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  const latin = raw.toString("latin1");
  const utf8Urls = (utf8.match(/https?:\/\//gi) || []).length;
  const latinUrls = (latin.match(/https?:\/\//gi) || []).length;
  return latinUrls >= utf8Urls ? latin : utf8;
}

function walkFiles(rootDir) {
  const out = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name.toLowerCase() === "_curated") continue;
        queue.push(fullPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ACCEPTED_EXTENSIONS.has(ext)) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text, phrase) {
  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  const pattern = `\\b${escapeRegex(normalizedPhrase).replace(/\s+/g, "\\s+")}\\b`;
  return new RegExp(pattern, "i").test(normalizedText);
}

function matchesAnyPhrase(text, phrases) {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

function buildEntrySearchText(entry) {
  return `${entry.name} ${entry.tvgName} ${entry.tvgId} ${entry.groupTitle} ${entry.url}`;
}

function normalizeName(value) {
  return normalizeText(value)
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d{3,4}p\b/g, " ")
    .replace(/\b(hd|fhd|uhd|sd|4k|live|en vivo|tv|canal|channel|opcion|option)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrl(value) {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw;
  }
}

function sanitizeDisplayName(name, fallback = "Canal sin nombre") {
  const cleaned = String(name || "")
    .replace(/(?:✅|✔️?|☑️|âœ…|âœ”|âœ”ï¸)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,\-:.\s]+|[,\-:.\s]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function countMojibakeMarkers(value) {
  return (String(value || "").match(/(?:Ã|Â|â|Ð|Ñ|�)/g) || []).length;
}

function maybeFixMojibake(value) {
  const text = String(value || "");
  if (!text) return "";
  if (!/(?:Ã|Â|â|Ð|Ñ|�)/.test(text)) return text;
  try {
    const converted = Buffer.from(text, "latin1").toString("utf8");
    return countMojibakeMarkers(converted) <= countMojibakeMarkers(text) ? converted : text;
  } catch {
    return text;
  }
}

function cleanChannelDecorations(value) {
  let out = String(value || "");
  out = maybeFixMojibake(out);
  out = out
    .replace(/(?:âœ…|âœ”ï¸?|â˜‘ï¸|Ã¢Å“â€¦|Ã¢Å“â€|Ã¢Å“â€Ã¯Â¸Â|✅|✔️|☑️)/g, " ")
    .replace(/\[[^\]]{1,16}\]/g, " ")
    .replace(/\s*\|\s*[A-Z]{2,4}\b/g, " ")
    .replace(/\s*\(\s*\d{3,4}p\s*\)/gi, " ")
    .replace(/\s*-\s*opci[oó]n\s*\d+\b/gi, " ")
    .replace(/[^\p{Script=Latin}\p{N}\s&+./:-]/gu, " ")
    .replace(/[“”"']/g, " ")
    .replace(/[_,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (out.length > 80 && out.includes(",")) {
    const head = out.split(",")[0].trim();
    if (head.length >= 3 && head.length <= 56) {
      out = head;
    }
  }

  return out;
}

function sanitizeDisplayName(name, fallback = "Canal sin nombre") {
  const cleaned = cleanChannelDecorations(name)
    .replace(/\s+/g, " ")
    .replace(/^[,\-:.\s]+|[,\-:.\s]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function parseExtinfLine(line) {
  const body = line.replace(/^#?EXTINF:/i, "").trim();
  const commaIndex = body.indexOf(",");
  const head = commaIndex >= 0 ? body.slice(0, commaIndex).trim() : body;
  let title = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : "";

  const attrs = {};
  const attrRegex = /([A-Za-z0-9_-]+)=("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRegex.exec(head)) !== null) {
    attrs[match[1].toLowerCase()] = (match[3] ?? match[4] ?? "").trim();
  }

  if (!title) {
    title = head
      .replace(/^-?\d+(\.\d+)?\s*/, "")
      .replace(/[A-Za-z0-9_-]+=("([^"]*)"|'([^']*)')/g, " ")
      .trim();
  }

  return {
    attrs,
    name: sanitizeDisplayName(title || attrs["tvg-name"] || attrs["tvg-id"] || "")
  };
}

function looksLikeUrl(line) {
  return ACCEPTED_PROTOCOLS.test(String(line || "").trim());
}

function parseInlineNameAndUrl(line) {
  const raw = String(line || "").trim();
  const urlMatch = raw.match(/(https?|rtmp|rtsp|udp|mms):\/\/\S+/i);
  if (!urlMatch) return null;

  const url = urlMatch[0].trim();
  const prefix = raw.slice(0, urlMatch.index).trim().replace(/[,;:\-]+$/g, "").trim();
  const name = sanitizeDisplayName(prefix || guessNameFromUrl(url));
  return { name, url };
}

function guessNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || parsed.hostname;
    return tail.replace(/\.(m3u8|mpd|ts|php|m3u)$/i, "").replace(/[-_.]+/g, " ");
  } catch {
    return "Canal";
  }
}

function normalizeCountry(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  const normalized = normalizeText(value);
  if (normalized.includes("argentina")) return "AR";
  if (normalized.includes("mexico")) return "MX";
  if (normalized.includes("chile")) return "CL";
  if (normalized.includes("colombia")) return "CO";
  if (normalized.includes("uruguay")) return "UY";
  if (normalized.includes("peru")) return "PE";
  if (normalized.includes("spain") || normalized.includes("espana") || normalized.includes("espana")) return "ES";
  return "";
}

function normalizeLanguage(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const normalized = normalizeText(value);
  if (normalized.includes("spanish") || normalized.includes("espanol") || normalized.includes("castellano")) return "es";
  if (normalized.includes("latino") || normalized.includes("latam")) return "es";
  if (normalized.includes("es 419") || normalized.includes("es  mx")) return "es";
  if (normalized.includes("english")) return "en";
  if (normalized.includes("portugu")) return "pt";
  if (/^es([-_][a-z0-9]+)?$/i.test(value)) return "es";
  if (/^[A-Za-z]{2,3}$/.test(value)) return value.toLowerCase().slice(0, 2);
  return "";
}

function buildText(entry) {
  return normalizeText(
    `${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId} ${entry.country} ${entry.language}`
  );
}

function isArgentinian(entry) {
  if (entry.country === "AR") return true;
  const text = buildText(entry);
  if (ARGENTINA_HINTS.some((hint) => containsPhrase(text, hint))) return true;

  const raw = `${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId} ${entry.url}`.toLowerCase();
  if (/\bargentina\b/.test(normalizeText(raw))) return true;
  if (/\.(ar)(\/|$|\s)/i.test(raw)) return true;
  return false;
}

function isSpanishLatam(entry) {
  if (entry.language === "es") return true;
  const text = buildText(entry);
  if (SPANISH_HINTS.some((hint) => containsPhrase(text, hint))) return true;
  if (entry.country && LATAM_COUNTRIES.has(entry.country)) {
    if (!entry.language) return true;
    if (entry.language === "es") return true;
    return false;
  }
  return false;
}

function isMetadataLikeName(value) {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized.startsWith("extinf")) return true;
  if (normalized.startsWith("extvlcopt")) return true;
  if (normalized.includes("tvg id") || normalized.includes("channel id")) return true;
  return false;
}

function isPlutoEntry(entry, text = "") {
  const normalized = text || normalizeText(`${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId} ${entry.url}`);
  return DROP_PROVIDER_HINTS.some((hint) => containsPhrase(normalized, hint));
}

function isLikelyNonChannelEntry(entry, text = "") {
  const normalized = text || normalizeText(`${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId}`);
  if (!normalized) return true;
  if (NON_CHANNEL_HINTS.some((hint) => containsPhrase(normalized, hint))) return true;

  const name = normalizeText(entry.name);
  if (name.length > 90) return true;
  if (name.split(" ").length > 12) return true;
  return false;
}

function isNoiseEntry(entry) {
  if (!looksLikeUrl(entry.url)) return true;
  const text = normalizeText(`${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId} ${entry.url}`);
  if (isPlutoEntry(entry, text)) return true;
  if (BLOCKED_HINTS.some((hint) => containsPhrase(text, hint))) return true;
  if (isLikelyNonChannelEntry(entry, text)) return true;
  if (isMetadataLikeName(entry.name) && isMetadataLikeName(entry.tvgName) && !entry.tvgId) return true;
  return false;
}

function isArgentinianStrict(entry) {
  if (entry.country === "AR") return true;
  const raw = `${entry.name} ${entry.groupTitle} ${entry.tvgName} ${entry.tvgId} ${entry.url}`.toLowerCase();
  if (/\.(ar)(\/|$|\s|@)/i.test(raw)) return true;
  if (containsPhrase(raw, "argentina")) return true;
  if (containsPhrase(raw, "argentino")) return true;
  return false;
}

function isCleanMovieChannel(entry) {
  const text = normalizeText(buildEntrySearchText(entry));
  const hasMovieBrand = MOVIE_CHANNEL_HINTS.some((hint) => text.includes(normalizeText(hint)));
  if (!hasMovieBrand) return false;

  if (text.includes("tnt sports")) return false;
  const hasAllowedTntVariant = text.includes("tnt series") || text.includes("tnt novelas");
  const hasBlockedToken = MOVIE_EXCLUDE_HINTS.some((hint) => text.includes(normalizeText(hint)));
  if (hasBlockedToken && !hasAllowedTntVariant) return false;
  return true;
}

function isMovieQuery(query) {
  const text = normalizeText(query);
  if (!text) return false;
  return matchesAnyPhrase(text, MOVIE_CHANNEL_HINTS);
}

function sanitizeFileName(value) {
  const cleaned = normalizeText(value).replace(/\s+/g, "-");
  return cleaned.replace(/[^a-z0-9-_]/g, "") || "canal";
}

function inferCategory(entry) {
  const text = buildText(entry);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => text.includes(normalizeText(pattern)))) {
      return rule.id;
    }
  }
  return "entretenimiento";
}

function categoryLabel(categoryId) {
  const found = CATEGORY_RULES.find((rule) => rule.id === categoryId);
  if (found) return found.label;
  if (categoryId === "entretenimiento") return "Entretenimiento";
  if (categoryId === "argentina") return "Argentina";
  return "Variado";
}

function parsePlaylistFile(filePath) {
  const content = readTextSmart(filePath).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = content.split("\n");
  const items = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#?EXTINF:/i.test(line)) {
      pending = parseExtinfLine(line);
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (looksLikeUrl(line)) {
      const attrs = pending?.attrs || {};
      const item = {
        sourceFile: filePath,
        name: sanitizeDisplayName(pending?.name || attrs["tvg-name"] || guessNameFromUrl(line)),
        url: line,
        tvgId: String(attrs["tvg-id"] || "").trim(),
        tvgName: sanitizeDisplayName(String(attrs["tvg-name"] || "").trim()),
        logo: String(attrs["tvg-logo"] || "").trim(),
        groupTitle: sanitizeDisplayName(String(attrs["group-title"] || "").trim(), ""),
        country: normalizeCountry(attrs["tvg-country"]),
        language: normalizeLanguage(attrs["tvg-language"])
      };
      items.push(item);
      pending = null;
      continue;
    }

    const inline = parseInlineNameAndUrl(line);
    if (inline) {
      items.push({
        sourceFile: filePath,
        name: sanitizeDisplayName(inline.name),
        url: inline.url,
        tvgId: "",
        tvgName: "",
        logo: "",
        groupTitle: "",
        country: "",
        language: ""
      });
      pending = null;
    }
  }

  return items;
}

function scoreEntry(entry) {
  let score = 0;
  if (entry.logo) score += 4;
  if (entry.url.startsWith("https://")) score += 3;
  if (/\.m3u8(\?|$)/i.test(entry.url)) score += 2;
  if (entry.language === "es") score += 3;
  if (isArgentinian(entry)) score += 4;
  if (entry.groupTitle) score += 1;
  return score;
}

function pickBest(a, b) {
  return scoreEntry(b) > scoreEntry(a) ? b : a;
}

function dedupeEntries(entries) {
  const byUrl = new Map();
  for (const entry of entries) {
    const key = canonicalizeUrl(entry.url).toLowerCase();
    if (!byUrl.has(key)) {
      byUrl.set(key, entry);
      continue;
    }
    byUrl.set(key, pickBest(byUrl.get(key), entry));
  }

  const byName = new Map();
  for (const entry of byUrl.values()) {
    const category = inferCategory(entry);
    entry.category = category;
    const key = `${normalizeName(entry.name)}|${category}`;
    if (!key.startsWith("|") && !byName.has(key)) {
      byName.set(key, entry);
      continue;
    }
    if (!key.startsWith("|")) {
      byName.set(key, pickBest(byName.get(key), entry));
      continue;
    }
    byName.set(`${entry.url}|${category}`, entry);
  }

  return [...byName.values()];
}

function toM3U(entries, title = "Curated IPTV") {
  const lines = [`#EXTM3U x-tvg-name="${title}"`];
  for (const entry of entries) {
    const attrs = [];
    if (entry.tvgId) attrs.push(`tvg-id="${escapeAttr(entry.tvgId)}"`);
    if (entry.tvgName || entry.name) attrs.push(`tvg-name="${escapeAttr(entry.tvgName || entry.name)}"`);
    if (entry.logo) attrs.push(`tvg-logo="${escapeAttr(entry.logo)}"`);
    if (entry.country) attrs.push(`tvg-country="${escapeAttr(entry.country)}"`);
    if (entry.language) attrs.push(`tvg-language="${escapeAttr(entry.language)}"`);
    attrs.push(`group-title="${escapeAttr(categoryLabel(entry.category || "entretenimiento"))}"`);
    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${entry.name}`);
    lines.push(entry.url);
  }
  return `${lines.join("\n")}\n`;
}

function escapeAttr(value) {
  return String(value || "").replace(/"/g, "'");
}

function buildIptvIndexes(channels) {
  const byId = new Map();
  const byName = new Map();
  const search = [];

  for (const channel of channels) {
    const id = String(channel.id || "").toLowerCase();
    if (id) byId.set(id, channel);

    const names = [channel.name, ...(Array.isArray(channel.alt_names) ? channel.alt_names : [])];
    for (const name of names) {
      const key = normalizeName(name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(channel);
      search.push({ key, channel });
    }
  }

  return { byId, byName, search };
}

function scoreIptvMatch(channel, entry, idMatch = false) {
  let score = idMatch ? 7 : 0;
  const channelCountry = normalizeCountry(channel.country || "");
  if (channelCountry && entry.country && channelCountry === entry.country) score += 3;
  if (channelCountry === "AR" && isArgentinian(entry)) score += 3;
  const langs = Array.isArray(channel.languages) ? channel.languages.map((l) => String(l).toLowerCase()) : [];
  if (langs.some((lang) => lang.startsWith("es") || lang === "spa")) score += 2;
  if (channel.logo) score += 2;
  return score;
}

function getIptvCandidates(indexes, nameKey) {
  if (!nameKey) return [];
  if (indexes.byName.has(nameKey)) return indexes.byName.get(nameKey);
  if (nameKey.length < 4) return [];

  const out = [];
  for (const item of indexes.search) {
    if (item.key === nameKey) {
      out.push(item.channel);
      continue;
    }
    if (item.key.startsWith(nameKey) || nameKey.startsWith(item.key)) {
      out.push(item.channel);
      continue;
    }
    if (item.key.includes(nameKey) || nameKey.includes(item.key)) {
      out.push(item.channel);
    }
  }
  return out;
}

function enrichWithIptvData(entries, indexes) {
  let logosApplied = 0;
  let countryApplied = 0;
  let languageApplied = 0;
  let categoryApplied = 0;

  for (const entry of entries) {
    const candidates = [];
    const tvgId = String(entry.tvgId || "").toLowerCase();
    if (tvgId && indexes.byId.has(tvgId)) {
      candidates.push({ channel: indexes.byId.get(tvgId), idMatch: true });
    }

    const keys = [normalizeName(entry.name), normalizeName(entry.tvgName)];
    for (const key of keys) {
      if (!key) continue;
      for (const channel of getIptvCandidates(indexes, key)) {
        candidates.push({ channel, idMatch: false });
      }
    }

    if (!candidates.length) continue;

    const deduped = new Map();
    for (const candidate of candidates) {
      const id = String(candidate.channel.id || candidate.channel.name || Math.random());
      if (!deduped.has(id)) deduped.set(id, candidate);
    }

    const sorted = [...deduped.values()].sort((a, b) => {
      const scoreA = scoreIptvMatch(a.channel, entry, a.idMatch);
      const scoreB = scoreIptvMatch(b.channel, entry, b.idMatch);
      return scoreB - scoreA;
    });
    const bestCandidate = sorted[0];
    const best = bestCandidate?.channel;
    if (!best) continue;
    const bestScore = scoreIptvMatch(best, entry, bestCandidate.idMatch);
    const minScore = bestCandidate.idMatch ? 7 : 5;
    if (bestScore < minScore) continue;

    if (!entry.logo && best.logo) {
      entry.logo = String(best.logo);
      logosApplied += 1;
    }
    if (!entry.country && best.country) {
      const normalized = normalizeCountry(best.country);
      if (normalized) {
        entry.country = normalized;
        countryApplied += 1;
      }
    }
    if (!entry.language && Array.isArray(best.languages) && best.languages.length) {
      const normalized = normalizeLanguage(best.languages.join(","));
      if (normalized) {
        entry.language = normalized;
        languageApplied += 1;
      }
    }
    if ((!entry.groupTitle || entry.groupTitle === "Generic") && Array.isArray(best.categories) && best.categories.length) {
      const fromIptv = inferCategory({
        ...entry,
        groupTitle: best.categories.join(" ")
      });
      entry.category = fromIptv;
      categoryApplied += 1;
    }
  }

  return { logosApplied, countryApplied, languageApplied, categoryApplied };
}

async function loadIptvChannels(cacheFile, refresh = false) {
  if (!refresh && fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    const age = Date.now() - stat.mtimeMs;
    if (age < LOGO_CACHE_TTL_MS) {
      const text = fs.readFileSync(cacheFile, "utf8");
      return JSON.parse(text);
    }
  }

  const response = await fetch(IPTV_ORG_CHANNELS_URL, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`No se pudo descargar canales de iptv-org: HTTP ${response.status}`);
  }
  const payload = await response.json();
  fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf8");
  return payload;
}

async function probeEntries(entries, options) {
  const targets = options.probeLimit > 0 ? entries.slice(0, options.probeLimit) : entries;
  const valid = [];
  const invalidEntries = [];
  let invalid = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor++;
      const entry = targets[index];
      const ok = await probeUrl(entry.url, options.probeTimeoutMs);
      if (ok) {
        valid.push(entry);
      } else {
        invalid += 1;
        invalidEntries.push(entry);
      }
    }
  }

  const workers = [];
  const amount = Math.max(1, options.probeConcurrency);
  for (let i = 0; i < amount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (options.probeLimit > 0 && options.probeLimit < entries.length) {
    valid.push(...entries.slice(options.probeLimit));
  }

  return { valid, invalid, invalidEntries };
}

async function probeUrl(url, timeoutMs) {
  if (!/^https?:\/\//i.test(url)) return true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        range: "bytes=0-1",
        "user-agent": "m3u-curator/1.0"
      },
      signal: controller.signal
    });
    if (response.status >= 200 && response.status < 400) return true;
    if ([401, 403, 405].includes(response.status)) return true;
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function splitOutputs(entries, fallbackEntries, options) {
  const sorted = [...entries].sort((a, b) => {
    const categoryDiff = (a.category || "").localeCompare(b.category || "");
    if (categoryDiff !== 0) return categoryDiff;
    return a.name.localeCompare(b.name);
  });

  const byCategory = new Map();
  for (const entry of sorted) {
    const category = entry.category || "entretenimiento";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(entry);
  }

  const argentinaOnly = sorted.filter((entry) => isArgentinianStrict(entry));
  const moviePool = [
    ...sorted.filter((entry) => isCleanMovieChannel(entry)),
    ...fallbackEntries.filter((entry) => isCleanMovieChannel(entry))
  ];
  const cleanMovies = dedupeEntries(moviePool);

  const byRequestedChannel = new Map();
  for (const rawFilter of options.channelFilters || []) {
    const filter = String(rawFilter || "").trim();
    if (!filter) continue;
    const baseMatches = sorted.filter((entry) => containsPhrase(buildEntrySearchText(entry), filter));
    const fallbackMatches = fallbackEntries.filter((entry) => containsPhrase(buildEntrySearchText(entry), filter));
    let matches = dedupeEntries([...baseMatches, ...fallbackMatches]);
    if (isMovieQuery(filter)) {
      matches = matches.filter((entry) => isCleanMovieChannel(entry));
    }
    byRequestedChannel.set(filter, matches);
  }

  return { sorted, byCategory, argentinaOnly, cleanMovies, byRequestedChannel };
}

function writeProbeDiscarded(outputDir, entries) {
  if (!Array.isArray(entries) || !entries.length) return [];

  const files = [];
  const txtPath = path.join(outputDir, "descartados_probe.txt");
  const txtLines = entries.map((entry) => `${entry.name} | ${entry.url}`);
  fs.writeFileSync(txtPath, `${txtLines.join("\n")}\n`, "utf8");
  files.push(txtPath);

  const m3uPath = path.join(outputDir, "descartados_probe.m3u");
  fs.writeFileSync(m3uPath, toM3U(entries, "Descartados por Probe"), "utf8");
  files.push(m3uPath);

  return files;
}

function writeOutputs(outputDir, data) {
  ensureDir(outputDir);
  const oldFiles = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        /\.m3u$/i.test(name) ||
        /^canal_/i.test(name) ||
        /^descartados_probe\.(txt|m3u)$/i.test(name) ||
        /^reporte\.json$/i.test(name)
    );
  for (const name of oldFiles) {
    try {
      fs.unlinkSync(path.join(outputDir, name));
    } catch {
      // no-op
    }
  }

  const files = [];

  const masterPath = path.join(outputDir, "master_latam_es.m3u");
  fs.writeFileSync(masterPath, toM3U(data.sorted, "Master LATAM ES"), "utf8");
  files.push(masterPath);

  const argPath = path.join(outputDir, "argentina.m3u");
  fs.writeFileSync(argPath, toM3U(data.argentinaOnly, "Canales Argentina"), "utf8");
  files.push(argPath);

  const moviesCleanPath = path.join(outputDir, "peliculas_limpio.m3u");
  fs.writeFileSync(moviesCleanPath, toM3U(data.cleanMovies, "Canales Peliculas Limpio"), "utf8");
  files.push(moviesCleanPath);

  for (const [category, entries] of data.byCategory.entries()) {
    if (!entries.length) continue;
    const fileName = `${category}.m3u`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, toM3U(entries, categoryLabel(category)), "utf8");
    files.push(filePath);
  }

  for (const [channelQuery, entries] of data.byRequestedChannel.entries()) {
    const fileName = `canal_${sanitizeFileName(channelQuery)}.m3u`;
    const filePath = path.join(outputDir, fileName);
    const title = `Busqueda Canal: ${channelQuery}`;
    fs.writeFileSync(filePath, toM3U(entries, title), "utf8");
    files.push(filePath);
  }

  return files;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!fs.existsSync(options.input)) {
    throw new Error(`No existe la carpeta de entrada: ${options.input}`);
  }

  const outputDir = options.output;
  ensureDir(outputDir);
  const cacheDir = path.join(outputDir, ".cache");
  ensureDir(cacheDir);
  const logoCacheFile = path.join(cacheDir, "iptv-org-channels.json");

  const files = walkFiles(options.input);
  const parsed = [];
  for (const filePath of files) {
    const items = parsePlaylistFile(filePath);
    parsed.push(...items);
  }

  const parseCount = parsed.length;
  const cleaned = parsed.filter((entry) => !isNoiseEntry(entry));
  const cleanedPlayable = cleaned.filter((entry) => looksLikeUrl(entry.url));
  const relevant = cleaned.filter((entry) => {
    return isArgentinian(entry) || isSpanishLatam(entry);
  });

  const deduped = dedupeEntries(relevant);
  const fallbackDeduped = dedupeEntries(cleanedPlayable);
  const stats = {
    sourceFiles: files.length,
    parsedEntries: parseCount,
    relevantEntries: relevant.length,
    dedupedEntries: deduped.length,
    duplicatesRemoved: Math.max(0, relevant.length - deduped.length),
    logosApplied: 0,
    countryApplied: 0,
    languageApplied: 0,
    categoryApplied: 0,
    probedInvalid: 0
  };

  let curated = deduped;
  let probeInvalidEntries = [];

  if (options.fetchLogos) {
    const channels = await loadIptvChannels(logoCacheFile, options.refreshLogoCache);
    const indexes = buildIptvIndexes(Array.isArray(channels) ? channels : []);
    const enrichStats = enrichWithIptvData(curated, indexes);
    stats.logosApplied = enrichStats.logosApplied;
    stats.countryApplied = enrichStats.countryApplied;
    stats.languageApplied = enrichStats.languageApplied;
    stats.categoryApplied = enrichStats.categoryApplied;
  }

  if (options.probe) {
    const probeResult = await probeEntries(curated, options);
    curated = probeResult.valid;
    stats.probedInvalid = probeResult.invalid;
    probeInvalidEntries = probeResult.invalidEntries;
  }

  const outputs = splitOutputs(curated, fallbackDeduped, options);
  const writtenFiles = writeOutputs(outputDir, outputs);
  const probeDiscardedFiles = options.probe ? writeProbeDiscarded(outputDir, probeInvalidEntries) : [];
  writtenFiles.push(...probeDiscardedFiles);

  const report = {
    input: options.input,
    output: outputDir,
    generatedAt: new Date().toISOString(),
    stats,
    generatedLists: {
      cleanMovies: outputs.cleanMovies.length,
      argentina: outputs.argentinaOnly.length,
      requestedChannels: [...outputs.byRequestedChannel.entries()].map(([query, entries]) => ({
        query,
        count: entries.length
      })),
      probeDiscarded: probeInvalidEntries.length
    },
    files: writtenFiles
  };
  fs.writeFileSync(path.join(outputDir, "reporte.json"), JSON.stringify(report, null, 2), "utf8");

  console.log("Curado completado.");
  console.log(`Entrada: ${options.input}`);
  console.log(`Salida: ${outputDir}`);
  console.log(`Archivos procesados: ${stats.sourceFiles}`);
  console.log(`Entradas parseadas: ${stats.parsedEntries}`);
  console.log(`Entradas relevantes ES/AR: ${stats.relevantEntries}`);
  console.log(`Deduplicadas: ${stats.dedupedEntries} (quitadas ${stats.duplicatesRemoved})`);
  console.log(`Logos aplicados: ${stats.logosApplied}`);
  console.log(`Peliculas limpio: ${outputs.cleanMovies.length}`);
  if (outputs.byRequestedChannel.size) {
    for (const [query, entries] of outputs.byRequestedChannel.entries()) {
      console.log(`Canal "${query}": ${entries.length}`);
    }
  }
  if (options.probe) {
    console.log(`Links no validos por probe: ${stats.probedInvalid}`);
  }
  console.log(`Archivos generados: ${writtenFiles.length + 1} (incluye reporte.json)`);
}

main().catch((error) => {
  console.error("Error:", error?.message || error);
  process.exitCode = 1;
});
