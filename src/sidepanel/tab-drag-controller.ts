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

type GroupDragHandlers = {
  canStartGroupDrag?(groupId: number): boolean;
  onDrop(intent: TabDragIntent): void;
};

export function createTabDragController(
  { list, viewport }: { list: HTMLElement; viewport: Window },
  {
    canStartGroupDrag = () => true,
    onDrop,
  }: GroupDragHandlers,
): TabDragController {
  const scrollContainer = list.parentElement ?? list;
  let source: ActiveSource | undefined;
  let sourceElements: HTMLElement[] = [];
  let target: ActiveTarget | undefined;

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

  const clearTarget = (): void => {
    target?.feedback.removeAttribute("data-drop-placement");
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
    if (next.intentTarget.kind === "tab" || "placement" in next.intentTarget) {
      next.feedback.dataset.dropPlacement = next.intentTarget.placement;
    }
    if (next.groupMarker) next.groupMarker.dataset.dropTarget = "true";
  };

  const groupTarget = (
    groupId: number,
    hoverRow: HTMLElement,
    clientY: number,
  ): ActiveTarget | undefined => {
    if (source?.kind !== "group" || groupId === source.id) return undefined;
    const header = findGroupRow(groupId);
    if (!header) return undefined;
    const placement = placementFrom(hoverRow, clientY);
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
    const tabRow = tabRowFrom(event.target);
    const groupRow = groupRowFrom(event.target);

    if (source.kind === "tab") {
      if (tabRow) {
        const tabId = tabIdFrom(tabRow);
        if (tabId === undefined || tabId === source.id) return undefined;
        const placement = placementFrom(tabRow, event.clientY);
        return {
          intentTarget: { kind: "tab", tabId, placement },
          elements: [tabRow],
          feedback: tabRow,
        };
      }
      if (groupRow) {
        const groupId = groupIdFrom(groupRow);
        if (groupId === undefined) return undefined;
        return {
          intentTarget: { kind: "group", groupId },
          elements: [groupRow],
          feedback: groupRow,
          groupMarker: groupRow,
        };
      }
      return undefined;
    }

    if (tabRow) {
      const tabId = tabIdFrom(tabRow);
      if (tabId === undefined || tabRow.dataset.pinned === "true") return undefined;
      if (tabRow.dataset.groupId !== undefined) {
        const groupId = groupIdFrom(tabRow);
        return groupId === undefined ? undefined : groupTarget(groupId, tabRow, event.clientY);
      }
      const placement = placementFrom(tabRow, event.clientY);
      return {
        intentTarget: { kind: "tab", tabId, placement },
        elements: [tabRow],
        feedback: tabRow,
      };
    }
    if (groupRow) {
      const groupId = groupIdFrom(groupRow);
      return groupId === undefined ? undefined : groupTarget(groupId, groupRow, event.clientY);
    }
    return undefined;
  };

  const sameIntentTarget = (
    left: TabDropTarget | GroupDropTarget,
    right: TabDropTarget | GroupDropTarget,
  ): boolean => {
    if (left.kind !== right.kind) return false;
    if (left.kind === "tab" && right.kind === "tab") {
      return left.tabId === right.tabId && left.placement === right.placement;
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
