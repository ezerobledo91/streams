export interface SubtitleMemoryEntry {
  url: string;
  label: string;
  updatedAt: number;
  successCount: number;
}

export type SubtitleMemoryStore = Record<string, SubtitleMemoryEntry>;

const SUBTITLE_MEMORY_STORAGE_KEY = "streams.subtitle.memory.v1";
const SUBTITLE_MEMORY_MAX_ITEMS = 320;

export function readSubtitleMemoryStore(): SubtitleMemoryStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SUBTITLE_MEMORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SubtitleMemoryStore;
  } catch {
    return {};
  }
}

export function trimSubtitleMemoryStore(store: SubtitleMemoryStore): SubtitleMemoryStore {
  const entries = Object.entries(store || {});
  if (entries.length <= SUBTITLE_MEMORY_MAX_ITEMS) {
    return store;
  }

  entries.sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  return Object.fromEntries(entries.slice(0, SUBTITLE_MEMORY_MAX_ITEMS));
}

export function writeSubtitleMemoryStore(store: SubtitleMemoryStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUBTITLE_MEMORY_STORAGE_KEY, JSON.stringify(trimSubtitleMemoryStore(store)));
  } catch {
    // ignore storage errors
  }
}
