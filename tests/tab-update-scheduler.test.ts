import { describe, expect, it, vi } from "vitest";
import {
  createTabUpdateScheduler,
} from "../src/sidepanel/tab-update-scheduler";

describe("tab update scheduler", () => {
  it("flushes pending updates once per microtask window", async () => {
    const flush = vi.fn(async () => undefined);
    const scheduler = createTabUpdateScheduler(flush);

    scheduler.schedule(1, { id: 1, title: "a" } as chrome.tabs.Tab);
    scheduler.schedule(2, { id: 2, title: "b" } as chrome.tabs.Tab);
    scheduler.schedule(1, { id: 1, title: "c" } as chrome.tabs.Tab);

    await Promise.resolve();
    await Promise.resolve();

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated updates for the same tab within a window", async () => {
    let seen: Array<{ id: number; title: string | undefined }> = [];
    const scheduler = createTabUpdateScheduler(async (tabs) => {
      seen = tabs.map((tab) => ({ id: tab.id!, title: tab.title }));
    });

    scheduler.schedule(1, { id: 1, title: "first" } as chrome.tabs.Tab);
    scheduler.schedule(1, { id: 1, title: "last" } as chrome.tabs.Tab);

    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([{ id: 1, title: "last" }]);
  });

  it("flushes only the latest state of each tab", async () => {
    let seen: Array<{ id: number; title: string | undefined }> = [];
    const scheduler = createTabUpdateScheduler(async (tabs) => {
      seen = tabs.map((tab) => ({ id: tab.id!, title: tab.title }));
    });

    scheduler.schedule(1, { id: 1, title: "a" } as chrome.tabs.Tab);
    scheduler.schedule(2, { id: 2, title: "b" } as chrome.tabs.Tab);
    scheduler.schedule(1, { id: 1, title: "c" } as chrome.tabs.Tab);

    await Promise.resolve();
    await Promise.resolve();

    expect(seen.sort((left, right) => left.id - right.id)).toEqual([
      { id: 1, title: "c" },
      { id: 2, title: "b" },
    ]);
  });

  it("stops flushing after destroy", async () => {
    const flush = vi.fn(async () => undefined);
    const scheduler = createTabUpdateScheduler(flush);

    scheduler.destroy();
    scheduler.schedule(1, { id: 1 } as chrome.tabs.Tab);

    await Promise.resolve();
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
  });

  it("exposes pending count for tests", () => {
    const scheduler = createTabUpdateScheduler(async () => undefined);
    scheduler.schedule(1, { id: 1 } as chrome.tabs.Tab);
    expect(scheduler.pendingCount).toBe(1);
  });
});
