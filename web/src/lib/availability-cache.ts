import { checkAvailabilityBatch } from "../api";

const cache = new Map<string, boolean>();
const pending = new Map<string, Array<(value: boolean) => void>>();
let batchQueue: Array<{ type: string; itemId: string }> = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

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
