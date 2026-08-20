import { describe, expect, it } from "vitest";
import {
  buildTabForest,
  flattenVisibleTabForest,
  getTabSubtreeIds,
  getTabTreeAncestorIds,
  type TabTreeNode,
} from "../src/sidepanel/tab-tree-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Tab",
    url: "https://example.com/",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

function summarize(nodes: readonly TabTreeNode[]): unknown[] {
  return nodes.map((node) => [node.tab.id, node.children.length, summarize(node.children)]);
}

describe("tab tree model", () => {
  it("builds a recursive opener tree and orders siblings by Chrome index", () => {
    const forest = buildTabForest([
      tab({ id: 4, index: 3, openerTabId: 1 }),
      tab({ id: 3, index: 2, openerTabId: 2 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 1, index: 0 }),
    ]);

    expect(summarize(forest)).toEqual([[1, 2, [[2, 1, [[3, 0, []]]], [4, 0, []]]]]);
    expect(flattenVisibleTabForest(forest, new Set()).map(({ tab, depth }) => [tab.id, depth]))
      .toEqual([[1, 0], [2, 1], [3, 2], [4, 1]]);
  });

  it("applies explicit session parents without bypassing tree boundaries", () => {
    const tabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, index: 2, pinned: true }),
      tab({ id: 4, index: 3, groupId: 7 }),
    ];

    expect(summarize(buildTabForest(
      tabs,
      new Set(),
      new Map([[2, 1], [3, 1], [4, 1]]),
    ))).toEqual([
      [1, 1, [[2, 0, []]]],
      [3, 0, []],
      [4, 0, []],
    ]);
  });

  it("suppresses relationships across pinned and native-group boundaries", () => {
    const forest = buildTabForest([
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1, pinned: true }),
      tab({ id: 3, index: 2, openerTabId: 1, groupId: 7 }),
      tab({ id: 4, index: 3, openerTabId: 3, groupId: 7 }),
    ]);

    expect(summarize(forest)).toEqual([
      [1, 0, []],
      [2, 0, []],
      [3, 1, [[4, 0, []]]],
    ]);
  });

  it("treats missing parents, detached tabs, self links, and cycles as roots", () => {
    const forest = buildTabForest(
      [
        tab({ id: 1, index: 0, openerTabId: 2 }),
        tab({ id: 2, index: 1, openerTabId: 1 }),
        tab({ id: 3, index: 2, openerTabId: 99 }),
        tab({ id: 4, index: 3, openerTabId: 4 }),
        tab({ id: 5, index: 4, openerTabId: 3 }),
      ],
      new Set([5]),
    );

    expect(forest.map((node) => node.tab.id)).toEqual([1, 2, 3, 4, 5]);
    expect(forest.every((node) => node.children.length === 0)).toBe(true);
  });

  it("keeps an active descendant hidden behind a manually collapsed ancestor", () => {
    const forest = buildTabForest([
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 3, index: 2, openerTabId: 2 }),
    ]);

    expect(flattenVisibleTabForest(forest, new Set([1, 2])).map(({ tab }) => tab.id))
      .toEqual([1]);

    forest[0]!.children[0]!.children[0]!.tab.active = true;
    expect(flattenVisibleTabForest(forest, new Set([1, 2]))).toMatchObject([
      {
        tab: { id: 1 },
        collapsed: true,
        containsActiveDescendant: true,
      },
    ]);
  });

  it("does not mutate input and handles five hundred tabs in one forest", () => {
    const tabs = Array.from({ length: 500 }, (_, index) =>
      tab({
        id: index + 1,
        index,
        ...(index > 0 ? { openerTabId: index } : {}),
      }),
    );
    const before = structuredClone(tabs);

    const forest = buildTabForest(tabs);

    expect(forest).toHaveLength(1);
    expect(flattenVisibleTabForest(forest, new Set())).toHaveLength(500);
    expect(tabs).toEqual(before);
  });

  it("handles a deeply nested opener chain without exhausting the call stack", () => {
    const depth = 12_000;
    const tabs = Array.from({ length: depth }, (_, index) =>
      tab({
        id: index + 1,
        index,
        ...(index > 0 ? { openerTabId: index } : {}),
      }),
    );

    const forest = buildTabForest(tabs);

    expect(forest).toHaveLength(1);
    expect(flattenVisibleTabForest(forest, new Set())).toHaveLength(depth);
  });

  it("returns a parent and all descendants in visual preorder for block moves", () => {
    const tabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 3, index: 2, openerTabId: 2 }),
      tab({ id: 4, index: 3 }),
    ];
    expect(getTabSubtreeIds(tabs, 1)).toEqual([1, 2, 3]);
    expect(getTabSubtreeIds(tabs, 2, new Set([2]))).toEqual([2, 3]);
    expect(getTabTreeAncestorIds(tabs, 3)).toEqual([2, 1]);
  });
});
