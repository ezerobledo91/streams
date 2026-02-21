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

export function resolvePlatformProviderName(id: string, fallback = ""): string {
  const normalized = String(id || "").trim();
  if (!normalized) return fallback;
  const match = PLATFORM_PROVIDERS.find((provider) => provider.id === normalized);
  if (match) return match.name;
  return fallback || `Proveedor ${normalized}`;
}
