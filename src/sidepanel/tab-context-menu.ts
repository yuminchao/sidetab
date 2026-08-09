import { isValidTabGroupId, type TabGroupViewModel } from "./tab-group-model";
import type { TabViewModel } from "./tab-model";

export type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean }
  | { action: "add-shortcut"; tabId: number }
  | { action: "open-all-shortcuts"; tabId: number }
  | { action: "group-same-site"; tabId: number }
  | { action: "close-below"; tabId: number }
  | { action: "close-above"; tabId: number }
  | { action: "close-same-site"; tabId: number }
  | { action: "create-group"; tabId: number }
  | { action: "add-to-group"; tabId: number; groupId: number }
  | { action: "remove-from-group"; tabId: number }
  | { action: "restore-recently-closed"; sessionId: string };

export type TabContextMenuContext = {
  tab: TabViewModel;
  canDuplicate?: boolean;
  canCloseBelow: boolean;
  canCloseAbove?: boolean;
  canOpenAllShortcuts?: boolean;
  canGroupSameSite: boolean;
  canCloseOtherSameSite: boolean;
};

export function createTabContextMenu(
  elements: { document: Document; list: HTMLElement; viewport: Window },
  callbacks: {
    getContext(id: number): TabContextMenuContext | undefined;
    getGroups(): readonly TabGroupViewModel[];
    getRecentlyClosedSessionId?(): string | undefined;
    onBeforeOpen?(): void;
    onCommand(command: TabContextCommand): void;
  },
) {
  const menu = elements.document.createElement("div");
  menu.className = "tab-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const submenu = elements.document.createElement("div");
  submenu.className = "tab-context-menu tab-context-submenu";
  submenu.setAttribute("role", "menu");
  submenu.hidden = true;

  const duplicate = createItem("duplicate", "复制标签页");
  const setPinned = createItem("set-pinned", "固定标签");
  const addShortcut = createItem("add-shortcut", "设为快捷网站");
  const openAllShortcuts = createItem("open-all-shortcuts", "打开所有快捷网站");
  const addToGroup = createItem("add-to-group", "添加到分组");
  addToGroup.setAttribute("aria-haspopup", "menu");
  addToGroup.setAttribute("aria-expanded", "false");
  const groupSameSite = createItem("group-same-site", "快速分组");
  const closeSameSite = createItem("close-same-site", "关闭其他同类网站标签页");
  const groupSeparator = elements.document.createElement("div");
  groupSeparator.className = "tab-context-separator";
  groupSeparator.setAttribute("role", "separator");
  const closeSeparator = elements.document.createElement("div");
  closeSeparator.className = "tab-context-separator";
  closeSeparator.setAttribute("role", "separator");
  const removeFromGroup = createItem("remove-from-group", "从分组中移除");
  const closeBelow = createItem("close-below", "关闭下方标签页");
  const closeAbove = createItem("close-above", "关闭上方标签页");
  const restoreRecentlyClosed = createItem(
    "restore-recently-closed",
    "打开最近关闭标签页",
  );
  menu.append(
    duplicate,
    setPinned,
    addShortcut,
    openAllShortcuts,
    groupSeparator,
    addToGroup,
    removeFromGroup,
    groupSameSite,
    closeSeparator,
    closeBelow,
    closeAbove,
    closeSameSite,
    restoreRecentlyClosed,
  );
  elements.document.body.append(menu, submenu);

  let openTabId: number | undefined;
  let openGroupId = -1;
  let returnFocus: HTMLElement | undefined;
  let contextSelectedRow: HTMLElement | undefined;

  function createItem(action: string, label: string): HTMLButtonElement {
    const button = elements.document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.menuAction = action;
    button.textContent = label;
    return button;
  }

  function closeSubmenu(restoreFocus = false): void {
    if (!submenu.hidden) {
      submenu.hidden = true;
    }
    addToGroup.setAttribute("aria-expanded", "false");
    submenu.replaceChildren();
    if (restoreFocus && !menu.hidden) addToGroup.focus();
  }

  function close(restoreFocus = false): void {
    contextSelectedRow?.removeAttribute("data-context-selected");
    contextSelectedRow = undefined;
    if (menu.hidden && submenu.hidden) return;
    closeSubmenu();
    menu.hidden = true;
    openTabId = undefined;
    openGroupId = -1;
    delete restoreRecentlyClosed.dataset.sessionId;
    if (restoreFocus) returnFocus?.focus();
    returnFocus = undefined;
  }

  function getAvailableItems(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>(":scope > button[role^='menuitem']"),
    ).filter((item) => !item.hidden && !item.disabled);
  }

  function positionSubmenu(): void {
    submenu.style.left = "0px";
    submenu.style.top = "0px";
    const anchor = addToGroup.getBoundingClientRect();
    const rect = submenu.getBoundingClientRect();
    const preferredLeft = anchor.right;
    const left = preferredLeft + rect.width <= elements.viewport.innerWidth
      ? preferredLeft
      : anchor.left - rect.width;
    submenu.style.left = `${Math.max(0, Math.min(left, elements.viewport.innerWidth - rect.width))}px`;
    submenu.style.top = `${Math.max(0, Math.min(anchor.top, elements.viewport.innerHeight - rect.height))}px`;
  }

  function openSubmenu(focusFirst = false): void {
    if (menu.hidden || openTabId === undefined) return;
    const fragment = elements.document.createDocumentFragment();
    fragment.append(createItem("create-group", "新建分组"));
    for (const group of callbacks.getGroups()) {
      const button = createItem("add-to-group", "");
      button.dataset.groupId = String(group.id);
      button.setAttribute("role", "menuitemradio");
      const selected = group.id === openGroupId;
      button.setAttribute("aria-checked", String(selected));
      button.disabled = selected;

      const color = elements.document.createElement("span");
      color.className = "group-menu-color";
      color.dataset.color = group.color;
      color.setAttribute("aria-hidden", "true");
      const title = elements.document.createElement("span");
      title.className = "group-menu-title";
      title.textContent = group.title || "未命名分组";
      button.append(color, title);
      fragment.append(button);
    }
    submenu.replaceChildren(fragment);
    submenu.hidden = false;
    addToGroup.setAttribute("aria-expanded", "true");
    positionSubmenu();
    if (focusFirst) getAvailableItems(submenu)[0]?.focus();
  }

  function open(
    context: TabContextMenuContext,
    x: number,
    y: number,
    focusTarget: HTMLElement,
  ): void {
    const { tab } = context;
    callbacks.onBeforeOpen?.();
    if (contextSelectedRow !== focusTarget) {
      contextSelectedRow?.removeAttribute("data-context-selected");
      focusTarget.dataset.contextSelected = "true";
      contextSelectedRow = focusTarget;
    }
    closeSubmenu();
    openTabId = tab.id;
    openGroupId = tab.groupId;
    returnFocus = focusTarget;
    setPinned.textContent = tab.pinned ? "取消固定" : "固定标签";
    setPinned.dataset.nextPinned = String(!tab.pinned);
    duplicate.disabled = context.canDuplicate === false;
    removeFromGroup.hidden = !isValidTabGroupId(tab.groupId);
    groupSameSite.disabled = !context.canGroupSameSite;
    closeBelow.disabled = !context.canCloseBelow;
    closeAbove.disabled = context.canCloseAbove !== true;
    openAllShortcuts.disabled = context.canOpenAllShortcuts !== true;
    closeSameSite.disabled = !context.canCloseOtherSameSite;
    const sessionId = callbacks.getRecentlyClosedSessionId?.();
    restoreRecentlyClosed.disabled = !sessionId;
    if (sessionId) {
      restoreRecentlyClosed.dataset.sessionId = sessionId;
    } else {
      delete restoreRecentlyClosed.dataset.sessionId;
    }
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, elements.viewport.innerWidth - rect.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, elements.viewport.innerHeight - rect.height))}px`;
    duplicate.focus();
  }

  const contextFromRow = (
    target: EventTarget | null,
  ): { row: HTMLElement; context: TabContextMenuContext } | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-row[data-tab-id]");
    if (!row || !elements.list.contains(row)) return undefined;
    const tabId = Number(row.dataset.tabId);
    if (!Number.isInteger(tabId)) return undefined;
    const context = callbacks.getContext(tabId);
    return context ? { row, context } : undefined;
  };

  const onContextMenu = (event: MouseEvent): void => {
    const match = contextFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    open(match.context, event.clientX, event.clientY, match.row);
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "F10" || !event.shiftKey) return;
    const match = contextFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    const rect = match.row.getBoundingClientRect();
    open(match.context, rect.left, rect.bottom, match.row);
  };

  const onMenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-menu-action]")
      : null;
    if (!button || openTabId === undefined || !menu.contains(button)) return;
    if (button.disabled) return;
    if (button === addToGroup) {
      openSubmenu(true);
      return;
    }
    let command: TabContextCommand;
    switch (button.dataset.menuAction) {
      case "duplicate":
        command = { action: "duplicate", tabId: openTabId };
        break;
      case "set-pinned":
        command = {
          action: "set-pinned",
          tabId: openTabId,
          pinned: button.dataset.nextPinned === "true",
        };
        break;
      case "add-shortcut":
        command = { action: "add-shortcut", tabId: openTabId };
        break;
      case "open-all-shortcuts":
        command = { action: "open-all-shortcuts", tabId: openTabId };
        break;
      case "group-same-site":
        command = { action: "group-same-site", tabId: openTabId };
        break;
      case "close-below":
        command = { action: "close-below", tabId: openTabId };
        break;
      case "close-above":
        command = { action: "close-above", tabId: openTabId };
        break;
      case "close-same-site":
        command = { action: "close-same-site", tabId: openTabId };
        break;
      case "restore-recently-closed": {
        const sessionId = button.dataset.sessionId;
        if (!sessionId) return;
        command = { action: "restore-recently-closed", sessionId };
        break;
      }
      case "remove-from-group":
        command = { action: "remove-from-group", tabId: openTabId };
        break;
      default:
        return;
    }
    close();
    callbacks.onCommand(command);
  };

  const onSubmenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-menu-action]")
      : null;
    if (!button || openTabId === undefined || !submenu.contains(button) || button.disabled) return;

    let command: TabContextCommand;
    if (button.dataset.menuAction === "create-group") {
      command = { action: "create-group", tabId: openTabId };
    } else if (button.dataset.menuAction === "add-to-group") {
      const groupId = Number(button.dataset.groupId);
      if (!isValidTabGroupId(groupId)) return;
      command = { action: "add-to-group", tabId: openTabId, groupId };
    } else {
      return;
    }
    close();
    callbacks.onCommand(command);
  };

  const onMenuMouseOver = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-menu-action]")
      : null;
    if (!button || button.parentElement !== menu) return;
    if (button === addToGroup) {
      openSubmenu();
    } else {
      closeSubmenu();
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.target instanceof HTMLButtonElement && event.target.disabled) return;
    const availableItems = getAvailableItems(menu);
    const current = availableItems.indexOf(elements.document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = current === -1 ? 0 : (current + delta + availableItems.length) % availableItems.length;
      availableItems[next]?.focus();
    } else if (event.key === "ArrowRight" && elements.document.activeElement === addToGroup) {
      event.preventDefault();
      openSubmenu(true);
    } else if (event.key === "ArrowLeft" && !submenu.hidden) {
      event.preventDefault();
      closeSubmenu(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      availableItems[current]?.click();
    }
  };

  const onSubmenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      closeSubmenu(true);
      return;
    }
    if (event.target instanceof HTMLButtonElement && event.target.disabled) return;
    const availableItems = getAvailableItems(submenu);
    const current = availableItems.indexOf(elements.document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = current === -1 ? 0 : (current + delta + availableItems.length) % availableItems.length;
      availableItems[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      availableItems[current]?.click();
    }
  };

  const onDocumentPointerDown = (event: Event): void => {
    if (
      !menu.hidden &&
      event.target instanceof Node &&
      !menu.contains(event.target) &&
      !submenu.contains(event.target)
    ) close();
  };
  const onEnvironmentalClose = (): void => close();

  menu.addEventListener("click", onMenuClick);
  menu.addEventListener("mouseover", onMenuMouseOver);
  menu.addEventListener("keydown", onMenuKeyDown);
  submenu.addEventListener("click", onSubmenuClick);
  submenu.addEventListener("keydown", onSubmenuKeyDown);
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
      menu.removeEventListener("mouseover", onMenuMouseOver);
      menu.removeEventListener("keydown", onMenuKeyDown);
      submenu.removeEventListener("click", onSubmenuClick);
      submenu.removeEventListener("keydown", onSubmenuKeyDown);
      elements.list.removeEventListener("contextmenu", onContextMenu);
      elements.list.removeEventListener("keydown", onListKeyDown);
      elements.list.removeEventListener("scroll", onEnvironmentalClose);
      elements.document.removeEventListener("pointerdown", onDocumentPointerDown);
      elements.viewport.removeEventListener("resize", onEnvironmentalClose);
      menu.remove();
      submenu.remove();
    },
  };
}
