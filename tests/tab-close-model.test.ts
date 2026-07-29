import { describe, expect, it } from "vitest";
import { getClosableTabsBelow } from "../src/sidepanel/tab-close-model";
import { buildTabListItems } from "../src/sidepanel/tab-list-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function fakeTabModel(overrides: Partial<TabViewModel> = {}): TabViewModel {
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

describe("getClosableTabsBelow", () => {
  const tabs = [
    fakeTabModel({ id: 1, index: 0, pinned: true }),
    fakeTabModel({ id: 2, index: 1 }),
    fakeTabModel({ id: 3, index: 2, pinned: true }),
    fakeTabModel({ id: 4, index: 20 }),
    fakeTabModel({ id: 5, index: 10 }),
  ];

  it("returns only unpinned tab IDs after an unpinned target in display order", () => {
    expect(getClosableTabsBelow(tabs, 2)).toEqual([4, 5]);
  });

  it("returns all unpinned tab IDs after a pinned target", () => {
    expect(getClosableTabsBelow(tabs, 1)).toEqual([2, 4, 5]);
  });

  it.each([
    ["the target is last", 5],
    ["the target is missing", 99],
  ])("returns an empty array when %s", (_reason, tabId) => {
    expect(getClosableTabsBelow(tabs, tabId)).toEqual([]);
  });

  it("does not mutate the supplied tab list", () => {
    const original = structuredClone(tabs);

    getClosableTabsBelow(tabs, 2);

    expect(tabs).toEqual(original);
  });

  it("includes tabs hidden by a collapsed group when given the full tab snapshot", () => {
    const fullTabs = [
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2, groupId: 7 }),
      fakeTabModel({ id: 4, index: 3, groupId: 7 }),
      fakeTabModel({ id: 5, index: 4 }),
    ];
    const visibleItems = buildTabListItems(fullTabs, [{
      id: 7,
      windowId: 10,
      title: "Collapsed",
      color: "blue",
      collapsed: true,
    }]);

    expect(
      visibleItems.flatMap((item) => item.kind === "tab" ? [item.tab.id] : []),
    ).toEqual([2, 5]);
    expect(getClosableTabsBelow(fullTabs, 2)).toEqual([3, 4, 5]);
  });
});
