import {
  TAB_GROUP_COLORS,
  isValidTabGroupId,
  type TabGroupColor,
  type TabGroupViewModel,
} from "./tab-group-model";

export type TabGroupContextCommand =
  | { action: "new-tab"; groupId: number }
  | { action: "rename"; groupId: number }
  | { action: "set-color"; groupId: number; color: TabGroupColor }
  | { action: "dissolve"; groupId: number }
  | { action: "close"; groupId: number };

const COLOR_LABELS: Readonly<Record<TabGroupColor, string>> = {
  grey: "灰色",
  blue: "蓝色",
  red: "红色",
  yellow: "黄色",
  green: "绿色",
  pink: "粉色",
  purple: "紫色",
  cyan: "青色",
  orange: "橙色",
};

export function createTabGroupContextMenu(
  elements: { document: Document; list: HTMLElement; viewport: Window },
  callbacks: {
    getGroup(id: number): TabGroupViewModel | undefined;
    isGroupBusy(id: number): boolean;
    canCloseGroup(id: number): boolean;
    onBeforeOpen(): void;
    onCommand(command: TabGroupContextCommand): void;
  },
) {
  const menu = elements.document.createElement("div");
  menu.className = "tab-context-menu tab-group-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const submenu = elements.document.createElement("div");
  submenu.className = "tab-context-menu tab-context-submenu tab-group-color-submenu";
  submenu.setAttribute("role", "menu");
  submenu.hidden = true;

  const newTab = createItem("new-tab", "在分组中新建标签页");
  const rename = createItem("rename", "重命名分组");
  const setColor = createItem("set-color", "修改颜色");
  setColor.setAttribute("aria-haspopup", "menu");
  setColor.setAttribute("aria-expanded", "false");
  const separator = elements.document.createElement("div");
  separator.className = "tab-context-separator";
  separator.setAttribute("role", "separator");
  const dissolve = createItem("dissolve", "解散分组");
  const closeGroup = createItem("close", "关闭分组");
  menu.append(newTab, rename, setColor, separator, dissolve, closeGroup);
  elements.document.body.append(menu, submenu);
  const scrollContainer = elements.list.parentElement ?? elements.list;

  let openGroupId: number | undefined;
  let returnFocus: HTMLElement | undefined;
  let contextSelectedRow: HTMLElement | undefined;

  function createItem(action: string, label: string): HTMLButtonElement {
    const button = elements.document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.groupMenuAction = action;
    button.textContent = label;
    return button;
  }

  function availableItems(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>(":scope > button[role^='menuitem']"),
    ).filter((item) => !item.hidden && !item.disabled);
  }

  function closeSubmenu(restoreFocus = false): void {
    submenu.hidden = true;
    submenu.replaceChildren();
    setColor.setAttribute("aria-expanded", "false");
    if (restoreFocus && !menu.hidden) setColor.focus();
  }

  function close(restoreFocus = false): void {
    contextSelectedRow?.removeAttribute("data-context-selected");
    contextSelectedRow = undefined;
    closeSubmenu();
    menu.hidden = true;
    openGroupId = undefined;
    if (restoreFocus) returnFocus?.focus();
    returnFocus = undefined;
  }

  function positionSubmenu(): void {
    submenu.style.left = "0px";
    submenu.style.top = "0px";
    const anchor = setColor.getBoundingClientRect();
    const rect = submenu.getBoundingClientRect();
    const preferredLeft = anchor.right;
    const left = preferredLeft + rect.width <= elements.viewport.innerWidth
      ? preferredLeft
      : anchor.left - rect.width;
    submenu.style.left = `${Math.max(0, Math.min(left, elements.viewport.innerWidth - rect.width))}px`;
    submenu.style.top = `${Math.max(0, Math.min(anchor.top, elements.viewport.innerHeight - rect.height))}px`;
  }

  function openSubmenu(focusFirst = false): void {
    if (menu.hidden || openGroupId === undefined || setColor.disabled) return;
    const group = callbacks.getGroup(openGroupId);
    if (!group) {
      close();
      return;
    }
    const fragment = elements.document.createDocumentFragment();
    for (const color of TAB_GROUP_COLORS) {
      const button = createItem("set-color", "");
      button.dataset.color = color;
      button.setAttribute("role", "menuitemradio");
      const selected = color === group.color;
      button.setAttribute("aria-checked", String(selected));
      button.disabled = selected;

      const swatch = elements.document.createElement("span");
      swatch.className = "group-menu-color";
      swatch.dataset.color = color;
      swatch.setAttribute("aria-hidden", "true");
      const label = elements.document.createElement("span");
      label.className = "group-menu-title";
      label.textContent = COLOR_LABELS[color];
      button.append(swatch, label);
      fragment.append(button);
    }
    submenu.replaceChildren(fragment);
    submenu.hidden = false;
    setColor.setAttribute("aria-expanded", "true");
    positionSubmenu();
    if (focusFirst) availableItems(submenu)[0]?.focus();
  }

  function open(group: TabGroupViewModel, x: number, y: number, row: HTMLElement): void {
    callbacks.onBeforeOpen();
    close();
    openGroupId = group.id;
    returnFocus = row.querySelector<HTMLElement>(".tab-group-main") ?? row;
    row.dataset.contextSelected = "true";
    contextSelectedRow = row;
    const busy = callbacks.isGroupBusy(group.id);
    for (const button of [newTab, rename, setColor, dissolve]) button.disabled = busy;
    closeGroup.disabled = busy || !callbacks.canCloseGroup(group.id);

    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, elements.viewport.innerWidth - rect.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, elements.viewport.innerHeight - rect.height))}px`;
    availableItems(menu)[0]?.focus();
  }

  function contextFromRow(
    target: EventTarget | null,
  ): { row: HTMLElement; group: TabGroupViewModel } | undefined {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-group-row[data-group-id]");
    if (!row || !elements.list.contains(row)) return undefined;
    const groupId = Number(row.dataset.groupId);
    if (!isValidTabGroupId(groupId)) return undefined;
    const group = callbacks.getGroup(groupId);
    return group ? { row, group } : undefined;
  }

  const onContextMenu = (event: MouseEvent): void => {
    const match = contextFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    open(match.group, event.clientX, event.clientY, match.row);
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "F10" || !event.shiftKey) return;
    const match = contextFromRow(event.target);
    if (!match) return;
    event.preventDefault();
    const rect = match.row.getBoundingClientRect();
    open(match.group, rect.left, rect.bottom, match.row);
  };

  const dispatchMainCommand = (button: HTMLButtonElement): void => {
    if (openGroupId === undefined || button.disabled) return;
    if (button === setColor) {
      openSubmenu(true);
      return;
    }
    const action = button.dataset.groupMenuAction;
    if (
      action !== "new-tab"
      && action !== "rename"
      && action !== "dissolve"
      && action !== "close"
    ) return;
    const command: TabGroupContextCommand = { action, groupId: openGroupId };
    close();
    callbacks.onCommand(command);
  };

  const onMenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-group-menu-action]")
      : null;
    if (!button || button.parentElement !== menu) return;
    dispatchMainCommand(button);
  };

  const onSubmenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-color]")
      : null;
    if (!button || button.parentElement !== submenu || button.disabled || openGroupId === undefined) return;
    const color = button.dataset.color as TabGroupColor | undefined;
    if (!color || !TAB_GROUP_COLORS.includes(color)) return;
    const command: TabGroupContextCommand = { action: "set-color", groupId: openGroupId, color };
    close();
    callbacks.onCommand(command);
  };

  const onMenuMouseOver = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-group-menu-action]")
      : null;
    if (!button || button.parentElement !== menu) return;
    if (button === setColor) openSubmenu();
    else closeSubmenu();
  };

  function moveFocus(container: HTMLElement, direction: 1 | -1): void {
    const items = availableItems(container);
    if (items.length === 0) return;
    const current = items.indexOf(elements.document.activeElement as HTMLButtonElement);
    const next = current === -1 ? 0 : (current + direction + items.length) % items.length;
    items[next]?.focus();
  }

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(menu, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowRight" && elements.document.activeElement === setColor) {
      event.preventDefault();
      openSubmenu(true);
    } else if (event.key === "Enter" || event.key === " ") {
      const button = elements.document.activeElement;
      if (button instanceof HTMLButtonElement && button.parentElement === menu) {
        event.preventDefault();
        dispatchMainCommand(button);
      }
    }
  };

  const onSubmenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      closeSubmenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(submenu, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === " ") {
      const button = elements.document.activeElement;
      if (button instanceof HTMLButtonElement && button.parentElement === submenu) {
        event.preventDefault();
        button.click();
      }
    }
  };

  const onDocumentPointerDown = (event: Event): void => {
    if (
      !menu.hidden && event.target instanceof Node &&
      !menu.contains(event.target) && !submenu.contains(event.target)
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
  scrollContainer.addEventListener("scroll", onEnvironmentalClose);
  elements.document.addEventListener("pointerdown", onDocumentPointerDown);
  elements.viewport.addEventListener("resize", onEnvironmentalClose);

  return {
    close,
    closeForGroup(groupId: number): void {
      if (openGroupId === groupId) close();
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
      scrollContainer.removeEventListener("scroll", onEnvironmentalClose);
      elements.document.removeEventListener("pointerdown", onDocumentPointerDown);
      elements.viewport.removeEventListener("resize", onEnvironmentalClose);
      menu.remove();
      submenu.remove();
    },
  };
}
