export function createTabMiddleClickController(
  { list }: { list: HTMLElement },
  { onClose }: { onClose(tabId: number): void },
) {
  const tabIdFrom = (target: EventTarget | null): number | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-row[data-tab-id]");
    if (!row || !list.contains(row)) return undefined;
    const rawTabId = row.dataset.tabId;
    if (!rawTabId?.trim()) return undefined;
    const tabId = Number(rawTabId);
    return Number.isInteger(tabId) ? tabId : undefined;
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1 && tabIdFrom(event.target) !== undefined) {
      event.preventDefault();
    }
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    const tabId = tabIdFrom(event.target);
    if (tabId === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onClose(tabId);
  };

  list.addEventListener("mousedown", onMouseDown);
  list.addEventListener("auxclick", onAuxClick);

  return {
    destroy(): void {
      list.removeEventListener("mousedown", onMouseDown);
      list.removeEventListener("auxclick", onAuxClick);
    },
  };
}
