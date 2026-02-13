import type { StreamCandidate } from "../types";

export type AudioPreference = "es" | "original";

export function normalizeLanguageCode(value: string): string {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return "";

  if (raw === "spa") return "es";
  if (raw === "eng") return "en";
  if (raw === "es-la" || raw === "es_419") return "es-419";
  if (raw.startsWith("es-419")) return "es-419";

  if (raw.includes("-")) {
    return raw.split("-")[0];
  }

  return raw;
}

export function getAudioPriorityOrder(preference: AudioPreference, originalLanguage = ""): string[] {
  if (preference === "es") return ["es-419", "es", "multi", "en"];

  const normalizedOriginal = normalizeLanguageCode(originalLanguage);
  if (!normalizedOriginal || normalizedOriginal === "und") {
    return ["en", "multi", "es-419", "es"];
  }

  if (normalizedOriginal === "es-419" || normalizedOriginal === "es") {
    return ["es-419", "es", "multi", "en"];
  }

  return [normalizedOriginal, "multi", "en", "es-419", "es"];
}

export function extractCandidateLanguageHints(candidate: StreamCandidate): Set<string> {
  const text = `${candidate.displayName} ${candidate.stream.title || ""} ${candidate.stream.description || ""}`.toLowerCase();
  const set = new Set<string>();

  if (
    text.includes("multi") ||
    text.includes("multi-audio") ||
    text.includes("multi audio") ||
    text.includes("dual audio")
  ) {
    set.add("multi");
  }

  const map: Array<{ lang: string; patterns: string[] }> = [
    {
      lang: "es-419",
      patterns: ["latino", "latam", "audio latino", "es-la", "es_419", "mexico", "argentina", "hispano"]
    },
    { lang: "es", patterns: ["espanol", "castellano", "spanish", "spa"] },
    { lang: "en", patterns: ["english", "ingles", "eng"] },
    { lang: "pt", patterns: ["portuguese", "portugues", "pt-br", "ptbr", "por"] },
    { lang: "fr", patterns: ["french", "fra", "fre"] },
    { lang: "it", patterns: ["italian", "ita"] },
    { lang: "de", patterns: ["german", "deu", "ger"] },
    { lang: "ja", patterns: ["japanese", "jpn", "jap"] },
    { lang: "ko", patterns: ["korean", "kor"] },
    { lang: "zh", patterns: ["chinese", "chi", "mandarin", "cantonese"] },
    { lang: "ru", patterns: ["russian", "rus"] }
  ];

  for (const item of map) {
    if (item.patterns.some((pattern) => text.includes(pattern))) {
      set.add(item.lang);
    }
  }

  return set;
}

export function isSpanishLanguage(lang: string): boolean {
  const normalized = normalizeLanguageCode(lang);
  return normalized === "es" || normalized === "es-419";
}
