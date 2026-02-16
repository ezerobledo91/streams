export interface LiveTvHiddenEntry {
  channelId: string;
  name: string;
  streamUrl: string;
  categoryId: string;
  categoryName: string;
  reason: "no_funciona" | "no_interesa";
  hiddenAt: number;
}

const STORAGE_KEY = "streams_livetv_hidden";
const MAX_ENTRIES = 1000;

export function getLiveTvHidden(): LiveTvHiddenEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: LiveTvHiddenEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage full — no-op
  }
}

export function isLiveTvHidden(channelId: string): boolean {
  return getLiveTvHidden().some((e) => e.channelId === channelId);
}

export function hideLiveTvChannel(
  channel: { id: string; name: string; streamUrl: string; category: { id: string; name: string } },
  reason: "no_funciona" | "no_interesa"
): void {
  const list = getLiveTvHidden();
  if (list.some((e) => e.channelId === channel.id)) return;
  list.unshift({
    channelId: channel.id,
    name: channel.name,
    streamUrl: channel.streamUrl,
    categoryId: channel.category.id,
    categoryName: channel.category.name,
    reason,
    hiddenAt: Date.now()
  });
  save(list);
}

export function unhideLiveTvChannel(channelId: string): void {
  const list = getLiveTvHidden();
  save(list.filter((e) => e.channelId !== channelId));
}

export function getLiveTvHiddenIds(): Set<string> {
  return new Set(getLiveTvHidden().map((e) => e.channelId));
}
