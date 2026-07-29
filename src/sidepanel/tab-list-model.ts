import type { TabGroupViewModel } from "./tab-group-model";
import type { TabViewModel } from "./tab-model";

export type TabListItem =
  | { kind: "tab"; tab: TabViewModel }
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
      items.push({ kind: "tab", tab });
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
