import { describe, expect, it } from "vitest";
import type { TabGroupViewModel } from "../src/sidepanel/tab-group-model";
import { buildTabListItems } from "../src/sidepanel/tab-list-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Example tab",
    url: "https://example.com/path",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

function group(overrides: Partial<TabGroupViewModel> = {}): TabGroupViewModel {
  return {
    id: 7,
    windowId: 10,
    title: "Work",
    color: "blue",
    collapsed: false,
    ...overrides,
  };
}

describe("buildTabListItems", () => {
  it("renders opener subtrees continuously with tree decorations when enabled", () => {
    const items = buildTabListItems([
      tab({ id: 1, index: 0 }),
      tab({ id: 3, index: 2, openerTabId: 1 }),
      tab({ id: 2, index: 1 }),
    ], [], { treeEnabled: true });

    expect(items).toMatchObject([
      { kind: "tab", tab: { id: 1 }, tree: { depth: 0, hasChildren: true } },
      { kind: "tab", tab: { id: 3 }, tree: { depth: 1 } },
      { kind: "tab", tab: { id: 2 }, tree: { depth: 0, hasChildren: false } },
    ]);
  });

  it("keeps native group members in one tree block and counts hidden descendants", () => {
    const items = buildTabListItems([
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7, openerTabId: 1 }),
      tab({ id: 3, index: 2, groupId: 7, openerTabId: 2 }),
    ], [group()], { treeEnabled: true, collapsedTabIds: new Set([1]) });

    expect(items).toMatchObject([
      { kind: "group", count: 3 },
      {
        kind: "tab",
        tab: { id: 1 },
        group: { position: "single" },
        tree: { collapsed: true },
      },
    ]);
  });
  it("sorts pinned and ordinary tabs by Chrome index and ID", () => {
    const tabs = [
      tab({ id: 6, index: 5 }),
      tab({ id: 4, index: 3, pinned: true }),
      tab({ id: 5, index: 1 }),
      tab({ id: 2, index: 0, pinned: true }),
      tab({ id: 3, index: 1 }),
      tab({ id: 1, index: 3, pinned: true }),
    ];

    expect(buildTabListItems(tabs, []).map((item) =>
      item.kind === "tab" ? item.tab.id : item.group.id,
    )).toEqual([2, 1, 4, 3, 5, 6]);
  });

  it("places pinned tabs first and inserts a group title before its first ordinary tab", () => {
    const tabs = [
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 1, index: 0, pinned: true, groupId: 7 }),
      tab({ id: 3, index: 2 }),
    ];

    expect(buildTabListItems(tabs, [group()])).toMatchObject([
      { kind: "tab", tab: { id: 1, pinned: true } },
      { kind: "group", group: { id: 7, title: "Work", color: "blue" }, count: 1 },
      { kind: "tab", tab: { id: 2, groupId: 7 } },
      { kind: "tab", tab: { id: 3, groupId: -1 } },
    ]);
  });

  it("emits a collapsed group title once without any child tabs", () => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2 }),
    ];

    expect(buildTabListItems(tabs, [group({ collapsed: true })])).toMatchObject([
      { kind: "group", group: { id: 7, collapsed: true }, count: 2 },
      { kind: "tab", tab: { id: 3 } },
    ]);
  });

  it("preserves an empty group title and adds its tab count", () => {
    const items = buildTabListItems(
      [tab({ groupId: 7 })],
      [group({ title: "" })],
    );

    expect(items[0]).toEqual({ kind: "group", group: group({ title: "" }), count: 1 });
  });

  it("shows tabs with missing group metadata as ungrouped tabs", () => {
    const groupedTab = tab({ id: 4, groupId: 99 });

    expect(buildTabListItems([groupedTab], [])).toEqual([
      { kind: "tab", tab: groupedTab },
    ]);
  });

  it("keeps ungrouped tabs between groups and emits each group title only once", () => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, index: 2, groupId: 8 }),
      tab({ id: 4, index: 3, groupId: 7 }),
    ];

    const itemIds = buildTabListItems(
      tabs,
      [group(), group({ id: 8, title: "Later" })],
    ).map((item) => item.kind === "group"
      ? `group:${item.group.id}`
      : `tab:${item.tab.id}`);

    expect(itemIds).toEqual([
      "group:7",
      "tab:1",
      "tab:2",
      "group:8",
      "tab:3",
      "tab:4",
    ]);
  });

  it("decorates three expanded group members by position", () => {
    const items = buildTabListItems(
      [
        tab({ id: 1, index: 0, groupId: 7 }),
        tab({ id: 2, index: 1, groupId: 7 }),
        tab({ id: 3, index: 2, groupId: 7 }),
      ],
      [group({ color: "green" })],
    );

    expect(items.filter((item) => item.kind === "tab")).toMatchObject([
      { group: { groupId: 7, color: "green", position: "first" } },
      { group: { groupId: 7, color: "green", position: "middle" } },
      { group: { groupId: 7, color: "green", position: "last" } },
    ]);
  });

  it("decorates an only expanded group member as single", () => {
    const items = buildTabListItems(
      [tab({ id: 1, groupId: 7 })],
      [group({ color: "orange" })],
    );

    expect(items[1]).toMatchObject({
      kind: "tab",
      group: { groupId: 7, color: "orange", position: "single" },
    });
  });

  it("does not decorate collapsed, ungrouped, pinned, or unknown-group tabs", () => {
    const collapsedItems = buildTabListItems(
      [tab({ id: 1, index: 0, groupId: 7 })],
      [group({ collapsed: true })],
    );
    expect(collapsedItems).toEqual([
      { kind: "group", group: group({ collapsed: true }), count: 1 },
    ]);

    const visibleItems = buildTabListItems(
      [
        tab({ id: 2, index: 0, pinned: true, groupId: 8 }),
        tab({ id: 3, index: 1 }),
        tab({ id: 4, index: 2, groupId: 99 }),
      ],
      [group({ id: 8 })],
    );
    for (const item of visibleItems) {
      if (item.kind === "tab") expect(item).not.toHaveProperty("group");
    }
  });

  it("counts adjacent expanded groups independently", () => {
    const items = buildTabListItems(
      [
        tab({ id: 1, index: 0, groupId: 7 }),
        tab({ id: 2, index: 1, groupId: 7 }),
        tab({ id: 3, index: 2, groupId: 8 }),
        tab({ id: 4, index: 3, groupId: 8 }),
      ],
      [group(), group({ id: 8, color: "red" })],
    );

    expect(items.filter((item) => item.kind === "tab").map((item) =>
      item.kind === "tab" ? item.group : undefined,
    )).toEqual([
      { groupId: 7, color: "blue", position: "first" },
      { groupId: 7, color: "blue", position: "last" },
      { groupId: 8, color: "red", position: "first" },
      { groupId: 8, color: "red", position: "last" },
    ]);
  });

  it("reads group membership only a linear number of times for five hundred tabs", () => {
    let groupIdReads = 0;
    const tabs = Array.from({ length: 500 }, (_, index) => {
      const model = tab({ id: index + 1, index });
      Object.defineProperty(model, "groupId", {
        configurable: true,
        enumerable: true,
        get() {
          groupIdReads += 1;
          return 7;
        },
      });
      return model;
    });

    const items = buildTabListItems(tabs, [group()]);

    expect(items).toHaveLength(501);
    expect(groupIdReads).toBeLessThanOrEqual(tabs.length * 2);
  });

  it("does not mutate supplied tabs or groups", () => {
    const tabs = [tab({ id: 1, groupId: 7 })];
    const groups = [group()];
    const originalTabs = structuredClone(tabs);
    const originalGroups = structuredClone(groups);

    buildTabListItems(tabs, groups);

    expect(tabs).toEqual(originalTabs);
    expect(groups).toEqual(originalGroups);
  });
});
