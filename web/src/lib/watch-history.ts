export interface WatchHistoryEntry {
  type: "movie" | "series";
  itemId: string;
  name: string;
  poster: string | null;
  background: string | null;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  position: number;
  duration: number;
  lastWatched: number;    // set automatically by upsertWatchEntry
}

export type WatchHistoryInput = Omit<WatchHistoryEntry, "lastWatched">;

const STORAGE_KEY = "streams_watch_history";
const MAX_ENTRIES = 50;

function entryKey(entry: Pick<WatchHistoryEntry, "type" | "itemId" | "season" | "episode">): string {
  const base = `${entry.type}:${entry.itemId}`;
  if (entry.type === "series" && entry.season != null && entry.episode != null) {
    return `${base}:${entry.season}:${entry.episode}`;
  }
  return base;
}

export function getWatchHistory(): WatchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWatchHistory(entries: WatchHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage full — no-op
  }
}

export function upsertWatchEntry(entry: WatchHistoryInput): void {
  const history = getWatchHistory();
  const key = entryKey(entry);
  const filtered = history.filter((e) => entryKey(e) !== key);
  filtered.unshift({ ...entry, lastWatched: Date.now() });
  saveWatchHistory(filtered);
}

export function removeWatchEntry(type: string, itemId: string, season?: number, episode?: number): void {
  const history = getWatchHistory();
  const key = entryKey({ type: type as "movie" | "series", itemId, season, episode });
  saveWatchHistory(history.filter((e) => entryKey(e) !== key));
}

export function getContinueWatching(): WatchHistoryEntry[] {
  return getWatchHistory()
    .filter((e) => {
      if (e.duration <= 0) return false;
      const pct = e.position / e.duration;
      return (pct > 0.02 || e.position >= 10) && pct < 0.95;
    })
    .sort((a, b) => b.lastWatched - a.lastWatched)
    .slice(0, 20);
}
