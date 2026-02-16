import { checkAvailabilityBatch } from "../api";

const STORAGE_KEY = "availability-cache";
const STORAGE_TTL_MS = 30 * 60 * 1000; // 30 min

const cache = new Map<string, boolean>();
const pending = new Map<string, Array<(value: boolean) => void>>();
let batchQueue: Array<{ type: string; itemId: string }> = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

// Hydrate from sessionStorage on load
try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { entries: [string, boolean][]; at: number };
    if (parsed?.at && Date.now() - parsed.at < STORAGE_TTL_MS && Array.isArray(parsed.entries)) {
      for (const [key, value] of parsed.entries) {
        cache.set(key, value);
      }
    }
  }
} catch {
  // ignore corrupt storage
}

function persistToStorage() {
  try {
    const entries = [...cache.entries()].slice(-500);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, at: Date.now() }));
  } catch {
    // storage full or unavailable
  }
}

function flushBatch() {
  batchTimer = null;
  const items = batchQueue.splice(0, 20);
  if (!items.length) return;

  // If there are remaining items, schedule another flush
  if (batchQueue.length > 0) {
    batchTimer = setTimeout(flushBatch, 50);
  }

  checkAvailabilityBatch(items)
    .then((response) => {
      for (const item of items) {
        const key = `${item.type}:${item.itemId}`;
        const value = response.results[key] ?? false;
        cache.set(key, value);
        const callbacks = pending.get(key);
        if (callbacks) {
          pending.delete(key);
          for (const cb of callbacks) cb(value);
        }
      }
      persistToStorage();
    })
    .catch(() => {
      for (const item of items) {
        const key = `${item.type}:${item.itemId}`;
        const callbacks = pending.get(key);
        if (callbacks) {
          pending.delete(key);
          for (const cb of callbacks) cb(false);
        }
      }
    });
}

export function invalidateAvailability(type: string, itemId: string): void {
  const key = `${type}:${itemId}`;
  cache.delete(key);
  persistToStorage();
}

export function checkAvailability(type: string, itemId: string): Promise<boolean> {
  const key = `${type}:${itemId}`;

  if (cache.has(key)) {
    return Promise.resolve(cache.get(key)!);
  }

  return new Promise<boolean>((resolve) => {
    const existing = pending.get(key);
    if (existing) {
      existing.push(resolve);
      return;
    }

    pending.set(key, [resolve]);
    batchQueue.push({ type, itemId });

    if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, 150);
    }
  });
}
