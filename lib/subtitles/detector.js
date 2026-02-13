const path = require("path");
const { safeText } = require("../utils");
const { SUPPORTED_SUBTITLE_EXTENSIONS } = require("../config");

function detectSubtitleLanguage(fileName) {
  const text = safeText(fileName).toLowerCase();
  const candidates = [
    {
      code: "es",
      keys: [
        "spanish",
        "espanol",
        "español",
        "castellano",
        "latino",
        "latam",
        "subesp",
        "subs.es",
        "spa",
        ".es."
      ]
    },
    { code: "en", keys: ["english", "ingles", "inglés", "eng", ".en."] },
    { code: "pt", keys: ["portuguese", "portugues", "português", "por", "pt-br", ".pt."] },
    { code: "fr", keys: ["french", "fre", "fra", ".fr."] },
    { code: "it", keys: ["italian", "ita", ".it."] },
    { code: "de", keys: ["german", "ger", "deu", ".de."] }
  ];

  for (const candidate of candidates) {
    if (candidate.keys.some((key) => text.includes(key))) {
      return candidate.code;
    }
  }

  return "und";
}

function subtitleLabelForLanguage(lang) {
  if (lang === "es") return "Español";
  if (lang === "en") return "English";
  if (lang === "pt") return "Português";
  if (lang === "fr") return "Français";
  if (lang === "it") return "Italiano";
  if (lang === "de") return "Deutsch";
  return "Subtitulo";
}

function pickSubtitleFiles(torrent, videoFile) {
  const videoName = safeText(videoFile?.name).toLowerCase();
  const videoBase = videoName.replace(/\.[a-z0-9]{2,4}$/i, "");
  const videoTokens = videoBase
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 6);

  const subtitles = [];
  for (const file of torrent.files || []) {
    const name = safeText(file?.name);
    if (!name) continue;
    const extension = path.extname(name).toLowerCase();
    if (!SUPPORTED_SUBTITLE_EXTENSIONS.has(extension)) continue;
    if (Number(file.length || 0) > 5 * 1024 * 1024) continue;

    const lower = name.toLowerCase();
    const lang = detectSubtitleLanguage(name);
    const relevance = videoTokens.filter((token) => token.length >= 3 && lower.includes(token)).length;
    subtitles.push({
      id: `sub-${subtitles.length}`,
      file,
      extension,
      language: lang,
      label: `${subtitleLabelForLanguage(lang)} (${name.split(/[\\/]/).pop()})`,
      relevance
    });
  }

  subtitles.sort((a, b) => {
    if (a.language === "es" && b.language !== "es") return -1;
    if (b.language === "es" && a.language !== "es") return 1;
    if (a.relevance !== b.relevance) return b.relevance - a.relevance;
    return safeText(a.file?.name).localeCompare(safeText(b.file?.name));
  });

  return subtitles.slice(0, 10).map((item) => ({
    id: item.id,
    file: item.file,
    extension: item.extension,
    language: item.language,
    label: item.label
  }));
}

module.exports = {
  detectSubtitleLanguage,
  subtitleLabelForLanguage,
  pickSubtitleFiles
};
