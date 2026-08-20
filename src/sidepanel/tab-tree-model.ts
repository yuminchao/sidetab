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
  containsActiveDescendant: boolean;
  rootId: number;
};

export function buildTabForest(
  tabs: readonly TabViewModel[],
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
  tabsAreOrdered = false,
): TabTreeNode[] {
  const orderedTabs = tabsAreOrdered ? tabs : [...tabs].sort(compareTabs);
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
  const activeAncestors = findActiveAncestors(forest);
  const entries: VisibleTabTreeEntry[] = [];
  const stack = forest
    .map((node) => ({ node, depth: 0, rootId: node.tab.id }))
    .reverse();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { node, depth, rootId } = current;
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && collapsedTabIds.has(node.tab.id);
    entries.push({
      tab: node.tab,
      depth,
      hasChildren,
      collapsed,
      containsActiveDescendant: activeAncestors.has(node.tab.id),
      rootId,
    });
    if (collapsed) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index]!, depth: depth + 1, rootId });
    }
  }
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

export function getTabSubtreeMaxDepth(
  tabs: readonly TabViewModel[],
  sourceId: number,
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): number {
  const stack = [...buildTabForest(tabs, detachedTabIds, attachedTabParentIds)];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.tab.id === sourceId) {
      let maximumDepth = 0;
      const descendants: Array<{ node: TabTreeNode; depth: number }> = [{ node, depth: 0 }];
      while (descendants.length > 0) {
        const current = descendants.pop();
        if (!current) continue;
        maximumDepth = Math.max(maximumDepth, current.depth);
        for (const child of current.node.children) {
          descendants.push({ node: child, depth: current.depth + 1 });
        }
      }
      return maximumDepth;
    }
    stack.push(...node.children);
  }
  return 0;
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

export function getTabTreeAncestorIds(
  tabs: readonly TabViewModel[],
  childId: number,
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): number[] {
  const parentById = new Map<number, number>();
  const stack = [...buildTabForest(tabs, detachedTabIds, attachedTabParentIds)];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    for (const child of node.children) {
      parentById.set(child.tab.id, node.tab.id);
      stack.push(child);
    }
  }
  const ancestors: number[] = [];
  let currentId = childId;
  while (parentById.has(currentId)) {
    const parentId = parentById.get(currentId);
    if (parentId === undefined) break;
    ancestors.push(parentId);
    currentId = parentId;
  }
  return ancestors;
}

function removeCycleRelationships(
  parentById: Map<number, number>,
  orderedTabs: readonly TabViewModel[],
): void {
  const visited = new Set<number>();
  const cycleIds = new Set<number>();

  for (const tab of orderedTabs) {
    if (visited.has(tab.id)) continue;
    const path: number[] = [];
    const pathIndexes = new Map<number, number>();
    let currentId: number | undefined = tab.id;
    while (currentId !== undefined && !visited.has(currentId)) {
      const cycleStart = pathIndexes.get(currentId);
      if (cycleStart !== undefined) {
        for (let index = cycleStart; index < path.length; index += 1) {
          cycleIds.add(path[index]!);
        }
        break;
      }
      pathIndexes.set(currentId, path.length);
      path.push(currentId);
      currentId = parentById.get(currentId);
    }
    for (const id of path) visited.add(id);
  }
  for (const id of cycleIds) parentById.delete(id);
}

function findActiveAncestors(forest: readonly TabTreeNode[]): Set<number> {
  const ancestors = new Set<number>();
  const parentById = new Map<number, number>();
  const activeTabIds: number[] = [];
  const stack = [...forest];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.tab.active) activeTabIds.push(node.tab.id);
    for (const child of node.children) {
      parentById.set(child.tab.id, node.tab.id);
      stack.push(child);
    }
  }
  for (const activeTabId of activeTabIds) {
    let currentId = parentById.get(activeTabId);
    while (currentId !== undefined) {
      ancestors.add(currentId);
      currentId = parentById.get(currentId);
    }
  }
  return ancestors;
}

function compareTabs(left: TabViewModel, right: TabViewModel): number {
  return left.index - right.index || left.id - right.id;
}
