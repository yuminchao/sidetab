import type { TabViewModel } from "./tab-model";

export type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean };

export function createTabContextMenu(
  elements: { document: Document; list: HTMLElement; viewport: Window },
  callbacks: {
    getTab(id: number): TabViewModel | undefined;
    onCommand(command: TabContextCommand): void;
  },
) {
  const menu = elements.document.createElement("div");
  menu.className = "tab-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const duplicate = createItem("duplicate", "复制标签页");
  const setPinned = createItem("set-pinned", "固定标签");
  menu.append(duplicate, setPinned);
  elements.document.body.append(menu);

  let openTabId: number | undefined;
  let returnFocus: HTMLElement | undefined;

  function createItem(action: string, label: string): HTMLButtonElement {
    const button = elements.document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.menuAction = action;
    button.textContent = label;
    return button;
  }

  function close(restoreFocus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    openTabId = undefined;
    if (restoreFocus) returnFocus?.focus();
    returnFocus = undefined;
  }

  function open(tab: TabViewModel, x: number, y: number, focusTarget: HTMLElement): void {
    openTabId = tab.id;
    returnFocus = focusTarget;
    setPinned.textContent = tab.pinned ? "取消固定" : "固定标签";
    setPinned.dataset.nextPinned = String(!tab.pinned);
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, elements.viewport.innerWidth - rect.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, elements.viewport.innerHeight - rect.height))}px`;
    duplicate.focus();
  }

  const tabFromRow = (target: EventTarget | null): { row: HTMLElement; tab: TabViewModel } | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-row[data-tab-id]");
    if (!row || !elements.list.contains(row)) return undefined;
    const tabId = Number(row.dataset.tabId);
    if (!Number.isInteger(tabId)) return undefined;
    const tab = callbacks.getTab(tabId);
    return tab ? { row, tab } : undefined;
  };

  const onContextMenu = (event: MouseEvent): void => {
    const match = tabFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    open(match.tab, event.clientX, event.clientY, match.row);
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "F10" || !event.shiftKey) return;
    const match = tabFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    const rect = match.row.getBoundingClientRect();
    open(match.tab, rect.left, rect.bottom, match.row);
  };

  const onMenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-menu-action]")
      : null;
    if (!button || openTabId === undefined || !menu.contains(button)) return;
    const command: TabContextCommand = button.dataset.menuAction === "duplicate"
      ? { action: "duplicate", tabId: openTabId }
      : { action: "set-pinned", tabId: openTabId, pinned: button.dataset.nextPinned === "true" };
    close();
    callbacks.onCommand(command);
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    const items = [duplicate, setPinned];
    const current = Math.max(0, items.indexOf(elements.document.activeElement as HTMLButtonElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[current]?.click();
    }
  };

  const onDocumentPointerDown = (event: Event): void => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target)) close();
  };
  const onEnvironmentalClose = (): void => close();

  menu.addEventListener("click", onMenuClick);
  menu.addEventListener("keydown", onMenuKeyDown);
  elements.list.addEventListener("contextmenu", onContextMenu);
  elements.list.addEventListener("keydown", onListKeyDown);
  elements.list.addEventListener("scroll", onEnvironmentalClose);
  elements.document.addEventListener("pointerdown", onDocumentPointerDown);
  elements.viewport.addEventListener("resize", onEnvironmentalClose);

  return {
    close,
    closeForTab(tabId: number): void {
      if (openTabId === tabId) close();
    },
    destroy(): void {
      close();
      menu.removeEventListener("click", onMenuClick);
      menu.removeEventListener("keydown", onMenuKeyDown);
      elements.list.removeEventListener("contextmenu", onContextMenu);
      elements.list.removeEventListener("keydown", onListKeyDown);
      elements.list.removeEventListener("scroll", onEnvironmentalClose);
      elements.document.removeEventListener("pointerdown", onDocumentPointerDown);
      elements.viewport.removeEventListener("resize", onEnvironmentalClose);
      menu.remove();
    },
  };
}
