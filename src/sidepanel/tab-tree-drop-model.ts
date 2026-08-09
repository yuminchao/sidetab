import type { TabViewModel } from "./tab-model";
import type { TabDropTarget } from "./tab-reorder-model";
import {
  buildTabForest,
  flattenVisibleTabForest,
  getTabSubtreeIds,
  getTabSubtreeMaxDepth,
  getTabTreeParentId,
} from "./tab-tree-model";

export type TabTreeDropResolver = (
  target: TabDropTarget,
  requestedDepth: number,
) => TabDropTarget | undefined;

export function createTabTreeDropResolver(
  tabs: readonly TabViewModel[],
  sourceId: number,
  collapsedTabIds: ReadonlySet<number> = new Set(),
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): TabTreeDropResolver {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const source = tabsById.get(sourceId);
  if (!source || source.pinned || source.groupId >= 0) return () => undefined;

  const sourceIds = new Set(getTabSubtreeIds(
    tabs,
    sourceId,
    detachedTabIds,
    attachedTabParentIds,
  ));
  const sourceSubtreeMaxDepth = getTabSubtreeMaxDepth(
    tabs,
    sourceId,
    detachedTabIds,
    attachedTabParentIds,
  );
  const currentParentId = getTabTreeParentId(
    tabs,
    sourceId,
    detachedTabIds,
    attachedTabParentIds,
  );
  const orderedTabs = [...tabs].sort((left, right) =>
    left.index - right.index || left.id - right.id);
  const orderedIndexById = new Map(orderedTabs.map((tab, index) => [tab.id, index]));
  const nativeBoundaryPrefix = [0];
  for (const tab of orderedTabs) {
    const boundary = !sourceIds.has(tab.id) && (tab.pinned || tab.groupId >= 0) ? 1 : 0;
    nativeBoundaryPrefix.push((nativeBoundaryPrefix.at(-1) ?? 0) + boundary);
  }
  const sourceIndex = orderedIndexById.get(sourceId) ?? 0;
  const remainingTabs = orderedTabs.filter((tab) => !sourceIds.has(tab.id));
  const remainingIndexById = new Map(remainingTabs.map((tab, index) => [tab.id, index]));
  const currentInsertionIndex = remainingTabs.reduce(
    (count, tab) => count + ((orderedIndexById.get(tab.id) ?? 0) < sourceIndex ? 1 : 0),
    0,
  );
  const visible = flattenVisibleTabForest(
    buildTabForest(
      tabs.filter((tab) => !tab.pinned && tab.groupId < 0),
      detachedTabIds,
      attachedTabParentIds,
    ),
    collapsedTabIds,
  ).filter((entry) => !sourceIds.has(entry.tab.id));
  const indexById = new Map(visible.map((entry, index) => [entry.tab.id, index]));
  const parentsAtBoundary: Array<Array<number | undefined>> = [[]];
  const ancestorAtDepth: Array<number | undefined> = [];
  for (const entry of visible) {
    ancestorAtDepth[entry.depth] = entry.tab.id;
    ancestorAtDepth.length = entry.depth + 1;
    parentsAtBoundary.push(ancestorAtDepth.slice(0, 5));
  }

  const orderChanges = (target: TabDropTarget): boolean => {
    if (target.kind === "group") return true;
    if (target.kind === "end") return currentInsertionIndex !== remainingTabs.length;
    const targetIndex = remainingIndexById.get(target.tabId);
    if (targetIndex === undefined) return false;
    const insertionIndex = target.placement === "before" ? targetIndex : targetIndex + 1;
    return insertionIndex !== currentInsertionIndex;
  };

  const crossesNativeBoundary = (parentId: number, targetId: number): boolean => {
    const parentIndex = orderedIndexById.get(parentId);
    const targetIndex = orderedIndexById.get(targetId);
    if (parentIndex === undefined || targetIndex === undefined) return true;
    const start = Math.min(parentIndex, targetIndex) + 1;
    const end = Math.max(parentIndex, targetIndex);
    return (nativeBoundaryPrefix[end] ?? 0) - (nativeBoundaryPrefix[start] ?? 0) > 0;
  };

  const finish = (
    target: Exclude<TabDropTarget, { kind: "group" }>,
    depth: number,
    parentId?: number,
  ): TabDropTarget | undefined => {
    if (!orderChanges(target) && parentId === currentParentId) return undefined;
    return parentId === undefined
      ? { ...target, tree: { depth } }
      : { ...target, tree: { depth, parentId } };
  };

  return (target, requestedDepth) => {
    if (target.kind === "group") return target;
    if (target.kind === "end") {
      return finish({ kind: "end" }, 0);
    }
    if (sourceIds.has(target.tabId)) return undefined;
    const targetTab = tabsById.get(target.tabId);
    if (!targetTab || targetTab.pinned || targetTab.groupId >= 0) return undefined;
    const targetIndex = indexById.get(target.tabId);
    if (targetIndex === undefined) return undefined;

    const boundaryIndex = target.placement === "before" ? targetIndex : targetIndex + 1;
    const previousIndex = boundaryIndex - 1;
    const previous = visible[previousIndex];
    const maximumDepth = previous
      ? Math.min(4 - sourceSubtreeMaxDepth, previous.depth + 1)
      : 0;
    let depth = Math.max(0, Math.min(maximumDepth, Math.round(requestedDepth)));
    while (depth > 0) {
      const parentId = parentsAtBoundary[boundaryIndex]?.[depth - 1];
      const parent = parentId === undefined ? undefined : tabsById.get(parentId);
      if (
        parent
        && parent.windowId === source.windowId
        && parent.groupId === source.groupId
        && !crossesNativeBoundary(parent.id, target.tabId)
      ) {
        return finish(target, depth, parent.id);
      }
      depth -= 1;
    }
    return finish(target, 0);
  };
}
