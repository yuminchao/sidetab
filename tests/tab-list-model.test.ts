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
      { kind: "group", group: { id: 7, title: "Work", color: "blue" } },
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
      { kind: "group", group: { id: 7, collapsed: true } },
      { kind: "tab", tab: { id: 3 } },
    ]);
  });

  it("preserves an empty group title and never adds a tab count", () => {
    const items = buildTabListItems(
      [tab({ groupId: 7 })],
      [group({ title: "" })],
    );

    expect(items[0]).toEqual({ kind: "group", group: group({ title: "" }) });
    expect(items[0]).not.toHaveProperty("count");
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
