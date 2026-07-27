import type { TabViewModel } from "./tab-model";

export type DropPlacement = "before" | "after";

export type TabReorderPlan = {
  tabId: number;
  targetIndex: number;
  targetPinned: boolean;
  pinnedChanged: boolean;
};

export function createTabReorderPlan(
  tabs: readonly TabViewModel[],
  sourceId: number,
  targetId: number,
  placement: DropPlacement,
): TabReorderPlan | undefined {
  if (sourceId === targetId) {
    return undefined;
  }

  const sortedTabs = [...tabs].sort((left, right) => left.index - right.index);
  const source = sortedTabs.find((tab) => tab.id === sourceId);
  const target = sortedTabs.find((tab) => tab.id === targetId);
  if (!source || !target) {
    return undefined;
  }

  const tabsWithoutSource = sortedTabs.filter((tab) => tab.id !== sourceId);
  const targetIndex = tabsWithoutSource.findIndex((tab) => tab.id === targetId);
  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
  const sourceIndex = sortedTabs.findIndex((tab) => tab.id === sourceId);
  const pinnedChanged = source.pinned !== target.pinned;

  if (sourceIndex === insertionIndex && !pinnedChanged) {
    return undefined;
  }

  return {
    tabId: sourceId,
    targetIndex: insertionIndex,
    targetPinned: target.pinned,
    pinnedChanged,
  };
}
