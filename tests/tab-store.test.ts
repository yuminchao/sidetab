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
  it("lists pinned tabs first while preserving each group's Chrome index order", () => {
    const store = new TabStore();
    store.initialize([
      tab({ id: 1, index: 0, title: "Matches" }),
      tab({ id: 2, index: 3, pinned: true, title: "Matches" }),
      tab({ id: 3, index: 1, pinned: true, title: "Matches" }),
      tab({ id: 4, index: 2, title: "Matches" }),
    ]);

    expect(store.list().map((item) => item.id)).toEqual([3, 2, 1, 4]);
    expect(store.filter(" ").map((item) => item.id)).toEqual([3, 2, 1, 4]);
    expect(store.filter("matches").map((item) => item.id)).toEqual([3, 2, 1, 4]);
  });

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

  it("inserts a new tab in the middle and closes the gap after removing it", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);
    store.add(tab({ id: 3, index: 1 }));

    expect(store.list().map((item) => [item.id, item.index])).toEqual([[1, 0], [3, 1], [2, 2]]);
    expect(store.remove(3)).toBe(true);
    expect(store.list().map((item) => [item.id, item.index])).toEqual([[1, 0], [2, 1]]);
  });

  it("treats an added existing ID as a replace without shifting other tabs", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 })]);
    store.add(tab({ id: 2, index: 1, title: "Replacement" }));

    expect(store.list().map((item) => [item.id, item.index, item.title])).toEqual([
      [1, 0, "First tab"],
      [2, 1, "Replacement"],
    ]);
  });

  it("keeps active state unique across out-of-order add and replace events", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0, active: true }), tab({ id: 2, index: 1, active: false })]);
    store.add(tab({ id: 3, index: 0, active: true }));
    store.replace(tab({ id: 2, index: 2, active: true }));

    expect(store.list().map((item) => [item.id, item.active])).toEqual([[3, false], [1, false], [2, true]]);
  });

  it("repositions an existing replacement and inserts a missing replacement", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 }), tab({ id: 3, index: 2 })]);
    store.replace(tab({ id: 3, index: 0 }));
    store.replace(tab({ id: 4, index: 1 }));

    expect(store.list().map((item) => [item.id, item.index])).toEqual([[3, 0], [4, 1], [1, 2], [2, 3]]);
  });

  it("atomically replaces an old ID and keeps one replacement in Chrome index order", () => {
    const store = new TabStore();
    store.initialize([
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, active: true }),
      tab({ id: 9, index: 2, title: "Stale target" }),
      tab({ id: 3, index: 3 }),
    ]);

    expect(
      store.replaceId(2, tab({ id: 9, index: 1, title: "Replacement", active: true })),
    ).toMatchObject({ id: 9, index: 1, title: "Replacement", active: true });
    expect(store.list().map((item) => [item.id, item.index])).toEqual([
      [1, 0],
      [9, 1],
      [3, 2],
    ]);
  });

  it("preserves the complete store when an ID replacement is invalid", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1, active: true })]);
    const before = store.list();

    expect(store.replaceId(1, tab({ id: undefined, index: 0 }))).toBeUndefined();
    expect(store.list()).toEqual(before);
  });

  it("updates a tab without allowing its ID to change and removes exactly once", () => {
    const store = new TabStore();
    store.add(tab({ id: 1 }));
    expect(store.update(2, { title: "Missing" })).toBeUndefined();
    expect(store.update(1, { id: 99, title: "Updated" })).toMatchObject({ id: 1, title: "Updated" });
    expect(store.remove(1)).toBe(true);
    expect(store.remove(1)).toBe(false);
  });

  it("only accepts valid update fields, derives domain from URL, and safely removes a favicon", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, favIconUrl: "https://one.example/icon", title: "Original" }), tab({ id: 2, index: 1 })]);
    const invalid = {
      id: 99,
      windowId: "wrong",
      index: -1,
      title: undefined,
      url: undefined,
      domain: 12,
      active: "yes",
      pinned: 0,
      groupId: Number.NaN,
    } as unknown as Partial<import("../src/sidepanel/tab-model").TabViewModel>;
    store.update(1, invalid);
    store.update(1, { title: "  ", url: "https://updated.example/path", domain: "override", favIconUrl: undefined });

    expect(store.list()[0]).toMatchObject({
      id: 1,
      windowId: 10,
      title: "新标签页",
      url: "https://updated.example/path",
      domain: "updated.example",
      active: false,
      pinned: false,
      groupId: -1,
    });
    expect(store.list()[0]).not.toHaveProperty("favIconUrl");
    expect(store.filter("updated.example").map((item) => item.id)).toEqual([1]);
  });

  it("updates group membership only for integer group IDs", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, groupId: 7 })]);

    expect(store.update(1, { groupId: 8 })).toMatchObject({ groupId: 8 });
    store.update(1, { groupId: 1.5 });
    store.update(1, { groupId: Number.POSITIVE_INFINITY });

    expect(store.list()[0]).toMatchObject({ groupId: 8 });
  });

  it("keeps group membership for invalid IDs and accepts the ungrouped sentinel", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, groupId: 7 })]);

    for (const groupId of [
      -2,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      store.update(1, { groupId });
      expect(store.list()[0]).toMatchObject({ groupId: 7 });
    }

    expect(store.update(1, { groupId: -1 })).toMatchObject({ groupId: -1 });
  });

  it("uses move semantics for a valid updated index and rejects invalid index values", () => {
    const store = new TabStore();
    store.initialize([tab({ id: 1, index: 0 }), tab({ id: 2, index: 1 }), tab({ id: 3, index: 2 })]);
    store.update(1, { index: 2 });
    store.update(3, { index: Number.NaN });

    expect(store.list().map((item) => [item.id, item.index])).toEqual([[2, 0], [3, 1], [1, 2]]);
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

  it("moves pinned and unpinned tabs by Chrome index without changing pinned-first display order", () => {
    const store = new TabStore();
    store.initialize([
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, pinned: true }),
      tab({ id: 3, index: 2 }),
      tab({ id: 4, index: 3, pinned: true }),
    ]);

    store.move(3, 0);
    expect(store.list().map((item) => [item.id, item.index])).toEqual([
      [2, 2],
      [4, 3],
      [3, 0],
      [1, 1],
    ]);

    store.move(4, 1);
    expect(store.list().map((item) => [item.id, item.index])).toEqual([
      [4, 1],
      [2, 3],
      [3, 0],
      [1, 2],
    ]);
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
