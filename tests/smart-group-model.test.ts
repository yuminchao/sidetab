import { describe, expect, it } from "vitest";
import {
  classifySmartGroupTab,
  createOneClickGroupPlan,
  createQuickGroupPlan,
} from "../src/sidepanel/smart-group-model";
import { TAB_GROUP_COLORS } from "../src/sidepanel/tab-group-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Example",
    url: "https://example.com/path",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

function group(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    id: 7,
    windowId: 10,
    title: "User title",
    color: "blue",
    collapsed: false,
    ...overrides,
  } as chrome.tabGroups.TabGroup;
}

describe("classifySmartGroupTab", () => {
  it("classifies HTTP sites by their complete normalized hostname", () => {
    expect(classifySmartGroupTab(tab({ url: "HTTPS://WWW.Example.COM:8443/a" }))).toEqual({
      key: "site:www.example.com",
      title: "www.example.com",
      kind: "site",
    });
    expect(classifySmartGroupTab(tab({ url: "https://sub.example.com/" }))).toEqual({
      key: "site:sub.example.com",
      title: "sub.example.com",
      kind: "site",
    });
  });

  it.each([
    ["file:///C:/report.txt", "special:file", "本地文件"],
    ["file://server/share/report.txt", "special:file", "本地文件"],
    ["chrome://settings/", "special:chrome-settings", "Chrome 设置"],
    ["chrome://settings/privacy", "special:chrome-settings", "Chrome 设置"],
    ["chrome://extensions/", "special:chrome", "Chrome 页面"],
  ])("classifies supported special URL %s", (url, key, title) => {
    expect(classifySmartGroupTab(tab({ url }))).toEqual({ key, title, kind: "special" });
  });

  it.each([
    tab({ pinned: true }),
    tab({ url: "chrome-extension://abc/page.html" }),
    tab({ url: "edge://settings/" }),
    tab({ url: "about:blank" }),
    tab({ url: "not a URL" }),
  ])("does not classify pinned or unsupported tabs", (candidate) => {
    expect(classifySmartGroupTab(candidate)).toBeUndefined();
  });
});

describe("createQuickGroupPlan", () => {
  it("creates one group from every same-category tab across existing memberships", () => {
    const tabs = [
      tab({ id: 1, index: 3 }),
      tab({ id: 2, index: 1, url: "http://example.com/second", groupId: 9 }),
      tab({ id: 3, index: 2, url: "https://other.example/" }),
      tab({ id: 4, index: 0, url: "https://example.com/pinned", pinned: true }),
      tab({ id: 5, index: 4, windowId: 11 }),
    ];

    expect(createQuickGroupPlan(tabs, [group({ id: 9, color: "grey" })], 1)).toEqual({
      windowId: 10,
      operations: [{
        kind: "reuse",
        groupId: 9,
        tabIds: [1],
      }],
    });
  });

  it("matches groups by actual members and applies count then earliest-index tie-breaking", () => {
    const tabs = [
      tab({ id: 1, index: 8 }),
      tab({ id: 2, index: 5, groupId: 70 }),
      tab({ id: 3, index: 6, groupId: 70 }),
      tab({ id: 4, index: 1, groupId: 80 }),
      tab({ id: 5, index: 9, groupId: 80 }),
      tab({ id: 6, index: 7, groupId: 90 }),
    ];
    const groups = [
      group({ id: 70, title: "example.com", color: "red" }),
      group({ id: 80, title: "Unrelated", color: "green" }),
      group({ id: 90, windowId: 11 }),
    ];

    expect(createQuickGroupPlan(tabs, groups, 1)).toEqual({
      windowId: 10,
      operations: [{ kind: "reuse", groupId: 80, tabIds: [2, 3, 6, 1] }],
    });
  });

  it("creates even for one candidate and selects a stable available color", () => {
    expect(createQuickGroupPlan(
      [tab()],
      [group({ color: "grey" }), group({ id: 8, color: "red" })],
      1,
    )).toEqual({
      windowId: 10,
      operations: [{
        kind: "create",
        title: "example.com",
        color: "blue",
        tabIds: [1],
      }],
    });
  });

  it("returns undefined for an invalid target or when the best group already has every candidate", () => {
    expect(createQuickGroupPlan([tab({ pinned: true })], [], 1)).toBeUndefined();
    expect(createQuickGroupPlan([tab({ url: "about:blank" })], [], 1)).toBeUndefined();
    expect(createQuickGroupPlan([tab()], [], 99)).toBeUndefined();
    expect(createQuickGroupPlan([tab({ groupId: 7 })], [group()], 1)).toBeUndefined();
  });

  it("does not treat an abnormal negative group ID as ungrouped", () => {
    expect(createQuickGroupPlan([tab({ groupId: -2 })], [], 1)).toBeUndefined();
  });
});

describe("createOneClickGroupPlan", () => {
  it("reuses named groups and merges every duplicate group into a stable target", () => {
    const tabs = [
      tab({ id: 1, index: 0, url: "https://example.com/new" }),
      tab({ id: 2, index: 1, url: "https://example.com/kept", groupId: 20 }),
      tab({ id: 3, index: 2, url: "https://unrelated.example/merged", groupId: 21 }),
      tab({ id: 4, index: 3, url: "https://single-a.example/" }),
      tab({ id: 5, index: 4, url: "https://single-b.example/" }),
      tab({ id: 6, index: 5, url: "https://also-unrelated.example/merged", groupId: 31 }),
    ];
    const groups = [
      group({ id: 21, title: "example.com", color: "red" }),
      group({ id: 20, title: "example.com", color: "blue" }),
      group({ id: 31, title: "其他", color: "yellow" }),
      group({ id: 30, title: "其他", color: "green" }),
    ];

    expect(createOneClickGroupPlan(tabs, groups)?.operations).toEqual([
      { kind: "reuse", groupId: 20, tabIds: [1, 3] },
      { kind: "reuse", groupId: 30, tabIds: [4, 5, 6] },
    ]);
  });

  it("reuses matching groups, groups repeated sites, and pools ordinary site singletons into Other", () => {
    const tabs = [
      tab({ id: 1, index: 0, url: "https://reuse.example/a", groupId: 7 }),
      tab({ id: 2, index: 1, url: "https://reuse.example/b" }),
      tab({ id: 3, index: 2, url: "https://pair.example/a" }),
      tab({ id: 4, index: 3, url: "https://single-a.example/" }),
      tab({ id: 5, index: 4, url: "https://pair.example/b" }),
      tab({ id: 6, index: 5, url: "https://single-b.example/" }),
      tab({ id: 7, index: 6, url: "https://grouped.example/", groupId: 8 }),
    ];

    expect(createOneClickGroupPlan(tabs, [group(), group({ id: 8, color: "grey" })])).toEqual({
      windowId: 10,
      operations: [
        { kind: "reuse", groupId: 7, tabIds: [2] },
        { kind: "create", title: "pair.example", color: "red", tabIds: [3, 5] },
        { kind: "create", title: "其他", color: "yellow", tabIds: [4, 6], role: "other" },
      ],
    });
  });

  it("keeps each special category independent even when it has one candidate", () => {
    const tabs = [
      tab({ id: 1, index: 3, url: "chrome://extensions/" }),
      tab({ id: 2, index: 1, url: "file:///C:/a.txt" }),
      tab({ id: 3, index: 2, url: "chrome://settings/privacy" }),
    ];

    expect(createOneClickGroupPlan(tabs, [])).toEqual({
      windowId: 10,
      operations: [
        { kind: "create", title: "本地文件", color: "grey", tabIds: [2] },
        { kind: "create", title: "Chrome 设置", color: "blue", tabIds: [3] },
        { kind: "create", title: "Chrome 页面", color: "red", tabIds: [1] },
      ],
    });
  });

  it("reuses the exact Other title in the current window before its saved role", () => {
    const tabs = [
      tab({ id: 1, index: 0, url: "https://one.example/" }),
      tab({ id: 2, index: 1, url: "https://two.example/" }),
    ];
    const groups = [
      group({ id: 20, title: "其他", color: "grey" }),
      group({ id: 21, windowId: 11, title: "其他" }),
    ];

    expect(createOneClickGroupPlan(tabs, groups)?.operations).toEqual([
      { kind: "reuse", groupId: 20, tabIds: [1, 2] },
    ]);
    expect(createOneClickGroupPlan(tabs, groups, 20)?.operations).toEqual([
      { kind: "reuse", groupId: 20, tabIds: [1, 2] },
    ]);
    expect(createOneClickGroupPlan(tabs, groups, 21)?.operations).toEqual([
      { kind: "reuse", groupId: 20, tabIds: [1, 2] },
    ]);
  });

  it("does not move pinned, grouped, unsupported, or other-window tabs", () => {
    const tabs = [
      tab({ id: 1, pinned: true }),
      tab({ id: 2, groupId: 7 }),
      tab({ id: 3, url: "about:blank" }),
      tab({ id: 4, windowId: 11 }),
    ];

    expect(createOneClickGroupPlan(tabs, [group()])).toBeUndefined();
  });

  it("does not move a supported tab with an abnormal negative group ID", () => {
    expect(createOneClickGroupPlan([tab({ groupId: -2 })], [])).toBeUndefined();
  });

  it("avoids duplicate colors within a batch and cycles stably after all colors are occupied", () => {
    const groups = TAB_GROUP_COLORS.map((color, index) => group({ id: index, color }));
    groups.push(group({ id: 20, color: "grey" }));
    const tabs = [
      tab({ id: 1, index: 0, url: "file:///a" }),
      tab({ id: 2, index: 1, url: "chrome://settings/" }),
    ];

    expect(createOneClickGroupPlan(tabs, groups)?.operations).toEqual([
      { kind: "create", title: "本地文件", color: "blue", tabIds: [1] },
      { kind: "create", title: "Chrome 设置", color: "red", tabIds: [2] },
    ]);
  });

  it("uses a missing window color once, then avoids batch colors until all nine are selected", () => {
    const occupiedColors = TAB_GROUP_COLORS.slice(0, 8);
    const groups = Array.from({ length: 16 }, (_, index) => group({
      id: index,
      color: occupiedColors[index % occupiedColors.length]!,
    }));
    const tabs = Array.from({ length: 20 }, (_, index) => tab({
      id: index + 1,
      index,
      url: `https://site-${Math.floor(index / 2)}.example/${index}`,
    }));

    const operations = createOneClickGroupPlan(tabs, groups)?.operations ?? [];
    const colors = operations.flatMap((operation) => (
      operation.kind === "create" ? [operation.color] : []
    ));

    expect(colors).toHaveLength(10);
    expect(colors[0]).toBe("orange");
    expect(new Set(colors.slice(0, 9))).toEqual(new Set(TAB_GROUP_COLORS));
    expect(TAB_GROUP_COLORS).toContain(colors[9]);
  });

  it("scans a 500-tab snapshot once and returns stable index order without browser APIs", () => {
    const source = Array.from({ length: 500 }, (_, index) => tab({
      id: index + 1,
      index: 499 - index,
      url: index % 2 === 0 ? `https://even.example/${index}` : `https://odd.example/${index}`,
    }));
    let itemReads = 0;
    const tabs = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) itemReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const plan = createOneClickGroupPlan(tabs, []);

    expect(itemReads).toBe(500);
    expect(plan?.operations).toHaveLength(2);
    expect(plan?.operations[0]).toMatchObject({ title: "odd.example" });
    expect(plan?.operations[0]?.tabIds[0]).toBe(500);
    expect(plan?.operations[1]).toMatchObject({ title: "even.example" });
    expect(plan?.operations[1]?.tabIds[0]).toBe(499);
  });

  it("orders 500 randomly indexed tabs with a linear number of index reads", () => {
    let indexReads = 0;
    const tabs = Array.from({ length: 500 }, (_, position) => {
      const model = tab({
        id: position + 1,
        url: position % 2 === 0
          ? `https://even.example/${position}`
          : `https://odd.example/${position}`,
      });
      const index = (position * 137) % 500;
      Object.defineProperty(model, "index", {
        enumerable: true,
        get() {
          indexReads += 1;
          return index;
        },
      });
      return model;
    });

    const plan = createOneClickGroupPlan(tabs, []);

    expect(indexReads).toBeLessThanOrEqual(1_500);
    expect(plan?.operations[0]?.tabIds[0]).toBe(1);
    expect(plan?.operations[1]?.tabIds[0]).toBe(74);
  });

  it("stably orders negative, duplicate, and invalid indexes without large allocations", () => {
    const tabs = [
      tab({ id: 1, index: Number.NaN, url: "file:///1" }),
      tab({ id: 2, index: 2, url: "file:///2" }),
      tab({ id: 3, index: -3, url: "file:///3" }),
      tab({ id: 4, index: 2, url: "file:///4" }),
      tab({ id: 5, index: Number.POSITIVE_INFINITY, url: "file:///5" }),
      tab({ id: 6, index: -1, url: "file:///6" }),
      tab({ id: 7, index: Number.MAX_SAFE_INTEGER + 1, url: "file:///7" }),
      tab({ id: 8, index: -3, url: "file:///8" }),
    ];

    expect(createOneClickGroupPlan(tabs, [])?.operations).toEqual([{
      kind: "create",
      title: "本地文件",
      color: "grey",
      tabIds: [3, 8, 6, 2, 4, 1, 5, 7],
    }]);
  });
});
