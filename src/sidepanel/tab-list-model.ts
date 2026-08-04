import type { TabGroupColor, TabGroupViewModel } from "./tab-group-model";
import type { TabViewModel } from "./tab-model";

export type TabGroupDecoration = {
  groupId: number;
  color: TabGroupColor;
  position: "first" | "middle" | "last" | "single";
};

export type TabListItem =
  | { kind: "tab"; tab: TabViewModel; group?: TabGroupDecoration }
  | { kind: "group"; group: TabGroupViewModel };

export function buildTabListItems(
  tabs: readonly TabViewModel[],
  groups: readonly TabGroupViewModel[],
): TabListItem[] {
  const groupsById = new Map<number, TabGroupViewModel>();
  for (const group of groups) {
    groupsById.set(group.id, group);
  }

  const items: TabListItem[] = [];
  const emittedGroupIds = new Set<number>();
  const orderedTabs = [...tabs].sort(compareTabs);
  const memberCounts = new Map<number, number>();
  for (const tab of orderedTabs) {
    if (tab.pinned) continue;
    const group = groupsById.get(tab.groupId);
    if (group && !group.collapsed) {
      memberCounts.set(group.id, (memberCounts.get(group.id) ?? 0) + 1);
    }
  }
  const emittedMembers = new Map<number, number>();

  for (const tab of orderedTabs) {
    if (tab.pinned) {
      items.push({ kind: "tab", tab });
      continue;
    }

    const group = groupsById.get(tab.groupId);
    if (!group) {
      items.push({ kind: "tab", tab });
      continue;
    }

    if (!emittedGroupIds.has(group.id)) {
      emittedGroupIds.add(group.id);
      items.push({ kind: "group", group });
    }
    if (!group.collapsed) {
      const ordinal = (emittedMembers.get(group.id) ?? 0) + 1;
      emittedMembers.set(group.id, ordinal);
      const count = memberCounts.get(group.id) ?? 0;
      const position = count === 1
        ? "single"
        : ordinal === 1
          ? "first"
          : ordinal === count
            ? "last"
            : "middle";
      items.push({
        kind: "tab",
        tab,
        group: { groupId: group.id, color: group.color, position },
      });
    }
  }

  return items;
}

function compareTabs(left: TabViewModel, right: TabViewModel): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return left.index - right.index || left.id - right.id;
}
