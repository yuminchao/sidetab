import { describe, expect, it } from "vitest";
import type { TabGroupViewModel } from "../src/sidepanel/tab-group-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";
import {
  createTabGroupReorderPlan,
  type GroupDropTarget,
} from "../src/sidepanel/tab-group-reorder-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Tab",
    url: "https://example.com",
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
    title: "Group",
    color: "blue",
    collapsed: false,
    ...overrides,
  };
}

const source = group({ id: 7 });
const targetGroup = group({ id: 8, title: "Target" });

function plan(
  tabs: readonly TabViewModel[],
  target: GroupDropTarget,
  groups: readonly TabGroupViewModel[] = [source, targetGroup],
) {
  return createTabGroupReorderPlan(tabs, groups, source.id, target);
}

describe("tab group reorder model", () => {
  it("moves a source group from before a target group to after its remaining block", () => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2, groupId: 8 }),
      tab({ id: 4, index: 3, groupId: 8 }),
    ];

    expect(plan(tabs, { kind: "group", groupId: 8, placement: "after" })).toEqual({
      groupId: 7,
      targetIndex: 2,
      windowId: 10,
    });
  });

  it("moves a source group from after a target group to before its block", () => {
    const tabs = [
      tab({ id: 3, index: 0, groupId: 8 }),
      tab({ id: 4, index: 1, groupId: 8 }),
      tab({ id: 1, index: 2, groupId: 7 }),
      tab({ id: 2, index: 3, groupId: 7 }),
    ];

    expect(plan(tabs, { kind: "group", groupId: 8, placement: "before" })).toEqual({
      groupId: 7,
      targetIndex: 0,
      windowId: 10,
    });
  });

  it("places a group relative to an ungrouped tab after removing the source block", () => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2 }),
      tab({ id: 4, index: 3 }),
    ];

    expect(plan(tabs, { kind: "tab", tabId: 3, placement: "after" })).toEqual({
      groupId: 7,
      targetIndex: 1,
      windowId: 10,
    });
  });

  it.each([
    [
      "before",
      [
        tab({ id: 3, index: 0, groupId: 8 }),
        tab({ id: 4, index: 1, groupId: 8 }),
        tab({ id: 1, index: 2, groupId: 7 }),
        tab({ id: 2, index: 3, groupId: 7 }),
      ],
      0,
    ],
    [
      "after",
      [
        tab({ id: 1, index: 0, groupId: 7 }),
        tab({ id: 2, index: 1, groupId: 7 }),
        tab({ id: 3, index: 2, groupId: 8 }),
        tab({ id: 4, index: 3, groupId: 8 }),
      ],
      2,
    ],
  ] as const)(
    "normalizes a target member to the complete target group %s boundary",
    (placement, tabs, targetIndex) => {
      expect(plan(tabs, { kind: "tab", tabId: 3, placement })).toEqual({
        groupId: 7,
        targetIndex,
        windowId: 10,
      });
    },
  );

  it("treats collapsed source and target groups like their complete member blocks", () => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2, groupId: 8 }),
      tab({ id: 4, index: 3, groupId: 8 }),
    ];
    const groups = [
      group({ id: 7, collapsed: true }),
      group({ id: 8, collapsed: true }),
    ];

    expect(plan(tabs, { kind: "group", groupId: 8, placement: "after" }, groups)).toEqual({
      groupId: 7,
      targetIndex: 2,
      windowId: 10,
    });
  });

  it("rejects a pinned tab target", () => {
    const tabs = [
      tab({ id: 3, index: 0, pinned: true }),
      tab({ id: 1, index: 1, groupId: 7 }),
      tab({ id: 2, index: 2, groupId: 7 }),
    ];

    expect(plan(tabs, { kind: "tab", tabId: 3, placement: "after" })).toBeUndefined();
  });

  it.each([
    [{ kind: "tab", tabId: 30, placement: "before" } as const],
    [{ kind: "group", groupId: 9, placement: "before" } as const],
  ])("rejects a target in another window", (target) => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 30, windowId: 20, index: 0, groupId: 9 }),
    ];
    const groups = [source, group({ id: 9, windowId: 20 })];

    expect(plan(tabs, target, groups)).toBeUndefined();
  });

  it.each([
    { kind: "group", groupId: 7, placement: "before" } as const,
    { kind: "tab", tabId: 1, placement: "after" } as const,
  ])("rejects the source group title or one of its members as target", (target) => {
    const tabs = [
      tab({ id: 1, index: 0, groupId: 7 }),
      tab({ id: 2, index: 1, groupId: 7 }),
      tab({ id: 3, index: 2 }),
    ];

    expect(plan(tabs, target)).toBeUndefined();
  });

  it("rejects a source group without members", () => {
    expect(plan([tab({ id: 3 })], { kind: "tab", tabId: 3, placement: "before" }))
      .toBeUndefined();
  });

  it("rejects missing source groups and missing targets", () => {
    const tabs = [tab({ id: 1, index: 0, groupId: 7 }), tab({ id: 2, index: 1 })];

    expect(createTabGroupReorderPlan(
      tabs,
      [targetGroup],
      7,
      { kind: "tab", tabId: 2, placement: "before" },
    )).toBeUndefined();
    expect(plan(tabs, { kind: "tab", tabId: 999, placement: "before" })).toBeUndefined();
    expect(plan(tabs, { kind: "group", groupId: 999, placement: "before" }))
      .toBeUndefined();
  });

  it.each([
    [
      [
        tab({ id: 1, index: 0, groupId: 7 }),
        tab({ id: 2, index: 1, groupId: 7 }),
        tab({ id: 3, index: 2, groupId: 8 }),
      ],
      { kind: "group", groupId: 8, placement: "before" } as const,
    ],
    [
      [
        tab({ id: 3, index: 0, groupId: 8 }),
        tab({ id: 1, index: 1, groupId: 7 }),
        tab({ id: 2, index: 2, groupId: 7 }),
      ],
      { kind: "group", groupId: 8, placement: "after" } as const,
    ],
  ])("returns no plan when the group is already at the requested adjacent boundary", (tabs, target) => {
    expect(plan(tabs, target)).toBeUndefined();
  });

  it("computes one block move that preserves source member order", () => {
    const tabs = [
      tab({ id: 30, index: 0 }),
      tab({ id: 11, index: 1, groupId: 7 }),
      tab({ id: 12, index: 2, groupId: 7 }),
      tab({ id: 13, index: 3, groupId: 7 }),
      tab({ id: 40, index: 4 }),
    ];
    const result = plan(tabs, { kind: "tab", tabId: 30, placement: "before" });
    const sourceMembers = tabs.filter((item) => item.groupId === 7);
    const remainingTabs = tabs.filter((item) => item.groupId !== 7);

    expect(result).toEqual({ groupId: 7, targetIndex: 0, windowId: 10 });
    remainingTabs.splice(result?.targetIndex ?? -1, 0, ...sourceMembers);
    expect(remainingTabs.map((item) => item.id)).toEqual([11, 12, 13, 30, 40]);
  });

  it("reads indices a linear number of times for 500 tabs", () => {
    let indexReads = 0;
    const tabs = Array.from({ length: 500 }, (_, index) => {
      const model = tab({ id: index + 1, index, groupId: index < 5 ? 7 : -1 });
      Object.defineProperty(model, "index", {
        enumerable: true,
        get() {
          indexReads += 1;
          return index;
        },
      });
      return model;
    }).reverse();

    expect(plan(tabs, { kind: "tab", tabId: 500, placement: "after" })).toEqual({
      groupId: 7,
      targetIndex: 495,
      windowId: 10,
    });
    expect(indexReads).toBeLessThan(4_000);
  });
});
