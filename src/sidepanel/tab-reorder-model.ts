import type { TabViewModel } from "./tab-model";

export type DropPlacement = "before" | "after";

export type TabTreeDropPlacement = {
  depth: number;
  parentId?: number;
};

export type TabDropTarget =
  | {
      kind: "tab";
      tabId: number;
      placement: DropPlacement;
      tree?: TabTreeDropPlacement;
    }
  | { kind: "group"; groupId: number }
  | { kind: "end"; tree?: TabTreeDropPlacement };

export type TabReorderPlan = {
  tabId: number;
  targetIndex: number;
  targetPinned: boolean;
  pinnedChanged: boolean;
  sourceGroupId: number;
  targetGroupId: number;
  groupChanged: boolean;
};

export type TabBlockReorderPlan = Omit<TabReorderPlan, "tabId"> & {
  tabIds: [number, ...number[]];
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
  } else if (target.kind === "group") {
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
  } else {
    insertionIndex = tabsWithoutSource.length;
    targetPinned = false;
    targetGroupId = -1;
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

export function createTabBlockReorderPlan(
  tabs: readonly TabViewModel[],
  sourceIds: readonly number[],
  target: TabDropTarget,
): TabBlockReorderPlan | undefined {
  const uniqueSourceIds = [...new Set(sourceIds)];
  const sourceId = uniqueSourceIds[0];
  if (sourceId === undefined) return undefined;
  const base = createTabReorderPlan(tabs, sourceId, target);
  if (!base) return undefined;
  const sourceSet = new Set(uniqueSourceIds);
  const remaining = [...tabs]
    .sort((left, right) => left.index - right.index || left.id - right.id)
    .filter((tab) => !sourceSet.has(tab.id));
  let targetIndex: number;
  if (target.kind === "tab") {
    const index = remaining.findIndex((tab) => tab.id === target.tabId);
    if (index < 0) return undefined;
    targetIndex = target.placement === "before" ? index : index + 1;
  } else if (target.kind === "group") {
    let lastIndex = -1;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (remaining[index]?.groupId === target.groupId) {
        lastIndex = index;
        break;
      }
    }
    if (lastIndex < 0) return undefined;
    targetIndex = lastIndex + 1;
  } else {
    targetIndex = remaining.length;
  }
  return {
    tabIds: [sourceId, ...uniqueSourceIds.slice(1)],
    targetIndex,
    targetPinned: base.targetPinned,
    pinnedChanged: base.pinnedChanged,
    sourceGroupId: base.sourceGroupId,
    targetGroupId: base.targetGroupId,
    groupChanged: base.groupChanged,
  };
}
