const { safeText } = require("../utils");

function normalizeGroupTitle(value) {
  return safeText(value)
    .replace(/\u00A0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015_]+/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/^[\[\(\{<\s-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text, patterns) {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

const EVENTOS_PATTERNS = [
  /^eventos\s+ppv/i,
  /^deportes\s+ppv/i,
  /ppv\s*[-–]\s*events/i,
  /eventos\s+diarios/i,
  /juegos\s+olimpicos/i,
  /padel.*atp/i,
  /champions\s+league/i,
  /conference\s+league/i,
  /europa\s+league/i,
  /libertadores/i,
  /\bnfl\b/i,
  /\bnba\b/i,
  /\bmlb\b/i,
  /\bmls\b/i,
  /\bnhl\b/i,
  /\bncaa/i,
  /\bufc\b/i,
  /\bwnba\b/i,
  /premier\s+league/i,
  /directv\s+sports/i,
  /^dazn/i,
  /deportes\s+(espana|peru|honduras|arabes|premium)/i,
  /brasil\s+sports/i,
  /^uk\s+sports/i,
  /france\s+sports/i,
  /portugal\s+sports/i,
  /^rfef\s+tv/i,
  /futbol\s+espana/i,
  /liga\s+endesa/i,
  /ligue\s+1/i,
  /liga\s+pro\s+ec/i,
  /liga\s+mexicana\s+baseball/i,
  /beisbol.*dominicana/i,
  /club\s+fight/i,
  /^hipica/i,
  /stan\s+sports/i,
  /^serie\s+a\s*[-–]\s*events/i,
  /motor.*event/i,
  /^todo\s+motor/i,
  /formula\s+1/i,
  /gran\s+hermano/i,
  /casa\s+de\s+los\s+famosos/i,
  /lcdlf/i,
  /realitys\s+chile/i,
  /apostaria\s+por/i,
  /24\/7\s+reality\s+live/i,
  /deportes\s+premium/i,
  /\bppv\b/i
];

const MARATHON_247_PATTERNS = [/^24\/7/i, /\|\s*24\/7/i, /\b24\/7\b/i];

const ONDEMAND_PATTERNS = [
  /^--\s*vix\s*--/i,
  /^vix\+/i,
  /^vix\s*[-–]/i,
  /^claro\s+video/i,
  /^paramount\+\s*$/i,
  /^vod[-\s]/i,
  /^\s*vod\s+apple/i,
  /^vod-/i,
  /^(netflix|disney\+?|amazon\s+prime|apple\s+tv|hbo|hulu|fx|fox|cbs|nbc|amc|cw|history|documentary|paramount\s*\+|peacock|abc)\s+series/i,
  /^series\s*[-–]/i,
  /^series[-\s_]*(netflix|disney\+?|amazon\s+prime|amazon|apple\s+tv|apple|hbo|max|paramount\s*\+|peacock|hulu|fx|fox|cbs|nbc|amc|cw|showtime|starz|syfy|universal|britbox|espn|e!)/i,
  /^series\s+(netflix|disney|amazon|apple|hbo|paramount|peacock|hulu|fx|fox|cbs|nbc|amc|cw|showtime|starz|syfy|universal|britbox|espn|e!)/i,
  /^series\s+(animadas?|animacion|anime|documentales?|koreana|mexicanas?|retro|religiosas?|varios?|variadas?|star\+|starz|especiales?|britanicas?)/i,
  /^series\s+(amazon|apple|britbox|disney|fox|hbo|hulu|nbc|paramount|peacock|showtime|universal)/i,
  /series\s+4k/i,
  /^cine\s+(accion|aventura|belico|ciencia|comedia|crimen|deportes|dibujos|documental|drama|familiar|fantasia|historia|infantil|mexicano|misterio|musica|navidad|religion|retro|romantico|sagas|suspenso|terror|western|artes|anime|4k|box|premium)/i,
  /^cine\s+2[0-9]{3}/i,
  /^cinema\s+2[0-9]{3}/i,
  /^cine\s+(accion|aventura|comedia|ciencia|drama|suspenso?|suspense|terror)\s+audio\s+castellano/i,
  /^cine\s+y\s+series\s+espana/i,
  /\b(action|adventure|animation|comedy|crime|documentar(?:y|ies)?|drama|family|fantasy|horror|music|mystery|romantic|romance|science\s+fiction|thriller|war|wester)\s+movie\b/i,
  /^estrenos\s+20[0-9]{2}/i,
  /^nominadas\s+oscar/i,
  /^premier\s+movie/i,
  /^extra\s+cine/i,
  /cam\s*\|?\s*cine/i,
  /cine.*baja\s+calidad/i,
  /^novelas?[-\s]/i,
  /^novelas?\s*$/i,
  /novelas?\s+(turcas?|biblicas?|chilenas?|colombianas?|mexicanas?|y\s+novelas?)/i,
  /novelas?\s+y\s+novelas?/i,
  /^doramas?/i,
  /\(\s*cast\.?\s*\)/i,
  /series\s+movistar/i,
  /^kids\s+series\s*[-–]/i,
  /^xxx/i,
  /^adultos/i,
  /^conciertos/i,
  /^peliculas\s+paises/i,
  /^sagas\s+audio/i,
  /^nickelodeon\s*$/i,
  /^series\s+varios/i
];

function classifyGroupTitle(groupTitle) {
  const normalizedGroup = normalizeGroupTitle(groupTitle);
  if (matchesAny(normalizedGroup, EVENTOS_PATTERNS)) {
    return "eventos";
  }
  if (matchesAny(normalizedGroup, MARATHON_247_PATTERNS)) {
    return "247";
  }
  if (matchesAny(normalizedGroup, ONDEMAND_PATTERNS)) {
    return "ondemand";
  }
  return "tv";
}

module.exports = {
  classifyGroupTitle
};
