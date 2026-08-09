import type { TabGroupColor, TabGroupViewModel } from "./tab-group-model";
import type { TabViewModel } from "./tab-model";
import {
  buildTabForest,
  flattenVisibleTabForest,
  type TabTreeNode,
} from "./tab-tree-model";

export type TabGroupDecoration = {
  groupId: number;
  color: TabGroupColor;
  position: "first" | "middle" | "last" | "single";
};

export type TabListItem =
  | {
      kind: "tab";
      tab: TabViewModel;
      group?: TabGroupDecoration;
      tree?: TabTreeDecoration;
    }
  | { kind: "group"; group: TabGroupViewModel; count: number };

export type TabTreeDecoration = {
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  containsActiveDescendant: boolean;
};

export type TabListOptions = {
  treeEnabled?: boolean;
  collapsedTabIds?: ReadonlySet<number>;
  detachedTabIds?: ReadonlySet<number>;
  attachedTabParentIds?: ReadonlyMap<number, number>;
};

export function buildTabListItems(
  tabs: readonly TabViewModel[],
  groups: readonly TabGroupViewModel[],
  options: TabListOptions = {},
): TabListItem[] {
  if (options.treeEnabled) return buildTreeTabListItems(tabs, groups, options);
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
    if (group) {
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
      items.push({ kind: "group", group, count: memberCounts.get(group.id) ?? 0 });
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

function buildTreeTabListItems(
  tabs: readonly TabViewModel[],
  groups: readonly TabGroupViewModel[],
  options: TabListOptions,
): TabListItem[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const orderedTabs = [...tabs].sort(compareTabs);
  const items: TabListItem[] = orderedTabs
    .filter((tab) => tab.pinned)
    .map((tab) => ({
      kind: "tab" as const,
      tab,
      tree: {
        depth: 0,
        hasChildren: false,
        collapsed: false,
        containsActiveDescendant: false,
      },
    }));
  const forest = buildTabForest(
    orderedTabs.filter((tab) => !tab.pinned),
    options.detachedTabIds,
    options.attachedTabParentIds,
  );
  const groupedRoots = new Map<number, TabTreeNode[]>();
  const units: Array<
    | { kind: "tree"; root: TabTreeNode; index: number }
    | { kind: "group"; groupId: number; index: number }
  > = [];

  for (const root of forest) {
    const group = groupsById.get(root.tab.groupId);
    if (!group) {
      units.push({ kind: "tree", root, index: root.tab.index });
      continue;
    }
    const roots = groupedRoots.get(group.id);
    if (roots) roots.push(root);
    else {
      groupedRoots.set(group.id, [root]);
      units.push({ kind: "group", groupId: group.id, index: root.tab.index });
    }
  }
  units.sort((left, right) => left.index - right.index);

  for (const unit of units) {
    if (unit.kind === "tree") {
      appendTreeEntries(items, [unit.root], options.collapsedTabIds ?? new Set());
      continue;
    }
    const group = groupsById.get(unit.groupId);
    const roots = groupedRoots.get(unit.groupId) ?? [];
    if (!group) continue;
    const count = countNodes(roots);
    items.push({ kind: "group", group, count });
    if (group.collapsed) continue;
    const entries = flattenVisibleTabForest(roots, options.collapsedTabIds ?? new Set());
    entries.forEach((entry, index) => {
      const position = entries.length === 1
        ? "single"
        : index === 0
          ? "first"
          : index === entries.length - 1
            ? "last"
            : "middle";
      items.push({
        kind: "tab",
        tab: entry.tab,
        group: { groupId: group.id, color: group.color, position },
        tree: {
          depth: entry.depth,
          hasChildren: entry.hasChildren,
          collapsed: entry.collapsed,
          containsActiveDescendant: entry.containsActiveDescendant,
        },
      });
    });
  }
  return items;
}

function appendTreeEntries(
  items: TabListItem[],
  roots: readonly TabTreeNode[],
  collapsedTabIds: ReadonlySet<number>,
): void {
  for (const entry of flattenVisibleTabForest(roots, collapsedTabIds)) {
    items.push({
      kind: "tab",
      tab: entry.tab,
      tree: {
        depth: entry.depth,
        hasChildren: entry.hasChildren,
        collapsed: entry.collapsed,
        containsActiveDescendant: entry.containsActiveDescendant,
      },
    });
  }
}

function countNodes(roots: readonly TabTreeNode[]): number {
  let count = 0;
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    count += 1;
    stack.push(...node.children);
  }
  return count;
}

function compareTabs(left: TabViewModel, right: TabViewModel): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return left.index - right.index || left.id - right.id;
}
