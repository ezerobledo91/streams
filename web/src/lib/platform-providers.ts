export interface PlatformProvider {
  id: string;
  name: string;
}

export const PLATFORM_PROVIDERS: PlatformProvider[] = [
  { id: "8", name: "Netflix" },
  { id: "337", name: "Disney+" },
  { id: "9", name: "Prime Video" },
  { id: "15", name: "Hulu" },
  { id: "350", name: "Apple TV+" },
  { id: "531", name: "Paramount+" },
  { id: "386", name: "Peacock" },
  { id: "1899", name: "Max" }
];

export const PLATFORM_PROVIDER_CATALOG: PlatformProvider[] = [
  ...PLATFORM_PROVIDERS,
  { id: "43", name: "Starz" },
  { id: "526", name: "AMC+" },
  { id: "34", name: "MGM+" },
  { id: "283", name: "Crunchyroll" },
  { id: "257", name: "fuboTV" },
  { id: "300", name: "Pluto TV" },
  { id: "207", name: "The Roku Channel" },
  { id: "11", name: "MUBI" },
  { id: "258", name: "Criterion Channel" },
  { id: "190", name: "Curiosity Stream" },
  { id: "100", name: "GuideDoc" },
  { id: "87", name: "Acorn TV" },
  { id: "143", name: "Sundance Now" },
  { id: "151", name: "BritBox" },
  { id: "251", name: "ALLBLK" },
  { id: "430", name: "HiDive" },
  { id: "438", name: "Chai Flicks" },
  { id: "427", name: "MHz Choice" },
  { id: "344", name: "Rakuten Viki" },
  { id: "315", name: "Hoichoi" },
  { id: "581", name: "iQIYI" },
  { id: "457", name: "VIX" },
  { id: "559", name: "Filmzie" },
  { id: "2478", name: "FOUND TV" },
  { id: "692", name: "Cultpix" },
  { id: "475", name: "DOCSVILLE" },
  { id: "554", name: "BroadwayHD" },
  { id: "551", name: "Magellan TV" },
  { id: "546", name: "WOW Presents Plus" },
  { id: "567", name: "True Story" },
  { id: "569", name: "DocAlliance Films" },
  { id: "444", name: "Dekkoo" },
  { id: "192", name: "YouTube" },
  { id: "188", name: "YouTube Premium" },
  { id: "235", name: "YouTube Free" },
  { id: "332", name: "Fandango at Home Free" },
  { id: "7", name: "Fandango At Home" },
  { id: "10", name: "Amazon Video" },
  { id: "613", name: "Prime Video Free with Ads" },
  { id: "582", name: "Paramount+ Amazon Channel" },
  { id: "583", name: "MGM+ Amazon Channel" },
  { id: "584", name: "Discovery+ Amazon Channel" },
  { id: "528", name: "AMC+ Amazon Channel" },
  { id: "633", name: "Paramount+ Roku Premium Channel" },
  { id: "634", name: "Starz Roku Premium Channel" },
  { id: "635", name: "AMC+ Roku Premium Channel" },
  { id: "636", name: "MGM+ Roku Premium Channel" }
].filter(
  (provider, index, array) => array.findIndex((entry) => entry.id === provider.id) === index
);

export function resolvePlatformProviderName(id: string, fallback = ""): string {
  const normalized = String(id || "").trim();
  if (!normalized) return fallback;
  const match = PLATFORM_PROVIDER_CATALOG.find((provider) => provider.id === normalized);
  if (match) return match.name;
  return fallback || `Proveedor ${normalized}`;
}
