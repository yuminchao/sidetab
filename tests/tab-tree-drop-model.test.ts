import { describe, expect, it } from "vitest";
import { createTabTreeDropResolver } from "../src/sidepanel/tab-tree-drop-model";
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

describe("tab tree drop model", () => {
  const tabs = [
    tab({ id: 1, index: 0 }),
    tab({ id: 2, index: 1, openerTabId: 1 }),
    tab({ id: 3, index: 2, openerTabId: 2 }),
    tab({ id: 4, index: 3, openerTabId: 1 }),
    tab({ id: 5, index: 4 }),
  ];

  it("uses the previous visible row to resolve a requested child depth", () => {
    const resolve = createTabTreeDropResolver(tabs, 5);

    expect(resolve({ kind: "tab", tabId: 2, placement: "after" }, 2)).toEqual({
      kind: "tab",
      tabId: 2,
      placement: "after",
      tree: { depth: 2, parentId: 2 },
    });
  });

  it("clamps depth to four and to one level below the previous row", () => {
    const resolve = createTabTreeDropResolver(tabs, 5);

    expect(resolve({ kind: "tab", tabId: 2, placement: "after" }, 4)).toMatchObject({
      tree: { depth: 2, parentId: 2 },
    });
    expect(resolve({ kind: "tab", tabId: 1, placement: "before" }, 3)).toMatchObject({
      tree: { depth: 0 },
    });
  });

  it("promotes a subtree root to the root level", () => {
    const resolve = createTabTreeDropResolver(tabs, 2);

    expect(resolve({ kind: "tab", tabId: 5, placement: "before" }, 0)).toMatchObject({
      tree: { depth: 0 },
    });
  });

  it("rejects a target inside the dragged subtree", () => {
    const resolve = createTabTreeDropResolver(tabs, 1);

    expect(resolve({ kind: "tab", tabId: 3, placement: "after" }, 3)).toBeUndefined();
  });

  it("keeps native groups and pinned tabs outside tree depth selection", () => {
    const boundedTabs = [
      tab({ id: 1, index: 0, pinned: true }),
      tab({ id: 2, index: 1 }),
      tab({ id: 3, index: 2, groupId: 7 }),
    ];
    const resolve = createTabTreeDropResolver(boundedTabs, 2);

    expect(resolve({ kind: "tab", tabId: 1, placement: "after" }, 1)).toBeUndefined();
    expect(resolve({ kind: "tab", tabId: 3, placement: "after" }, 1)).toBeUndefined();
  });

  it("resolves the external tail as a root-level target", () => {
    const resolve = createTabTreeDropResolver(tabs, 2);

    expect(resolve({ kind: "end" }, 4)).toEqual({
      kind: "end",
      tree: { depth: 0 },
    });
  });

  it("falls back to root instead of attaching across a native group", () => {
    const boundedTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2 }),
      tab({ id: 4, index: 3 }),
    ];
    const resolve = createTabTreeDropResolver(boundedTabs, 4);

    expect(resolve({ kind: "tab", tabId: 3, placement: "before" }, 1)).toEqual({
      kind: "tab",
      tabId: 3,
      placement: "before",
      tree: { depth: 0 },
    });
  });

  it("rejects a drop when neither order nor parent would change", () => {
    const resolve = createTabTreeDropResolver(tabs, 5);

    expect(resolve({ kind: "tab", tabId: 4, placement: "after" }, 0)).toBeUndefined();
  });

  it("keeps every descendant within the four-level depth limit", () => {
    const deepTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 3, index: 2, openerTabId: 2 }),
      tab({ id: 4, index: 3, openerTabId: 3 }),
      tab({ id: 5, index: 4 }),
      tab({ id: 6, index: 5, openerTabId: 5 }),
    ];
    const resolve = createTabTreeDropResolver(deepTabs, 5);

    expect(resolve({ kind: "tab", tabId: 4, placement: "after" }, 4)).toMatchObject({
      tree: { depth: 3, parentId: 3 },
    });
  });
});
