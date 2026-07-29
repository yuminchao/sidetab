import type { TabViewModel } from "./tab-model";

export type DropPlacement = "before" | "after";

export type TabDropTarget =
  | { kind: "tab"; tabId: number; placement: DropPlacement }
  | { kind: "group"; groupId: number };

export type TabReorderPlan = {
  tabId: number;
  targetIndex: number;
  targetPinned: boolean;
  pinnedChanged: boolean;
  sourceGroupId: number;
  targetGroupId: number;
  groupChanged: boolean;
};

export function createTabReorderPlan(
  tabs: readonly TabViewModel[],
  sourceId: number,
  target: TabDropTarget,
): TabReorderPlan | undefined {
  const sortedTabs = [...tabs].sort((left, right) => left.index - right.index || left.id - right.id);
  const source = sortedTabs.find((tab) => tab.id === sourceId);
  if (!source) return undefined;

  const tabsWithoutSource = sortedTabs.filter((tab) => tab.id !== sourceId);
  let insertionIndex: number;
  let targetPinned: boolean;
  let targetGroupId: number;

  if (target.kind === "tab") {
    if (sourceId === target.tabId) return undefined;
    const targetTab = sortedTabs.find((tab) => tab.id === target.tabId);
    if (!targetTab) return undefined;
    const targetIndex = tabsWithoutSource.findIndex((tab) => tab.id === target.tabId);
    insertionIndex = target.placement === "before" ? targetIndex : targetIndex + 1;
    targetPinned = targetTab.pinned;
    targetGroupId = targetTab.groupId;
  } else {
    let lastGroupTab: TabViewModel | undefined;
    for (let index = tabsWithoutSource.length - 1; index >= 0; index -= 1) {
      const tab = tabsWithoutSource[index];
      if (tab?.groupId === target.groupId) {
        lastGroupTab = tab;
        break;
      }
    }
    if (!lastGroupTab) return undefined;
    insertionIndex = tabsWithoutSource.findIndex((tab) => tab.id === lastGroupTab.id) + 1;
    targetPinned = false;
    targetGroupId = target.groupId;
  }

  const sourceIndex = sortedTabs.findIndex((tab) => tab.id === sourceId);
  const pinnedChanged = source.pinned !== targetPinned;
  const groupChanged = source.groupId !== targetGroupId;

  if (sourceIndex === insertionIndex && !pinnedChanged && !groupChanged) {
    return undefined;
  }

  return {
    tabId: sourceId,
    targetIndex: insertionIndex,
    targetPinned,
    pinnedChanged,
    sourceGroupId: source.groupId,
    targetGroupId,
    groupChanged,
  };
}
