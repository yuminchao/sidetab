import type { TabGroupViewModel } from "./tab-group-model";
import type { TabViewModel } from "./tab-model";

export type GroupDropTarget =
  | { kind: "tab"; tabId: number; placement: "before" | "after" }
  | { kind: "group"; groupId: number; placement: "before" | "after" };

export type TabGroupReorderPlan = {
  groupId: number;
  targetIndex: number;
  windowId: number;
};

type OrderedTab = {
  tab: TabViewModel;
  index: number;
};

type Block = {
  start: number;
  end: number;
};

function findGroupBlock(tabs: readonly OrderedTab[], groupId: number): Block | undefined {
  let start = -1;
  let end = -1;

  for (let position = 0; position < tabs.length; position += 1) {
    if (tabs[position]?.tab.groupId !== groupId) continue;
    if (start === -1) start = position;
    end = position;
  }

  if (start === -1) return undefined;
  for (let position = start; position <= end; position += 1) {
    if (tabs[position]?.tab.groupId !== groupId) return undefined;
  }

  return { start, end };
}

export function createTabGroupReorderPlan(
  tabs: readonly TabViewModel[],
  groups: readonly TabGroupViewModel[],
  sourceGroupId: number,
  target: GroupDropTarget,
): TabGroupReorderPlan | undefined {
  const source = groups.find((group) => group.id === sourceGroupId);
  if (!source) return undefined;

  const orderedTabs = tabs
    .filter((tab) => tab.windowId === source.windowId)
    .map((tab) => ({ tab, index: tab.index }))
    .sort((left, right) => left.index - right.index || left.tab.id - right.tab.id);
  const sourceBlock = findGroupBlock(orderedTabs, sourceGroupId);
  if (!sourceBlock) return undefined;

  let targetGroupId: number | undefined;
  let targetTabId: number | undefined;
  if (target.kind === "group") {
    if (target.groupId === sourceGroupId) return undefined;
    const targetGroup = groups.find((group) => group.id === target.groupId);
    if (!targetGroup || targetGroup.windowId !== source.windowId) return undefined;
    targetGroupId = targetGroup.id;
  } else {
    const targetTab = tabs.find((tab) => tab.id === target.tabId);
    if (
      !targetTab
      || targetTab.windowId !== source.windowId
      || targetTab.pinned
      || targetTab.groupId === sourceGroupId
    ) {
      return undefined;
    }

    if (targetTab.groupId >= 0) {
      const targetGroup = groups.find((group) => group.id === targetTab.groupId);
      if (!targetGroup || targetGroup.windowId !== source.windowId) return undefined;
      targetGroupId = targetGroup.id;
    } else {
      targetTabId = targetTab.id;
    }
  }

  const remainingTabs = orderedTabs.filter(
    (_tab, position) => position < sourceBlock.start || position > sourceBlock.end,
  );
  let targetBlock: Block | undefined;
  if (targetGroupId !== undefined) {
    targetBlock = findGroupBlock(remainingTabs, targetGroupId);
  } else {
    const position = remainingTabs.findIndex((item) => item.tab.id === targetTabId);
    if (position >= 0) targetBlock = { start: position, end: position };
  }
  if (!targetBlock) return undefined;

  const insertionIndex = target.placement === "before"
    ? targetBlock.start
    : targetBlock.end + 1;
  if (insertionIndex === sourceBlock.start) return undefined;

  return {
    groupId: sourceGroupId,
    targetIndex: insertionIndex,
    windowId: source.windowId,
  };
}
