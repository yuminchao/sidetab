import type { TabDropTarget } from "./tab-reorder-model";

export type TabDropIntent = {
  sourceId: number;
  target: TabDropTarget;
};

export function createTabDragController(
  { list }: { list: HTMLElement },
  { onDrop }: { onDrop(intent: TabDropIntent): void },
) {
  let sourceId: number | undefined;
  let sourceRow: HTMLElement | undefined;
  let targetElement: HTMLElement | undefined;

  const rowFrom = (target: EventTarget | null): HTMLElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-row[data-tab-id]");
    return row && list.contains(row) ? row : undefined;
  };

  const idFrom = (row: HTMLElement): number | undefined => {
    const id = Number(row.dataset.tabId);
    return Number.isInteger(id) ? id : undefined;
  };

  const groupFrom = (target: EventTarget | null): HTMLElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-group-row[data-group-id]");
    return row && list.contains(row) ? row : undefined;
  };

  const groupIdFrom = (row: HTMLElement): number | undefined => {
    const groupId = Number(row.dataset.groupId);
    return Number.isSafeInteger(groupId) && groupId >= 0 ? groupId : undefined;
  };

  const clearTarget = (): void => {
    targetElement?.removeAttribute("data-drop-placement");
    targetElement?.removeAttribute("data-drop-target");
    targetElement = undefined;
  };

  const clear = (): void => {
    clearTarget();
    sourceRow?.removeAttribute("data-drag-source");
    sourceRow = undefined;
    sourceId = undefined;
  };

  const hasActiveSource = (): boolean => Boolean(sourceRow && list.contains(sourceRow));

  const onDragStart = (event: DragEvent): void => {
    const row = rowFrom(event.target);
    const fromClose = event.target instanceof Element && Boolean(event.target.closest(".tab-close"));
    if (!row?.draggable || fromClose) {
      event.preventDefault();
      return;
    }
    const id = idFrom(row);
    if (id === undefined) {
      event.preventDefault();
      return;
    }
    sourceId = id;
    sourceRow = row;
    row.dataset.dragSource = "true";
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(id));
    }
  };

  const onDragOver = (event: DragEvent): void => {
    if (!hasActiveSource()) {
      clear();
      return;
    }
    const row = rowFrom(event.target);
    const targetId = row ? idFrom(row) : undefined;
    const group = groupFrom(event.target);
    const groupId = group ? groupIdFrom(group) : undefined;
    if (sourceId === undefined || (targetId === sourceId) || (!row && !group)) {
      clearTarget();
      return;
    }
    if ((row && targetId === undefined) || (group && groupId === undefined)) {
      clearTarget();
      return;
    }
    event.preventDefault();
    const nextTarget = row ?? group!;
    if (targetElement !== nextTarget) clearTarget();
    targetElement = nextTarget;
    if (row) {
      const bounds = row.getBoundingClientRect();
      row.dataset.dropPlacement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    } else {
      group!.dataset.dropTarget = "true";
    }
  };

  const onDropEvent = (event: DragEvent): void => {
    const row = rowFrom(event.target);
    const targetId = row ? idFrom(row) : undefined;
    const placement = row?.dataset.dropPlacement;
    const group = groupFrom(event.target);
    const groupId = group ? groupIdFrom(group) : undefined;
    let target: TabDropTarget | undefined;
    if (targetId !== undefined && sourceId !== targetId && (placement === "before" || placement === "after")) {
      target = { kind: "tab", tabId: targetId, placement };
    } else if (groupId !== undefined && group?.dataset.dropTarget === "true") {
      target = { kind: "group", groupId };
    }
    if (hasActiveSource() && sourceId !== undefined && target) {
      event.preventDefault();
      onDrop({ sourceId, target });
    }
    clear();
  };

  const onDragEnd = (): void => clear();
  const onDragLeave = (event: DragEvent): void => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !list.contains(nextTarget)) {
      clear();
    }
  };
  const onScroll = (): void => clear();
  list.addEventListener("dragstart", onDragStart);
  list.addEventListener("dragover", onDragOver);
  list.addEventListener("drop", onDropEvent);
  list.addEventListener("dragend", onDragEnd);
  list.addEventListener("dragleave", onDragLeave);
  list.addEventListener("scroll", onScroll);

  return {
    cancel: clear,
    destroy(): void {
      clear();
      list.removeEventListener("dragstart", onDragStart);
      list.removeEventListener("dragover", onDragOver);
      list.removeEventListener("drop", onDropEvent);
      list.removeEventListener("dragend", onDragEnd);
      list.removeEventListener("dragleave", onDragLeave);
      list.removeEventListener("scroll", onScroll);
    },
  };
}
