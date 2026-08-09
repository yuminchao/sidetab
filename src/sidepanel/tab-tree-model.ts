import type { TabViewModel } from "./tab-model";

export type TabTreeNode = {
  tab: TabViewModel;
  children: TabTreeNode[];
};

export type VisibleTabTreeEntry = {
  tab: TabViewModel;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  rootId: number;
};

export function buildTabForest(
  tabs: readonly TabViewModel[],
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): TabTreeNode[] {
  const orderedTabs = [...tabs].sort(compareTabs);
  const tabsById = new Map(orderedTabs.map((tab) => [tab.id, tab]));
  const parentById = new Map<number, number>();

  for (const child of orderedTabs) {
    const parentId = attachedTabParentIds.get(child.id) ?? child.openerTabId;
    const parent = parentId === undefined ? undefined : tabsById.get(parentId);
    if (
      !parent ||
      parent.id === child.id ||
      parent.windowId !== child.windowId ||
      parent.pinned ||
      child.pinned ||
      parent.groupId !== child.groupId ||
      detachedTabIds.has(child.id)
    ) {
      continue;
    }
    parentById.set(child.id, parent.id);
  }

  removeCycleRelationships(parentById, orderedTabs);

  const nodesById = new Map<number, TabTreeNode>();
  for (const tab of orderedTabs) nodesById.set(tab.id, { tab, children: [] });

  const roots: TabTreeNode[] = [];
  for (const tab of orderedTabs) {
    const node = nodesById.get(tab.id)!;
    const parent = nodesById.get(parentById.get(tab.id) ?? -1);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function flattenVisibleTabForest(
  forest: readonly TabTreeNode[],
  collapsedTabIds: ReadonlySet<number>,
): VisibleTabTreeEntry[] {
  const forcedOpen = findActiveAncestors(forest);
  const entries: VisibleTabTreeEntry[] = [];

  const visit = (node: TabTreeNode, depth: number, rootId: number): void => {
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && collapsedTabIds.has(node.tab.id) && !forcedOpen.has(node.tab.id);
    entries.push({ tab: node.tab, depth, hasChildren, collapsed, rootId });
    if (!collapsed) {
      for (const child of node.children) visit(child, depth + 1, rootId);
    }
  };

  for (const root of forest) visit(root, 0, root.tab.id);
  return entries;
}

export function getTabSubtreeIds(
  tabs: readonly TabViewModel[],
  sourceId: number,
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): number[] {
  const stack = [...buildTabForest(tabs, detachedTabIds, attachedTabParentIds)].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.tab.id === sourceId) {
      const ids: number[] = [];
      const descendants = [node];
      while (descendants.length > 0) {
        const current = descendants.pop();
        if (!current) continue;
        ids.push(current.tab.id);
        for (let index = current.children.length - 1; index >= 0; index -= 1) {
          descendants.push(current.children[index]!);
        }
      }
      return ids;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return [];
}

export function getTabTreeParentId(
  tabs: readonly TabViewModel[],
  childId: number,
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): number | undefined {
  const stack = [...buildTabForest(tabs, detachedTabIds, attachedTabParentIds)];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    for (const child of node.children) {
      if (child.tab.id === childId) return node.tab.id;
      stack.push(child);
    }
  }
  return undefined;
}

function removeCycleRelationships(
  parentById: Map<number, number>,
  orderedTabs: readonly TabViewModel[],
): void {
  const state = new Map<number, 1 | 2>();
  const stack: number[] = [];
  const stackIndexes = new Map<number, number>();
  const cycleIds = new Set<number>();

  const visit = (id: number): void => {
    if (state.has(id)) return;
    state.set(id, 1);
    stackIndexes.set(id, stack.length);
    stack.push(id);
    const parentId = parentById.get(id);
    if (parentId !== undefined) {
      if (state.get(parentId) === 1) {
        const cycleStart = stackIndexes.get(parentId) ?? stack.length;
        for (const cycleId of stack.slice(cycleStart)) cycleIds.add(cycleId);
      } else if (!state.has(parentId)) {
        visit(parentId);
      }
    }
    stack.pop();
    stackIndexes.delete(id);
    state.set(id, 2);
  };

  for (const tab of orderedTabs) visit(tab.id);
  for (const id of cycleIds) parentById.delete(id);
}

function findActiveAncestors(forest: readonly TabTreeNode[]): Set<number> {
  const ancestors = new Set<number>();
  const visit = (node: TabTreeNode): boolean => {
    let childContainsActive = false;
    for (const child of node.children) childContainsActive = visit(child) || childContainsActive;
    if (childContainsActive) ancestors.add(node.tab.id);
    return node.tab.active || childContainsActive;
  };
  for (const root of forest) visit(root);
  return ancestors;
}

function compareTabs(left: TabViewModel, right: TabViewModel): number {
  return left.index - right.index || left.id - right.id;
}
