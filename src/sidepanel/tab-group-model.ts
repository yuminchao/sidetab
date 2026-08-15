export const TAB_GROUP_ID_NONE = -1;

export function isValidTabGroupId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isValidTabGroupMembershipId(value: unknown): value is number {
  return value === TAB_GROUP_ID_NONE || isValidTabGroupId(value);
}

export function normalizeTabGroupId(value: unknown): number {
  return isValidTabGroupMembershipId(value) ? value : TAB_GROUP_ID_NONE;
}

export type TabGroupColor = chrome.tabGroups.TabGroup["color"];

export const TAB_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const satisfies readonly TabGroupColor[];

export type TabGroupViewModel = {
  id: number;
  windowId: number;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
};

export function toTabGroupViewModel(
  group: chrome.tabGroups.TabGroup,
): TabGroupViewModel {
  if (!isValidTabGroupId(group.id)) {
    throw new Error("标签组缺少 ID");
  }

  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title?.trim() ?? "",
    color: group.color,
    collapsed: group.collapsed,
  };
}
