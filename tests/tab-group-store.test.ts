import { describe, expect, it } from "vitest";
import { TabGroupStore } from "../src/sidepanel/tab-group-store";

function group(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    id: 1,
    windowId: 10,
    title: "Work",
    color: "blue",
    collapsed: false,
    ...overrides,
  } as chrome.tabGroups.TabGroup;
}

describe("TabGroupStore", () => {
  it("initializes only current-window groups, ignores invalid data, and lets later duplicate IDs win", () => {
    const store = new TabGroupStore();
    store.put(group({ id: 99 }), 10);

    store.initialize([
      group({ id: 3, windowId: 11 }),
      group({ id: undefined }),
      group({ id: 2, title: "Two" }),
      group({ id: 1, title: "Old one" }),
      group({ id: 1, title: "New one" }),
    ], 10);

    expect(store.list()).toMatchObject([
      { id: 1, windowId: 10, title: "New one" },
      { id: 2, windowId: 10, title: "Two" },
    ]);
  });

  it("sorts by ID and isolates list and get results", () => {
    const store = new TabGroupStore();
    store.initialize([group({ id: 9 }), group({ id: 3 })], 10);

    const listed = store.list();
    const found = store.get(3);
    listed[0]!.title = "Changed in list";
    found!.color = "red";

    expect(listed.map((item) => item.id)).toEqual([3, 9]);
    expect(store.get(3)).toMatchObject({ title: "Work", color: "blue" });
    expect(store.get(99)).toBeUndefined();
  });

  it("puts and replaces current-window groups while rejecting foreign or invalid groups", () => {
    const store = new TabGroupStore();

    const inserted = store.put(group({ id: 4, title: "  Inserted  " }), 10);
    inserted!.title = "Changed result";
    expect(store.get(4)).toMatchObject({ title: "Inserted" });

    expect(
      store.put(group({ id: 4, title: "Replacement", collapsed: true }), 10),
    ).toMatchObject({
      id: 4,
      title: "Replacement",
      collapsed: true,
    });
    expect(store.put(group({ id: 5, windowId: 11 }), 10)).toBeUndefined();
    expect(store.put(group({ id: undefined }), 10)).toBeUndefined();
    expect(store.list().map((item) => item.id)).toEqual([4]);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("does not store invalid group ID %s", (id) => {
    const store = new TabGroupStore();

    expect(store.put(group({ id }), 10)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it("removes a stored group exactly once", () => {
    const store = new TabGroupStore();
    store.initialize([group({ id: 1 }), group({ id: 2 })], 10);

    expect(store.remove(1)).toBe(true);
    expect(store.remove(1)).toBe(false);
    expect(store.list().map((item) => item.id)).toEqual([2]);
  });
});
