import { describe, expect, it } from "vitest";
import { TabStore } from "../src/sidepanel/tab-store";

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "First tab",
    url: "https://first.example/path",
    active: false,
    pinned: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("TabStore", () => {
  it("initializes a sorted snapshot, ignores bad tabs, replaces old state, and lets later duplicate IDs win", () => {
    const store = new TabStore();
    store.add(tab({ id: 99 }));
    store.initialize([
      tab({ id: 2, index: 2, title: "Two" }),
      tab({ id: undefined }),
      tab({ id: 1, index: 1, title: "Old one" }),
      tab({ id: 1, index: 0, title: "New one" }),
    ]);

    expect(store.list()).toMatchObject([
      { id: 1, index: 0, title: "New one" },
      { id: 2, index: 2 },
    ]);
  });

  it("breaks same-index list ties by ID and isolates returned objects", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 9, index: 1 }), tab({ id: 3, index: 1 })]);
    const listed = store.list();
    listed[0]!.title = "Mutated";

    expect(listed.map((item) => item.id)).toEqual([3, 9]);
    expect(store.list()[0]!.title).toBe("First tab");
  });

  it("filters title, URL, and domain case-insensitively after trimming", () => {
    const store = new TabStore();
    store.initialize([
      tab({ id: 1, index: 0, title: "Alpha document", url: "https://one.example/a" }),
      tab({ id: 2, index: 1, title: "Other", url: "https://second.example/Needle" }),
      tab({ id: 3, index: 2, title: "Third", url: "https://Search.Example/home" }),
    ]);

    expect(store.filter(" ALPHA ").map((item) => item.id)).toEqual([1]);
    expect(store.filter("needle").map((item) => item.id)).toEqual([2]);
    expect(store.filter("search.example").map((item) => item.id)).toEqual([3]);
    expect(store.filter("   ")).toEqual(store.list());
  });

  it("returns isolated filter results", () => {
    const store = new TabStore();
    store.initialize([tab()]);
    const filtered = store.filter("first");
    filtered[0]!.url = "changed";

    expect(store.filter("first")[0]!.url).toBe("https://first.example/path");
  });

  it("adds and replaces tabs while safely rejecting missing IDs", () => {
    const store = new TabStore();
    expect(store.add(tab({ id: undefined }))).toBeUndefined();
    expect(store.add(tab({ id: 1, title: "Added" }))).toMatchObject({ id: 1, title: "Added" });
    expect(store.replace(tab({ id: undefined }))).toBeUndefined();
    const result = store.replace(tab({ id: 1, title: "Replaced" }));
    result!.title = "Changed";

    expect(store.list()).toMatchObject([{ id: 1, title: "Replaced" }]);
  });

  it("updates a tab without allowing its ID to change and removes exactly once", () => {
    const store = new TabStore();
    store.add(tab({ id: 1 }));
    expect(store.update(2, { title: "Missing" })).toBeUndefined();
    expect(store.update(1, { id: 99, title: "Updated" })).toMatchObject({ id: 1, title: "Updated" });
    expect(store.remove(1)).toBe(true);
    expect(store.remove(1)).toBe(false);
  });

  it("activates only the selected tab and ignores a missing target", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, active: true }), tab({ id: 2, active: false })]);
    store.activate(2);
    store.activate(99);

    expect(store.list().map((item) => [item.id, item.active])).toEqual([[1, false], [2, true]]);
  });

  it.each([
    ["front", 2, 0, [2, 1, 3]],
    ["middle", 1, 1, [2, 1, 3]],
    ["end", 1, 3, [2, 3, 1]],
    ["lower clamp", 3, -3, [3, 1, 2]],
    ["upper clamp", 1, 99, [2, 3, 1]],
  ])("moves a tab to the %s and renumbers indexes", (_name, id, targetIndex, ids) => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 }), tab({ id: 3, index: 2 })]);
    store.move(id, targetIndex);

    expect(store.list().map((item) => item.id)).toEqual(ids);
    expect(store.list().map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it("ignores moves for a missing target or non-finite integer index", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);
    store.move(99, 0);
    store.move(1, Number.NaN);
    store.move(1, Number.POSITIVE_INFINITY);
    store.move(1, 1.5);

    expect(store.list().map((item) => [item.id, item.index])).toEqual([[1, 0], [2, 1]]);
  });
});
