import { describe, expect, it, vi } from "vitest";
import {
  createShortcutFaviconCacheStore,
  shortcutFaviconCacheKey,
} from "../src/sidepanel/shortcut-favicon-cache";
import type { StorageArea } from "../src/sidepanel/shortcut-store";
import { deferred } from "./helpers/fake-chrome";

function area(stored: Record<string, unknown> = {}): StorageArea {
  return {
    get: vi.fn().mockResolvedValue(stored),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

describe("shortcut favicon cache", () => {
  it("loads only normalized origins and safe image URLs", async () => {
    const data = "data:image/png;base64,abc";
    const storage = area({
      [shortcutFaviconCacheKey]: {
        "https://a.example": "https://cdn.example/a.png",
        "http://b.example:8080": data,
        "https://a.example/path": "https://cdn.example/path.png",
        "chrome://settings": "https://cdn.example/chrome.png",
        "https://danger.example": "javascript:alert(1)",
        "https://file.example": "file:///icon.png",
      },
    });

    await expect(createShortcutFaviconCacheStore(storage).load()).resolves.toEqual(
      new Map([
        ["https://a.example", "https://cdn.example/a.png"],
        ["http://b.example:8080", data],
      ]),
    );
  });

  it("rejects oversized data images and falls back for corrupt persisted values", async () => {
    const oversized = `data:image/png;base64,${"a".repeat(32 * 1024)}`;
    const invalidValues = [null, [], "bad", { "https://a.example": oversized }];

    for (const value of invalidValues) {
      const storage = area({ [shortcutFaviconCacheKey]: value });
      await expect(createShortcutFaviconCacheStore(storage).load()).resolves.toEqual(new Map());
    }
  });

  it("maps storage read failures to a stable error", async () => {
    const storage = area();
    vi.mocked(storage.get).mockRejectedValueOnce(new Error("unavailable"));

    await expect(createShortcutFaviconCacheStore(storage).load()).rejects.toThrow(
      "无法读取快捷网站图标缓存",
    );
  });

  it("coalesces updates into one complete snapshot and skips equal values", async () => {
    const storage = area();
    const store = createShortcutFaviconCacheStore(storage);
    await store.load();

    store.update("https://a.example", "https://cdn.example/a.png");
    store.update("https://b.example", "data:image/png;base64,b");
    store.update("https://c.example", "https://cdn.example/c.png");
    await store.flush();

    expect(storage.set).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledWith({
      [shortcutFaviconCacheKey]: {
        "https://a.example": "https://cdn.example/a.png",
        "https://b.example": "data:image/png;base64,b",
        "https://c.example": "https://cdn.example/c.png",
      },
    });
    vi.mocked(storage.set).mockClear();
    store.update("https://a.example", "https://cdn.example/a.png");
    await store.flush();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("prunes to the first twelve configured origins and removes an explicit entry", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [
        `https://${index}.example`,
        `https://cdn.example/${index}.png`,
      ]),
    );
    const storage = area({ [shortcutFaviconCacheKey]: entries });
    const store = createShortcutFaviconCacheStore(storage);
    await store.load();

    store.prune(new Set(Object.keys(entries)));
    store.update("https://0.example", undefined);
    await store.flush();

    expect(store.snapshot().size).toBe(11);
    expect(store.snapshot().has("https://0.example")).toBe(false);
    expect(store.snapshot().has("https://12.example")).toBe(false);
  });

  it("serializes writes and persists the latest snapshot after an in-flight write", async () => {
    const first = deferred<void>();
    const storage = area();
    vi.mocked(storage.set)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    const store = createShortcutFaviconCacheStore(storage);
    await store.load();

    store.update("https://a.example", "https://cdn.example/old.png");
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledOnce();
    store.update("https://a.example", "https://cdn.example/latest.png");
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledOnce();
    first.resolve();
    await store.flush();

    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(storage.set).toHaveBeenLastCalledWith({
      [shortcutFaviconCacheKey]: {
        "https://a.example": "https://cdn.example/latest.png",
      },
    });
  });

  it("consumes write failures and stops scheduling after destroy", async () => {
    const storage = area();
    vi.mocked(storage.set).mockRejectedValueOnce(new Error("write failed"));
    const store = createShortcutFaviconCacheStore(storage);
    await store.load();
    store.update("https://a.example", "https://cdn.example/a.png");

    await expect(store.flush()).rejects.toThrow("无法保存快捷网站图标缓存");
    store.destroy();
    store.update("https://b.example", "https://cdn.example/b.png");
    await store.flush();
    expect(storage.set).toHaveBeenCalledOnce();
  });
});
