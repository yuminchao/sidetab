import type { TabViewModel } from "./tab-model";
import type { TabDropTarget, TabTreeDropPlacement } from "./tab-reorder-model";

export type TabTreeDropRequest =
  | {
      relation: "sibling";
      target: Exclude<TabDropTarget, { kind: "group" }>;
    }
  | { relation: "child"; parentId: number };

export type TabTreeDropResolver = (
  request: TabTreeDropRequest,
) => TabDropTarget | undefined;

type TreeFrame = {
  id: number;
  depth: number;
  exiting: boolean;
};

/**
 * 为一次标签树拖动建立快照解析器，后续每次命中只执行常数次索引查询。
 *
 * @param tabs 当前窗口标签快照。
 * @param sourceId 被拖动子树的根标签 ID。
 * @param _collapsedTabIds 保留的兼容参数；完整子树排序不受折叠状态影响。
 * @param detachedTabIds 被显式提升为根节点的标签 ID。
 * @param attachedTabParentIds 被显式指定父节点的标签关系。
 * @returns 将同级或子节点意图转换为真实排序锚点的解析器。
 */
export function createTabTreeDropResolver(
  tabs: readonly TabViewModel[],
  sourceId: number,
  _collapsedTabIds: ReadonlySet<number> = new Set(),
  detachedTabIds: ReadonlySet<number> = new Set(),
  attachedTabParentIds: ReadonlyMap<number, number> = new Map(),
): TabTreeDropResolver {
  const orderedTabs = [...tabs].sort((left, right) =>
    left.index - right.index || left.id - right.id);
  const tabsById = new Map(orderedTabs.map((tab) => [tab.id, tab]));
  const source = tabsById.get(sourceId);
  if (!source || source.pinned || source.groupId >= 0) return () => undefined;

  const treeTabs = orderedTabs.filter((tab) => !tab.pinned && tab.groupId < 0);
  const fullParentById = new Map<number, number>();
  for (const child of treeTabs) {
    const parentId = attachedTabParentIds.get(child.id) ?? child.openerTabId;
    const parent = parentId === undefined ? undefined : tabsById.get(parentId);
    if (
      !parent
      || parent.id === child.id
      || parent.windowId !== child.windowId
      || parent.pinned
      || parent.groupId !== child.groupId
      || detachedTabIds.has(child.id)
    ) {
      continue;
    }
    fullParentById.set(child.id, parent.id);
  }
  removeCycleRelationships(fullParentById, treeTabs);

  const childrenById = new Map<number, number[]>();
  const rootIds: number[] = [];
  for (const item of treeTabs) childrenById.set(item.id, []);
  for (const item of treeTabs) {
    const parentId = fullParentById.get(item.id);
    if (parentId === undefined) rootIds.push(item.id);
    else childrenById.get(parentId)?.push(item.id);
  }

  const sourceIds = new Set<number>();
  let sourceSubtreeMaxDepth = 0;
  const sourceStack = [{ id: sourceId, depth: 0 }];
  while (sourceStack.length > 0) {
    const frame = sourceStack.pop()!;
    sourceIds.add(frame.id);
    sourceSubtreeMaxDepth = Math.max(sourceSubtreeMaxDepth, frame.depth);
    const children = childrenById.get(frame.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      sourceStack.push({ id: children[index]!, depth: frame.depth + 1 });
    }
  }

  const currentParentId = fullParentById.get(sourceId);
  const orderedIndexById = new Map(orderedTabs.map((tab, index) => [tab.id, index]));
  const nativeBoundaryPrefix = [0];
  for (const tab of orderedTabs) {
    const boundary = !sourceIds.has(tab.id) && (tab.pinned || tab.groupId >= 0) ? 1 : 0;
    nativeBoundaryPrefix.push((nativeBoundaryPrefix.at(-1) ?? 0) + boundary);
  }

  const sourceIndex = orderedIndexById.get(sourceId)!;
  const remainingTabs = orderedTabs.filter((tab) => !sourceIds.has(tab.id));
  const remainingIndexById = new Map(remainingTabs.map((tab, index) => [tab.id, index]));
  let currentInsertionIndex = 0;
  for (const tab of remainingTabs) {
    if ((orderedIndexById.get(tab.id) ?? 0) < sourceIndex) currentInsertionIndex += 1;
  }

  const parentById = new Map<number, number>();
  const depthById = new Map<number, number>();
  const subtreeEndById = new Map<number, number>();
  let lastVisitedId: number | undefined;
  const stack: TreeFrame[] = rootIds
    .filter((id) => !sourceIds.has(id))
    .reverse()
    .map((id) => ({ id, depth: 0, exiting: false }));
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.exiting) {
      subtreeEndById.set(frame.id, lastVisitedId ?? frame.id);
      continue;
    }
    depthById.set(frame.id, frame.depth);
    const parentId = fullParentById.get(frame.id);
    if (parentId !== undefined) parentById.set(frame.id, parentId);
    lastVisitedId = frame.id;
    stack.push({ ...frame, exiting: true });
    const children = childrenById.get(frame.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (sourceIds.has(children[index]!)) continue;
      stack.push({
        id: children[index]!,
        depth: frame.depth + 1,
        exiting: false,
      });
    }
  }

  const orderChanges = (target: Exclude<TabDropTarget, { kind: "group" }>): boolean => {
    if (target.kind === "end") return currentInsertionIndex !== remainingTabs.length;
    const targetIndex = remainingIndexById.get(target.tabId);
    if (targetIndex === undefined) return false;
    const insertionIndex = target.placement === "before" ? targetIndex : targetIndex + 1;
    return insertionIndex !== currentInsertionIndex;
  };

  const crossesNativeBoundary = (leftId: number, rightId: number): boolean => {
    const leftIndex = orderedIndexById.get(leftId);
    const rightIndex = orderedIndexById.get(rightId);
    if (leftIndex === undefined || rightIndex === undefined) return true;
    const start = Math.min(leftIndex, rightIndex) + 1;
    const end = Math.max(leftIndex, rightIndex);
    return (nativeBoundaryPrefix[end] ?? 0) - (nativeBoundaryPrefix[start] ?? 0) > 0;
  };

  const finish = (
    target: Exclude<TabDropTarget, { kind: "group" }>,
    tree: TabTreeDropPlacement,
  ): TabDropTarget | undefined => {
    if (!orderChanges(target) && tree.parentId === currentParentId) return undefined;
    return { ...target, tree };
  };

  const resolveSibling = (
    target: Extract<TabDropTarget, { kind: "tab" }>,
  ): TabDropTarget | undefined => {
    if (sourceIds.has(target.tabId)) return undefined;
    const reference = tabsById.get(target.tabId);
    const depth = depthById.get(target.tabId);
    if (
      !reference
      || depth === undefined
      || reference.pinned
      || reference.groupId >= 0
      || reference.windowId !== source.windowId
      || depth + sourceSubtreeMaxDepth > 4
    ) {
      return undefined;
    }
    const parentId = parentById.get(target.tabId);
    const anchorId = target.placement === "after"
      ? subtreeEndById.get(target.tabId) ?? target.tabId
      : target.tabId;
    if (crossesNativeBoundary(parentId ?? target.tabId, anchorId)) return undefined;
    return finish(
      { kind: "tab", tabId: anchorId, placement: target.placement },
      {
        relation: "sibling",
        referenceId: target.tabId,
        depth,
        ...(parentId === undefined ? {} : { parentId }),
      },
    );
  };

  const resolveChild = (parentId: number): TabDropTarget | undefined => {
    if (sourceIds.has(parentId)) return undefined;
    const parent = tabsById.get(parentId);
    const parentDepth = depthById.get(parentId);
    if (
      !parent
      || parentDepth === undefined
      || parent.pinned
      || parent.groupId >= 0
      || parent.windowId !== source.windowId
    ) {
      return undefined;
    }
    const depth = parentDepth + 1;
    if (depth + sourceSubtreeMaxDepth > 4) return undefined;
    const anchorId = subtreeEndById.get(parentId) ?? parentId;
    if (crossesNativeBoundary(parentId, anchorId)) return undefined;
    return finish(
      { kind: "tab", tabId: anchorId, placement: "after" },
      { relation: "child", referenceId: parentId, depth, parentId },
    );
  };

  return (request) => {
    if (request.relation === "child") return resolveChild(request.parentId);
    if (request.target.kind === "end") {
      if (sourceSubtreeMaxDepth > 4) return undefined;
      return finish({ kind: "end" }, { relation: "sibling", depth: 0 });
    }
    return resolveSibling(request.target);
  };
}

function removeCycleRelationships(
  parentById: Map<number, number>,
  orderedTabs: readonly TabViewModel[],
): void {
  const completed = new Set<number>();
  for (const item of orderedTabs) {
    if (completed.has(item.id)) continue;
    const path: number[] = [];
    const pathIndexById = new Map<number, number>();
    let currentId: number | undefined = item.id;
    while (currentId !== undefined && !completed.has(currentId)) {
      const cycleStart = pathIndexById.get(currentId);
      if (cycleStart !== undefined) {
        for (let index = cycleStart; index < path.length; index += 1) {
          parentById.delete(path[index]!);
        }
        break;
      }
      pathIndexById.set(currentId, path.length);
      path.push(currentId);
      currentId = parentById.get(currentId);
    }
    for (const id of path) completed.add(id);
  }
}
