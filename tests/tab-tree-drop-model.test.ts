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

  it.each([
    {
      name: "Root -> Root sibling",
      sourceId: 5,
      request: {
        relation: "sibling" as const,
        target: { kind: "tab" as const, tabId: 1, placement: "before" as const },
      },
      expected: {
        kind: "tab",
        tabId: 1,
        placement: "before",
        tree: { relation: "sibling", referenceId: 1, depth: 0 },
      },
    },
    {
      name: "Root -> Root child",
      sourceId: 5,
      request: { relation: "child" as const, parentId: 1 },
      expected: {
        kind: "tab",
        tabId: 4,
        placement: "after",
        tree: { relation: "child", referenceId: 1, depth: 1, parentId: 1 },
      },
    },
    {
      name: "Root -> Child sibling",
      sourceId: 5,
      request: {
        relation: "sibling" as const,
        target: { kind: "tab" as const, tabId: 2, placement: "after" as const },
      },
      expected: {
        kind: "tab",
        tabId: 3,
        placement: "after",
        tree: { relation: "sibling", referenceId: 2, depth: 1, parentId: 1 },
      },
    },
    {
      name: "Root -> Child child",
      sourceId: 5,
      request: { relation: "child" as const, parentId: 2 },
      expected: {
        kind: "tab",
        tabId: 3,
        placement: "after",
        tree: { relation: "child", referenceId: 2, depth: 2, parentId: 2 },
      },
    },
    {
      name: "Child -> Child sibling",
      sourceId: 2,
      request: {
        relation: "sibling" as const,
        target: { kind: "tab" as const, tabId: 4, placement: "after" as const },
      },
      expected: {
        kind: "tab",
        tabId: 4,
        placement: "after",
        tree: { relation: "sibling", referenceId: 4, depth: 1, parentId: 1 },
      },
    },
    {
      name: "Child -> Child child",
      sourceId: 4,
      request: { relation: "child" as const, parentId: 2 },
      expected: {
        kind: "tab",
        tabId: 3,
        placement: "after",
        tree: { relation: "child", referenceId: 2, depth: 2, parentId: 2 },
      },
    },
    {
      name: "Child -> Root sibling",
      sourceId: 4,
      request: {
        relation: "sibling" as const,
        target: { kind: "tab" as const, tabId: 5, placement: "before" as const },
      },
      expected: {
        kind: "tab",
        tabId: 5,
        placement: "before",
        tree: { relation: "sibling", referenceId: 5, depth: 0 },
      },
    },
    {
      name: "Child -> Root child",
      sourceId: 4,
      request: { relation: "child" as const, parentId: 5 },
      expected: {
        kind: "tab",
        tabId: 5,
        placement: "after",
        tree: { relation: "child", referenceId: 5, depth: 1, parentId: 5 },
      },
    },
  ])("resolves $name", ({ sourceId, request, expected }) => {
    expect(createTabTreeDropResolver(tabs, sourceId)(request)).toEqual(expected);
  });

  it("uses the reference subtree end for sibling-after and child placement", () => {
    const resolveSibling = createTabTreeDropResolver(tabs, 4);

    expect(resolveSibling({
      relation: "sibling",
      target: { kind: "tab", tabId: 1, placement: "after" },
    })).toEqual({
      kind: "tab",
      tabId: 3,
      placement: "after",
      tree: { relation: "sibling", referenceId: 1, depth: 0 },
    });
    expect(createTabTreeDropResolver(tabs, 5)({
      relation: "child",
      parentId: 1,
    })).toMatchObject({
      kind: "tab",
      tabId: 4,
      placement: "after",
      tree: { relation: "child", referenceId: 1, depth: 1, parentId: 1 },
    });
  });

  it("resolves the list tail as a root sibling", () => {
    expect(createTabTreeDropResolver(tabs, 2)({
      relation: "sibling",
      target: { kind: "end" },
    })).toEqual({
      kind: "end",
      tree: { relation: "sibling", depth: 0 },
    });
  });

  it("rejects sibling and child targets inside the dragged subtree", () => {
    const resolve = createTabTreeDropResolver(tabs, 1);

    expect(resolve({
      relation: "sibling",
      target: { kind: "tab", tabId: 3, placement: "after" },
    })).toBeUndefined();
    expect(resolve({ relation: "child", parentId: 3 })).toBeUndefined();
  });

  it("keeps the complete dragged subtree within the four-level depth limit", () => {
    const deepTabs = [
      tab({ id: 10, index: 0 }),
      tab({ id: 11, index: 1, openerTabId: 10 }),
      tab({ id: 16, index: 2, openerTabId: 11 }),
      tab({ id: 12, index: 3 }),
      tab({ id: 13, index: 4, openerTabId: 12 }),
      tab({ id: 14, index: 5, openerTabId: 13 }),
      tab({ id: 15, index: 6, openerTabId: 14 }),
    ];
    const resolve = createTabTreeDropResolver(deepTabs, 10);

    expect(resolve({ relation: "child", parentId: 15 })).toBeUndefined();
    expect(resolve({
      relation: "sibling",
      target: { kind: "tab", tabId: 15, placement: "after" },
    })).toBeUndefined();

    const exactLimitTabs = deepTabs.filter((item) => item.id !== 16);
    expect(createTabTreeDropResolver(exactLimitTabs, 10)({
      relation: "sibling",
      target: { kind: "tab", tabId: 15, placement: "after" },
    })).toMatchObject({
      tree: { depth: 3, parentId: 14 },
    });
  });

  it("rejects pinned, native-grouped, missing, and cross-window targets", () => {
    const boundedTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, pinned: true }),
      tab({ id: 3, index: 2, groupId: 7 }),
      tab({ id: 4, index: 3, windowId: 11 }),
      tab({ id: 5, index: 4 }),
    ];
    const resolve = createTabTreeDropResolver(boundedTabs, 5);

    for (const parentId of [2, 3, 4, 99]) {
      expect(resolve({ relation: "child", parentId })).toBeUndefined();
      expect(resolve({
        relation: "sibling",
        target: { kind: "tab", tabId: parentId, placement: "before" },
      })).toBeUndefined();
    }
  });

  it("rejects tree relationships that cross a native Chrome boundary", () => {
    const boundedTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2, openerTabId: 1 }),
      tab({ id: 4, index: 3 }),
    ];
    const resolve = createTabTreeDropResolver(boundedTabs, 4);

    expect(resolve({ relation: "child", parentId: 1 })).toBeUndefined();
    expect(resolve({
      relation: "sibling",
      target: { kind: "tab", tabId: 3, placement: "before" },
    })).toBeUndefined();
  });

  it("rejects sibling-after when the real subtree anchor crosses a native boundary", () => {
    const boundedTabs = [
      tab({ id: 1, index: 0 }),
      tab({ id: 2, index: 1, openerTabId: 1 }),
      tab({ id: 3, index: 2, groupId: 7 }),
      tab({ id: 4, index: 3, openerTabId: 2 }),
      tab({ id: 5, index: 4 }),
    ];
    const resolve = createTabTreeDropResolver(boundedTabs, 5);

    expect(resolve({
      relation: "sibling",
      target: { kind: "tab", tabId: 2, placement: "after" },
    })).toBeUndefined();
    expect(resolve({
      relation: "sibling",
      target: { kind: "tab", tabId: 1, placement: "after" },
    })).toBeUndefined();
  });

  it("rejects a root-tail placement when the dragged subtree already exceeds four levels", () => {
    const overDepthTabs = Array.from({ length: 6 }, (_, index) => tab({
      id: index + 1,
      index,
      ...(index === 0 ? {} : { openerTabId: index }),
    }));
    overDepthTabs.push(tab({ id: 7, index: 6 }));

    expect(createTabTreeDropResolver(overDepthTabs, 1)({
      relation: "sibling",
      target: { kind: "end" },
    })).toBeUndefined();
  });

  it("creates the resolver for a large deep snapshot without recursive tree rebuilding", () => {
    const deepTabs = Array.from({ length: 10_000 }, (_, index) => tab({
      id: index + 1,
      index,
      ...(index === 0 ? {} : { openerTabId: index }),
    }));

    expect(() => createTabTreeDropResolver(deepTabs, 10_000)).not.toThrow();
  });

  it("sorts the snapshot only once before building linear tree indexes", () => {
    let indexReads = 0;
    const count = 256;
    const instrumentedTabs = Array.from({ length: count }, (_, index) => {
      const item = tab({ id: index + 1, index });
      Object.defineProperty(item, "index", {
        configurable: true,
        enumerable: true,
        get: () => {
          indexReads += 1;
          return index;
        },
      });
      return item;
    });

    createTabTreeDropResolver(instrumentedTabs, count);

    expect(indexReads).toBeLessThan(count * 4);
  });

  it("rejects unchanged root and child sibling placements", () => {
    expect(createTabTreeDropResolver(tabs, 5)({
      relation: "sibling",
      target: { kind: "tab", tabId: 1, placement: "after" },
    })).toBeUndefined();
    expect(createTabTreeDropResolver(tabs, 4)({
      relation: "sibling",
      target: { kind: "tab", tabId: 2, placement: "after" },
    })).toBeUndefined();
  });

  it("still resolves when only the parent relationship changes", () => {
    expect(createTabTreeDropResolver(tabs, 5)({
      relation: "child",
      parentId: 1,
    })).toMatchObject({
      tabId: 4,
      placement: "after",
      tree: { parentId: 1 },
    });
  });

  it("rejects invalid dragged tabs before creating a resolver", () => {
    const sourceTabs = [
      tab({ id: 1, index: 0, pinned: true }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2 }),
    ];
    const request = {
      relation: "sibling" as const,
      target: { kind: "end" as const },
    };

    expect(createTabTreeDropResolver(sourceTabs, 1)(request)).toBeUndefined();
    expect(createTabTreeDropResolver(sourceTabs, 2)(request)).toBeUndefined();
    expect(createTabTreeDropResolver(sourceTabs, 99)(request)).toBeUndefined();
  });
});
