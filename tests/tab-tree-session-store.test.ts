import { describe, expect, it, vi } from "vitest";
import { createTabTreeSessionStore } from "../src/sidepanel/tab-tree-session-store";

describe("tab tree session store", () => {
  it("loads only valid session tab IDs and writes serializable arrays", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({
        "tabTreeSessionState:10": {
          collapsedTabIds: [1, -1, 2.5, "3"],
          detachedTabIds: [4],
          attachedTabParentIds: [[5, 1], [6, -1], [7, "2"], [8], "bad"],
        },
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const store = createTabTreeSessionStore(area);
    const loaded = await store.load(10);
    expect([...loaded.collapsedTabIds]).toEqual([1]);
    expect([...loaded.detachedTabIds]).toEqual([4]);
    expect([...loaded.attachedTabParentIds]).toEqual([[5, 1]]);

    await store.save(10, loaded);
    expect(area.set).toHaveBeenCalledWith({
      "tabTreeSessionState:10": {
        collapsedTabIds: [1],
        detachedTabIds: [4],
        attachedTabParentIds: [[5, 1]],
      },
    });
  });

  it("falls back to empty state when session storage is unavailable", async () => {
    const store = createTabTreeSessionStore({
      get: vi.fn().mockRejectedValue(new Error("unavailable")),
      set: vi.fn(),
    });
    const loaded = await store.load(10);
    expect(loaded.collapsedTabIds.size).toBe(0);
    expect(loaded.detachedTabIds.size).toBe(0);
    expect(loaded.attachedTabParentIds.size).toBe(0);
  });

  it("coalesces queued writes so only the latest state follows an in-flight write", async () => {
    let finishFirst!: () => void;
    const set = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const store = createTabTreeSessionStore({ get: vi.fn(), set });

    const first = store.save(10, {
      collapsedTabIds: new Set([1]),
      detachedTabIds: new Set(),
      attachedTabParentIds: new Map(),
    });
    const second = store.save(10, {
      collapsedTabIds: new Set([2]),
      detachedTabIds: new Set(),
      attachedTabParentIds: new Map([[3, 2]]),
    });
    const third = store.save(10, {
      collapsedTabIds: new Set([4]),
      detachedTabIds: new Set([5]),
      attachedTabParentIds: new Map([[6, 4]]),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(set).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.all([first, second, third]);
    expect(set).toHaveBeenNthCalledWith(2, {
      "tabTreeSessionState:10": {
        collapsedTabIds: [4],
        detachedTabIds: [5],
        attachedTabParentIds: [[6, 4]],
      },
    });
    expect(set).toHaveBeenCalledTimes(2);
  });
});
