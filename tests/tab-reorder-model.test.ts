import { describe, expect, it } from "vitest";
import { createTabReorderPlan } from "../src/sidepanel/tab-reorder-model";
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
    ...overrides,
  };
}

describe("createTabReorderPlan", () => {
  it("uses the Chrome-index-sorted snapshot when indexes are non-contiguous", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 10 }),
      fakeTabModel({ id: 2, index: 2, pinned: true }),
      fakeTabModel({ id: 3, index: 30 }),
      fakeTabModel({ id: 4, index: 5, pinned: true }),
    ];

    expect(createTabReorderPlan(tabs, 3, 4, "before")).toEqual({
      tabId: 3,
      targetIndex: 1,
      targetPinned: true,
      pinnedChanged: true,
    });
  });

  it("breaks equal Chrome-index ties by ID regardless of input order", () => {
    const tabs = [
      fakeTabModel({ id: 3, index: 0 }),
      fakeTabModel({ id: 2, index: 0 }),
      fakeTabModel({ id: 1, index: 1 }),
    ];

    expect(createTabReorderPlan(tabs, 1, 2, "before")).toEqual({
      tabId: 1,
      targetIndex: 0,
      targetPinned: false,
      pinnedChanged: false,
    });
  });

  it.each([
    ["downward", 1, 2, "after", 1],
    ["upward", 3, 2, "before", 1],
  ] as const)("reorders within an unpinned group moving %s", (_direction, sourceId, targetId, placement, targetIndex) => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, sourceId, targetId, placement)).toEqual({
      tabId: sourceId,
      targetIndex,
      targetPinned: false,
      pinnedChanged: false,
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

    expect(createTabReorderPlan(tabs, sourceId, targetId, placement)).toEqual({
      tabId: sourceId,
      targetIndex,
      targetPinned: false,
      pinnedChanged: false,
    });
  });

  it("keeps a tab pinned when it is placed after the final pinned tab", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 2, index: 1, pinned: true }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, 1, 2, "after")).toEqual({
      tabId: 1,
      targetIndex: 1,
      targetPinned: true,
      pinnedChanged: false,
    });
  });

  it("makes a pinned tab unpinned when placed before the first unpinned tab", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, 1, 2, "before")).toEqual({
      tabId: 1,
      targetIndex: 0,
      targetPinned: false,
      pinnedChanged: true,
    });
  });

  it("does not mutate the supplied tab snapshot", () => {
    const tabs = [
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 3, index: 2 }),
    ];
    const original = structuredClone(tabs);

    createTabReorderPlan(tabs, 3, 1, "before");

    expect(tabs).toEqual(original);
  });

  it.each([
    ["source and target match", 1, 1, "before"],
    ["source is missing", 99, 1, "before"],
    ["target is missing", 1, 99, "before"],
    ["before the directly following tab", 1, 2, "before"],
    ["after the directly preceding tab", 2, 1, "after"],
  ] as const)("returns undefined when %s", (_reason, sourceId, targetId, placement) => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];

    expect(createTabReorderPlan(tabs, sourceId, targetId, placement)).toBeUndefined();
  });
});
