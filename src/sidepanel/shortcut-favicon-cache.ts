import { getAllowedImageUrl, getHttpOrigin } from "./favicon-model";
import type { StorageArea } from "./shortcut-store";

export const shortcutFaviconCacheKey = "shortcutFaviconCacheV1";

const maxEntries = 12;
const maxDataImageLength = 32 * 1024;

export type ShortcutFaviconCache = ReadonlyMap<string, string>;

export type ShortcutFaviconCacheStore = {
  load(): Promise<Map<string, string>>;
  snapshot(): Map<string, string>;
  update(origin: string, url: string | undefined): void;
  prune(origins: ReadonlySet<string>): void;
  flush(): Promise<void>;
  destroy(): void;
};

export function createShortcutFaviconCacheStore(area: StorageArea): ShortcutFaviconCacheStore {
  let cache = new Map<string, string>();
  let active = true;
  let scheduled = false;
  let writeChain: Promise<void> = Promise.resolve();
  let lastWriteFailed = false;

  const scheduleWrite = (): void => {
    if (!active || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!active) return;
      const snapshot = Object.fromEntries(sortedEntries(cache));
      writeChain = writeChain.then(async () => {
        try {
          await area.set({ [shortcutFaviconCacheKey]: snapshot });
          lastWriteFailed = false;
        } catch {
          lastWriteFailed = true;
        }
      });
    });
  };

  return {
    async load() {
      let stored: Record<string, unknown>;
      try {
        stored = await area.get(shortcutFaviconCacheKey);
      } catch {
        throw new Error("无法读取快捷网站图标缓存");
      }

      try {
        cache = parseCache(stored[shortcutFaviconCacheKey]);
      } catch {
        cache = new Map();
      }
      return new Map(cache);
    },

    snapshot() {
      return new Map(cache);
    },

    update(origin, url) {
      if (!active || !isNormalizedHttpOrigin(origin)) return;
      if (url === undefined) {
        if (cache.delete(origin)) scheduleWrite();
        return;
      }
      const safeUrl = getCacheableImageUrl(url);
      if (!safeUrl || cache.get(origin) === safeUrl) return;
      cache.set(origin, safeUrl);
      scheduleWrite();
    },

    prune(origins) {
      if (!active) return;
      const retained = new Map<string, string>();
      for (const origin of Array.from(origins).slice(0, maxEntries)) {
        const value = cache.get(origin);
        if (value !== undefined && isNormalizedHttpOrigin(origin)) {
          retained.set(origin, value);
        }
      }
      if (mapsEqual(cache, retained)) return;
      cache = retained;
      scheduleWrite();
    },

    async flush() {
      do {
        while (scheduled) await Promise.resolve();
        const pending = writeChain;
        await pending;
        if (pending === writeChain && !scheduled) break;
      } while (true);
      if (lastWriteFailed) {
        lastWriteFailed = false;
        throw new Error("无法保存快捷网站图标缓存");
      }
    },

    destroy() {
      active = false;
    },
  };
}

function parseCache(raw: unknown): Map<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  const result = new Map<string, string>();
  for (const [origin, value] of Object.entries(raw)) {
    if (result.size >= maxEntries) break;
    if (!isNormalizedHttpOrigin(origin) || typeof value !== "string") continue;
    const safeUrl = getCacheableImageUrl(value);
    if (safeUrl) result.set(origin, safeUrl);
  }
  return result;
}

function getCacheableImageUrl(raw: string): string {
  const safeUrl = getAllowedImageUrl(raw);
  if (!safeUrl) return "";
  if (/^data:image\//i.test(safeUrl) && safeUrl.length > maxDataImageLength) return "";
  return safeUrl;
}

function isNormalizedHttpOrigin(raw: string): boolean {
  return getHttpOrigin(raw) === raw;
}

function sortedEntries(cache: ReadonlyMap<string, string>): Array<[string, string]> {
  return Array.from(cache.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function mapsEqual(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}
