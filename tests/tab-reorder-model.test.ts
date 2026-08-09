import { describe, expect, it } from "vitest";
import {
  createTabBlockReorderPlan,
  createTabReorderPlan,
  type TabDropTarget,
} from "../src/sidepanel/tab-reorder-model";
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

const tabTarget = (tabId: number, placement: "before" | "after"): TabDropTarget => ({
  kind: "tab",
  tabId,
  placement,
});

const groupTarget = (groupId: number): TabDropTarget => ({ kind: "group", groupId });

describe("createTabReorderPlan", () => {
  it("moves a tab or subtree block to the ungrouped list tail", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, 1, { kind: "end" })).toMatchObject({
      tabId: 1,
      targetIndex: 2,
      targetGroupId: -1,
    });
    expect(createTabBlockReorderPlan(tabs, [1, 2], { kind: "end" })).toMatchObject({
      tabIds: [1, 2],
      targetIndex: 1,
      targetGroupId: -1,
    });
  });
  it("computes a destination after removing an entire source subtree", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
      fakeTabModel({ id: 4, index: 3 }),
    ];
    expect(createTabBlockReorderPlan(tabs, [1, 2], {
      kind: "tab",
      tabId: 4,
      placement: "after",
    })).toMatchObject({ tabIds: [1, 2], targetIndex: 2 });
  });
  it("uses the Chrome-index-sorted snapshot when indexes are non-contiguous", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 10 }),
      fakeTabModel({ id: 2, index: 2, pinned: true }),
      fakeTabModel({ id: 3, index: 30 }),
      fakeTabModel({ id: 4, index: 5, pinned: true }),
    ];

    expect(createTabReorderPlan(tabs, 3, tabTarget(4, "before"))).toEqual({
      tabId: 3,
      targetIndex: 1,
      targetPinned: true,
      pinnedChanged: true,
      sourceGroupId: -1,
      targetGroupId: -1,
      groupChanged: false,
    });
  });

  it("breaks equal Chrome-index ties by ID regardless of input order", () => {
    const tabs = [
      fakeTabModel({ id: 3, index: 0 }),
      fakeTabModel({ id: 2, index: 0 }),
      fakeTabModel({ id: 1, index: 1 }),
    ];

    expect(createTabReorderPlan(tabs, 1, tabTarget(2, "before"))).toEqual({
      tabId: 1,
      targetIndex: 0,
      targetPinned: false,
      pinnedChanged: false,
      sourceGroupId: -1,
      targetGroupId: -1,
      groupChanged: false,
    });
  });

  it.each([
    ["downward", 1, 2, "after", 1],
    ["upward", 3, 2, "before", 1],
  ] as const)("reorders within an unpinned group moving %s", (_direction, sourceId, targetId, placement, targetIndex) => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, groupId: 7 }),
      fakeTabModel({ id: 2, index: 1, groupId: 7 }),
      fakeTabModel({ id: 3, index: 2, groupId: 7 }),
    ];

    expect(createTabReorderPlan(tabs, sourceId, tabTarget(targetId, placement))).toEqual({
      tabId: sourceId,
      targetIndex,
      targetPinned: false,
      pinnedChanged: false,
      sourceGroupId: 7,
      targetGroupId: 7,
      groupChanged: false,
    });
  });

  it.each([
    ["first", 2, 1, "before", 0],
    ["last", 2, 3, "after", 2],
  ] as const)("plans a move to the %s of the tab strip", (_edge, sourceId, targetId, placement, targetIndex) => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, sourceId, tabTarget(targetId, placement))).toEqual({
      tabId: sourceId,
      targetIndex,
      targetPinned: false,
      pinnedChanged: false,
      sourceGroupId: -1,
      targetGroupId: -1,
      groupChanged: false,
    });
  });

  it("keeps a tab pinned when it is placed after the final pinned tab", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 2, index: 1, pinned: true }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, 1, tabTarget(2, "after"))).toEqual({
      tabId: 1,
      targetIndex: 1,
      targetPinned: true,
      pinnedChanged: false,
      sourceGroupId: -1,
      targetGroupId: -1,
      groupChanged: false,
    });
  });

  it("makes a pinned tab unpinned when placed before the first unpinned tab", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, 1, tabTarget(2, "before"))).toEqual({
      tabId: 1,
      targetIndex: 0,
      targetPinned: false,
      pinnedChanged: true,
      sourceGroupId: -1,
      targetGroupId: -1,
      groupChanged: false,
    });
  });

  it("changes membership when a tab is moved across groups", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, groupId: 7 }),
      fakeTabModel({ id: 2, index: 1, groupId: 8 }),
      fakeTabModel({ id: 3, index: 2, groupId: 8 }),
    ];

    expect(createTabReorderPlan(tabs, 1, tabTarget(3, "after"))).toEqual({
      tabId: 1,
      targetIndex: 2,
      targetPinned: false,
      pinnedChanged: false,
      sourceGroupId: 7,
      targetGroupId: 8,
      groupChanged: true,
    });
  });

  it("places a tab at the end of a group using the full Chrome tab order", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2, groupId: 7 }),
      fakeTabModel({ id: 4, index: 3, groupId: 7 }),
    ];

    expect(createTabReorderPlan(tabs, 1, groupTarget(7))).toEqual({
      tabId: 1,
      targetIndex: 3,
      targetPinned: false,
      pinnedChanged: false,
      sourceGroupId: -1,
      targetGroupId: 7,
      groupChanged: true,
    });
  });

  it.each([
    ["removes a grouped tab", fakeTabModel({ id: 1, index: 0, groupId: 7 }), fakeTabModel({ id: 2, index: 1 }), false, -1],
    ["moves a pinned tab into a group", fakeTabModel({ id: 1, index: 0, pinned: true }), fakeTabModel({ id: 2, index: 1, groupId: 7 }), false, 7],
    ["moves a grouped tab into pinned tabs", fakeTabModel({ id: 1, index: 1, groupId: 7 }), fakeTabModel({ id: 2, index: 0, pinned: true }), true, -1],
  ] as const)("%s", (_name, source, target, targetPinned, targetGroupId) => {
    const plan = createTabReorderPlan([source, target], source.id, tabTarget(target.id, "after"));

    expect(plan).toMatchObject({
      tabId: source.id,
      targetPinned,
      pinnedChanged: source.pinned !== targetPinned,
      sourceGroupId: source.groupId,
      targetGroupId,
      groupChanged: source.groupId !== targetGroupId,
    });
  });

  it("does not mutate the supplied tab snapshot", () => {
    const tabs = [
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 3, index: 2 }),
    ];
    const original = structuredClone(tabs);

    createTabReorderPlan(tabs, 3, tabTarget(1, "before"));

    expect(tabs).toEqual(original);
  });

  it.each([
    ["source and target match", 1, tabTarget(1, "before")],
    ["source is missing", 99, tabTarget(1, "before")],
    ["target is missing", 1, tabTarget(99, "before")],
    ["target group is missing", 1, groupTarget(99)],
    ["before the directly following tab", 1, tabTarget(2, "before")],
    ["after the directly preceding tab", 2, tabTarget(1, "after")],
  ] as const)("returns undefined when %s", (_reason, sourceId, target) => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, sourceId, target)).toBeUndefined();
  });
});
