export interface LiveTvFavoriteEntry {
  channelId: string;
  name: string;
  logo: string | null;
  categoryId: string;
  categoryName: string;
  addedAt: number;
}

const STORAGE_KEY = "streams_livetv_favorites";
const MAX_ENTRIES = 200;

export function getLiveTvFavorites(): LiveTvFavoriteEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: LiveTvFavoriteEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage full — no-op
  }
}

export function isLiveTvFavorite(channelId: string): boolean {
  return getLiveTvFavorites().some((e) => e.channelId === channelId);
}

export function toggleLiveTvFavorite(channel: {
  id: string;
  name: string;
  logo: string | null;
  category: { id: string; name: string };
}): boolean {
  const list = getLiveTvFavorites();
  const exists = list.findIndex((e) => e.channelId === channel.id);
  if (exists >= 0) {
    list.splice(exists, 1);
    save(list);
    return false; // removed
  }
  list.unshift({
    channelId: channel.id,
    name: channel.name,
    logo: channel.logo,
    categoryId: channel.category.id,
    categoryName: channel.category.name,
    addedAt: Date.now()
  });
  save(list);
  return true; // added
}

export function getLiveTvFavoriteIds(): Set<string> {
  return new Set(getLiveTvFavorites().map((e) => e.channelId));
}
