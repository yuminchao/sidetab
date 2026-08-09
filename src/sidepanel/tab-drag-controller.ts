import type { GroupDropTarget } from "./tab-group-reorder-model";
import type { TabDropTarget } from "./tab-reorder-model";

export type TabDragIntent =
  | { kind: "tab"; sourceId: number; target: TabDropTarget }
  | { kind: "group"; sourceGroupId: number; target: GroupDropTarget };

export type TabDragController = {
  cancel(): void;
  cancelForGroup(groupId: number): void;
  destroy(): void;
};

type ActiveSource = {
  kind: "tab" | "group";
  id: number;
  row: HTMLElement;
};

type ActiveTarget = {
  intentTarget: TabDropTarget | GroupDropTarget;
  elements: HTMLElement[];
  feedback: HTMLElement;
  groupMarker?: HTMLElement;
};

type HoverTarget = {
  row: HTMLElement;
  placement?: "before" | "after";
};

type GroupDragHandlers = {
  canStartGroupDrag?(groupId: number): boolean;
  canDropTab?(sourceId: number, target: TabDropTarget): boolean;
  prepareTabDrag?(sourceId: number): (
    target: TabDropTarget,
    requestedDepth: number,
  ) => TabDropTarget | undefined;
  onDrop(intent: TabDragIntent): void;
};

export function createTabDragController(
  { list, viewport }: { list: HTMLElement; viewport: Window },
  {
    canStartGroupDrag = () => true,
    canDropTab = () => true,
    prepareTabDrag,
    onDrop,
  }: GroupDragHandlers,
): TabDragController {
  const scrollContainer = list.parentElement ?? list;
  let source: ActiveSource | undefined;
  let sourceElements: HTMLElement[] = [];
  let dropRows: HTMLElement[] = [];
  let dropTabRowsById = new Map<number, HTMLElement>();
  let target: ActiveTarget | undefined;
  let resolvePreparedTabTarget:
    | ReturnType<NonNullable<GroupDragHandlers["prepareTabDrag"]>>
    | undefined;
  let dragListBounds: DOMRect | undefined;
  let dragDirection: "ltr" | "rtl" = "ltr";

  const tabRowFrom = (eventTarget: EventTarget | null): HTMLElement | undefined => {
    if (!(eventTarget instanceof Element)) return undefined;
    const row = eventTarget.closest<HTMLElement>(".tab-row[data-tab-id]");
    return row && list.contains(row) ? row : undefined;
  };

  const groupRowFrom = (eventTarget: EventTarget | null): HTMLElement | undefined => {
    if (!(eventTarget instanceof Element)) return undefined;
    const row = eventTarget.closest<HTMLElement>(".tab-group-row[data-group-id]");
    return row && list.contains(row) ? row : undefined;
  };

  const tabIdFrom = (row: HTMLElement): number | undefined => {
    const rawId = row.dataset.tabId;
    if (!rawId?.trim()) return undefined;
    const id = Number(rawId);
    return Number.isInteger(id) ? id : undefined;
  };

  const groupIdFrom = (row: HTMLElement): number | undefined => {
    const rawGroupId = row.dataset.groupId;
    if (!rawGroupId?.trim()) return undefined;
    const groupId = Number(rawGroupId);
    return Number.isSafeInteger(groupId) && groupId >= 0 ? groupId : undefined;
  };

  const placementFrom = (row: HTMLElement, clientY: number): "before" | "after" => {
    const bounds = row.getBoundingClientRect();
    return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  };

  const findGroupRow = (groupId: number): HTMLElement | undefined =>
    Array.from(list.querySelectorAll<HTMLElement>(".tab-group-row[data-group-id]"))
      .find((row) => groupIdFrom(row) === groupId);

  const groupMembers = (groupId: number): HTMLElement[] =>
    Array.from(list.querySelectorAll<HTMLElement>(".tab-row[data-group-id]"))
      .filter((row) => groupIdFrom(row) === groupId);

  const gapTargetsFrom = (event: DragEvent): HoverTarget[] => {
    if (event.target !== list || dropRows.length < 2) return [];
    let low = 0;
    let high = dropRows.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const middleRow = dropRows[middle];
      if (!middleRow) return [];
      const bounds = middleRow.getBoundingClientRect();
      if (event.clientY < bounds.top) {
        high = middle - 1;
      } else if (event.clientY > bounds.bottom) {
        low = middle + 1;
      } else {
        return [];
      }
    }

    const previous = dropRows[high];
    const next = dropRows[low];
    if (!previous || !next) return [];
    const previousBounds = previous.getBoundingClientRect();
    const nextBounds = next.getBoundingClientRect();
    if (event.clientY < previousBounds.bottom || event.clientY > nextBounds.top) return [];

    const candidates = [
      { row: previous, placement: "after" as const, distance: event.clientY - previousBounds.bottom },
      { row: next, placement: "before" as const, distance: nextBounds.top - event.clientY },
    ];
    candidates.sort((left, right) => left.distance - right.distance);
    return candidates.map(({ row, placement }) => ({ row, placement }));
  };

  const clearTarget = (): void => {
    target?.feedback.removeAttribute("data-drop-placement");
    target?.feedback.removeAttribute("data-drop-depth");
    target?.feedback.style.removeProperty("--drop-depth-indent");
    target?.groupMarker?.removeAttribute("data-drop-target");
    target = undefined;
  };

  const clear = (): void => {
    clearTarget();
    for (const element of sourceElements) {
      element.removeAttribute("data-drag-source");
      element.removeAttribute("data-drag-group-source");
    }
    sourceElements = [];
    dropRows = [];
    dropTabRowsById.clear();
    resolvePreparedTabTarget = undefined;
    dragListBounds = undefined;
    source = undefined;
  };

  const hasActiveSource = (): boolean => {
    if (source && list.contains(source.row)) return true;
    clear();
    return false;
  };

  const hasActiveTarget = (): boolean => {
    if (target && target.elements.every((element) => list.contains(element))) return true;
    clearTarget();
    return false;
  };

  const setTarget = (next: ActiveTarget): void => {
    clearTarget();
    target = next;
    if (next.intentTarget.kind === "end") {
      next.feedback.dataset.dropPlacement = "after";
    } else if (next.intentTarget.kind === "tab" || "placement" in next.intentTarget) {
      next.feedback.dataset.dropPlacement = next.intentTarget.placement;
    }
    const tree = "tree" in next.intentTarget ? next.intentTarget.tree : undefined;
    if (tree) {
      next.feedback.dataset.dropDepth = String(tree.depth);
      next.feedback.style.setProperty("--drop-depth-indent", `${4 + tree.depth * 12}px`);
    }
    if (next.groupMarker) next.groupMarker.dataset.dropTarget = "true";
  };

  const requestedDepthFrom = (clientX: number): number => {
    if (!dragListBounds) return 0;
    const inlineOffset = dragDirection === "rtl"
      ? dragListBounds.right - clientX
      : clientX - dragListBounds.left;
    return Math.max(0, Math.min(4, Math.round((inlineOffset - 4) / 12)));
  };

  const prepareTarget = (
    target: TabDropTarget,
    clientX: number,
  ): TabDropTarget | undefined => resolvePreparedTabTarget
    ? resolvePreparedTabTarget(target, requestedDepthFrom(clientX))
    : target;

  const treeParentElement = (intentTarget: TabDropTarget): HTMLElement | undefined => {
    const parentId = intentTarget.kind === "group" ? undefined : intentTarget.tree?.parentId;
    return parentId === undefined
      ? undefined
      : dropTabRowsById.get(parentId);
  };

  const groupTarget = (
    groupId: number,
    hoverRow: HTMLElement,
    clientY: number,
    placementOverride?: "before" | "after",
  ): ActiveTarget | undefined => {
    if (source?.kind !== "group" || groupId === source.id) return undefined;
    const header = findGroupRow(groupId);
    if (!header) return undefined;
    const placement = placementOverride ?? placementFrom(hoverRow, clientY);
    const members = groupMembers(groupId);
    const feedback = placement === "before" ? header : members.at(-1) ?? header;
    return {
      intentTarget: { kind: "group", groupId, placement },
      elements: [hoverRow, header, feedback],
      feedback,
      groupMarker: header,
    };
  };

  const resolveTarget = (event: DragEvent): ActiveTarget | undefined => {
    if (!source) return undefined;
    const directTabRow = tabRowFrom(event.target);
    const directGroupRow = groupRowFrom(event.target);
    let tailTarget: ActiveTarget | undefined;
    let tailHover: HoverTarget | undefined;
    if (source.kind === "tab" && event.target === list) {
      const lastRow = dropRows.at(-1);
      if (lastRow) {
        const distanceAfterLast = event.clientY - lastRow.getBoundingClientRect().bottom;
        if (distanceAfterLast > 4) {
          const intentTarget = prepareTarget({ kind: "end" }, event.clientX);
          if (intentTarget) {
            tailTarget = {
              intentTarget,
              elements: [list],
              feedback: list,
            };
          }
        } else if (distanceAfterLast >= 0) {
          tailHover = { row: lastRow, placement: "after" };
        }
      }
    }
    if (tailTarget) return tailTarget;
    const hoverTargets: HoverTarget[] = directTabRow
      ? [{ row: directTabRow }]
      : directGroupRow
        ? [{ row: directGroupRow }]
        : tailHover
          ? [tailHover]
          : gapTargetsFrom(event);

    for (const hoverTarget of hoverTargets) {
      const tabRow = hoverTarget.row.matches(".tab-row[data-tab-id]") ? hoverTarget.row : undefined;
      const groupRow = hoverTarget.row.matches(".tab-group-row[data-group-id]") ? hoverTarget.row : undefined;

      if (source.kind === "tab") {
        if (tabRow) {
          const tabId = tabIdFrom(tabRow);
          if (tabId === undefined || tabId === source.id) continue;
          const placement = hoverTarget.placement ?? placementFrom(tabRow, event.clientY);
          const intentTarget = prepareTarget({ kind: "tab", tabId, placement }, event.clientX);
          if (!intentTarget) continue;
          const parentElement = treeParentElement(intentTarget);
          return {
            intentTarget,
            elements: parentElement ? [tabRow, parentElement] : [tabRow],
            feedback: tabRow,
          };
        }
        if (groupRow) {
          const groupId = groupIdFrom(groupRow);
          if (groupId === undefined) continue;
          return {
            intentTarget: { kind: "group", groupId },
            elements: [groupRow],
            feedback: groupRow,
            groupMarker: groupRow,
          };
        }
      } else {
        if (tabRow) {
          const tabId = tabIdFrom(tabRow);
          if (tabId === undefined || tabRow.dataset.pinned === "true") continue;
          if (tabRow.dataset.groupId !== undefined) {
            const groupId = groupIdFrom(tabRow);
            const groupedTarget = groupId === undefined
              ? undefined
              : groupTarget(groupId, tabRow, event.clientY, hoverTarget.placement);
            if (groupedTarget) return groupedTarget;
            continue;
          }
          const placement = hoverTarget.placement ?? placementFrom(tabRow, event.clientY);
          return {
            intentTarget: { kind: "tab", tabId, placement },
            elements: [tabRow],
            feedback: tabRow,
          };
        }
        if (groupRow) {
          const groupId = groupIdFrom(groupRow);
          const groupedTarget = groupId === undefined
            ? undefined
            : groupTarget(groupId, groupRow, event.clientY, hoverTarget.placement);
          if (groupedTarget) return groupedTarget;
        }
      }
    }
    return undefined;
  };

  const sameIntentTarget = (
    left: TabDropTarget | GroupDropTarget,
    right: TabDropTarget | GroupDropTarget,
  ): boolean => {
    if (left.kind !== right.kind) return false;
    if (left.kind === "tab" && right.kind === "tab") {
      const leftTree = "tree" in left ? left.tree : undefined;
      const rightTree = "tree" in right ? right.tree : undefined;
      return left.tabId === right.tabId
        && left.placement === right.placement
        && leftTree?.depth === rightTree?.depth
        && leftTree?.parentId === rightTree?.parentId;
    }
    if (left.kind === "end" && right.kind === "end") {
      return left.tree?.depth === right.tree?.depth;
    }
    if (left.kind !== "group" || right.kind !== "group") return false;
    const leftPlacement = "placement" in left ? left.placement : undefined;
    const rightPlacement = "placement" in right ? right.placement : undefined;
    return left.groupId === right.groupId && leftPlacement === rightPlacement;
  };

  const onDragStart = (event: DragEvent): void => {
    clear();
    const tabRow = tabRowFrom(event.target);
    const fromClose = event.target instanceof Element && Boolean(event.target.closest(".tab-close"));
    if (tabRow) {
      const id = tabIdFrom(tabRow);
      if (!tabRow.draggable || fromClose || id === undefined) {
        event.preventDefault();
        return;
      }
      source = { kind: "tab", id, row: tabRow };
      resolvePreparedTabTarget = prepareTabDrag?.(id);
      dragListBounds = list.getBoundingClientRect();
      dragDirection = getComputedStyle(list).direction === "rtl" ? "rtl" : "ltr";
      sourceElements = [tabRow];
      tabRow.dataset.dragSource = "true";
    } else {
      const groupRow = groupRowFrom(event.target);
      const id = groupRow ? groupIdFrom(groupRow) : undefined;
      if (!groupRow?.draggable || id === undefined || !canStartGroupDrag(id)) {
        event.preventDefault();
        return;
      }
      source = { kind: "group", id, row: groupRow };
      sourceElements = [groupRow, ...groupMembers(id)];
      for (const element of sourceElements) element.dataset.dragGroupSource = "true";
    }
    dropRows = Array.from(
      list.querySelectorAll<HTMLElement>(".tab-row[data-tab-id], .tab-group-row[data-group-id]"),
    );
    dropTabRowsById = new Map();
    for (const row of dropRows) {
      const tabId = tabIdFrom(row);
      if (tabId !== undefined) dropTabRowsById.set(tabId, row);
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", source.kind === "group" ? `group:${source.id}` : String(source.id));
    }
  };

  const onDragOver = (event: DragEvent): void => {
    if (!hasActiveSource()) return;
    const nextTarget = resolveTarget(event);
    if (!nextTarget) {
      clearTarget();
      return;
    }
    event.preventDefault();
    setTarget(nextTarget);
  };

  const onDropEvent = (event: DragEvent): void => {
    if (!hasActiveSource() || !hasActiveTarget()) {
      clear();
      return;
    }
    if (!source || !target) return;
    const dropTarget = resolveTarget(event);
    if (!dropTarget || !sameIntentTarget(target.intentTarget, dropTarget.intentTarget)) {
      clear();
      return;
    }
    const intent: TabDragIntent = source.kind === "tab"
      ? { kind: "tab", sourceId: source.id, target: target.intentTarget as TabDropTarget }
      : {
          kind: "group",
          sourceGroupId: source.id,
          target: target.intentTarget as GroupDropTarget,
        };
    if (intent.kind === "tab" && !canDropTab(intent.sourceId, intent.target)) {
      clear();
      return;
    }
    event.preventDefault();
    clear();
    onDrop(intent);
  };

  const onDragLeave = (event: DragEvent): void => {
    if (!(event.relatedTarget instanceof Node) || !list.contains(event.relatedTarget)) clear();
  };
  const onInterrupt = (): void => clear();

  list.addEventListener("dragstart", onDragStart);
  list.addEventListener("dragover", onDragOver);
  list.addEventListener("drop", onDropEvent);
  list.addEventListener("dragend", onInterrupt);
  list.addEventListener("dragleave", onDragLeave);
  scrollContainer.addEventListener("scroll", onInterrupt);
  viewport.addEventListener("resize", onInterrupt);

  return {
    cancel: clear,
    cancelForGroup(groupId): void {
      if (source?.kind === "group" && source.id === groupId) clear();
    },
    destroy(): void {
      clear();
      list.removeEventListener("dragstart", onDragStart);
      list.removeEventListener("dragover", onDragOver);
      list.removeEventListener("drop", onDropEvent);
      list.removeEventListener("dragend", onInterrupt);
      list.removeEventListener("dragleave", onDragLeave);
      scrollContainer.removeEventListener("scroll", onInterrupt);
      viewport.removeEventListener("resize", onInterrupt);
    },
  };
}
