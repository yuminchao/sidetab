import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_GROUP_COLORS,
  type TabGroupViewModel,
} from "../src/sidepanel/tab-group-model";
import { createTabContextMenu } from "../src/sidepanel/tab-context-menu";
import type { TabViewModel } from "../src/sidepanel/tab-model";

const tabs: TabViewModel[] = [
  { id: 1, windowId: 10, index: 0, title: "One", url: "https://one.example/", domain: "one.example", active: false, pinned: false, groupId: -1 },
  { id: 2, windowId: 10, index: 1, title: "Two", url: "https://two.example/", domain: "two.example", active: false, pinned: true, groupId: 3 },
];

const longGroupTitle = "这是一个用于验证二级菜单文本省略行为的很长分组标题";

const groups: TabGroupViewModel[] = TAB_GROUP_COLORS.map((color, index) => ({
  id: index + 3,
  windowId: 10,
  title: index === 1 ? "" : index === 2 ? longGroupTitle : `Group ${index + 1}`,
  color,
  collapsed: false,
}));

function row(id: number): HTMLElement {
  return document.querySelector(`[data-tab-id='${id}']`)!;
}

function context(target: Element, x = 20, y = 30): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
}

function menuContext(
  id: number,
  availability: Partial<{
    canCloseBelow: boolean;
    canCloseAbove: boolean;
    canOpenAllShortcuts: boolean;
    canGroupSameSite: boolean;
    canCloseOtherSameSite: boolean;
  }> = {},
) {
  const tab = tabs.find((candidate) => candidate.id === id);
  return tab && {
    tab,
    canCloseBelow: false,
    canGroupSameSite: false,
    canCloseOtherSameSite: false,
    ...availability,
  };
}

describe("tab context menu", () => {
  let list: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="list"><button class="tab-row" data-tab-id="1">One</button><button class="tab-row" data-tab-id="2">Two</button></div>`;
    list = document.querySelector("#list")!;
  });

  it("opens one bounded main menu and dispatches duplicate", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], onCommand },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
    vi.spyOn(popup, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 120, bottom: 90, width: 120, height: 90, x: 0, y: 0, toJSON: () => ({}) });

    const event = context(row(1), window.innerWidth - 2, window.innerHeight - 2);
    expect(event.defaultPrevented).toBe(true);
    expect(popup.hidden).toBe(false);
    expect(popup.style.left).toBe(`${window.innerWidth - 120}px`);
    expect(popup.style.top).toBe(`${window.innerHeight - 90}px`);
    expect(document.querySelectorAll(".tab-context-menu:not(.tab-context-submenu)")).toHaveLength(1);
    expect(document.querySelectorAll(".tab-context-submenu")).toHaveLength(1);
    expect(popup.children).toHaveLength(13);
    expect(Array.from(popup.children, (item) => item instanceof HTMLButtonElement
      ? item.dataset.menuAction
      : item.className)).toEqual([
      "duplicate",
      "set-pinned",
      "add-shortcut",
      "open-all-shortcuts",
      "tab-context-separator",
      "add-to-group",
      "remove-from-group",
      "group-same-site",
      "tab-context-separator",
      "close-below",
      "close-above",
      "close-same-site",
      "restore-recently-closed",
    ]);
    const separators = popup.querySelectorAll<HTMLElement>(".tab-context-separator");
    expect(separators).toHaveLength(2);
    for (const separator of Array.from(separators)) {
      expect(separator.tagName).not.toBe("BUTTON");
      expect(separator.getAttribute("role")).toBe("separator");
      expect(separator.textContent).toBe("");
      expect(separator.hasAttribute("tabindex")).toBe(false);
    }
    const duplicate = popup.querySelector<HTMLButtonElement>("[data-menu-action='duplicate']")!;
    duplicate.focus();
    separators[0]!.focus();
    expect(document.activeElement).toBe(duplicate);
    expect(
      Array.from(
        popup.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
        (item) => item.hidden ? null : item.textContent,
      ).filter(Boolean),
    ).toEqual([
      "复制标签页",
      "固定标签",
      "设为快捷网站",
      "打开所有快捷网站",
      "添加到分组",
      "快速分组",
      "关闭下方标签页",
      "关闭上方标签页",
      "关闭其他同类网站标签页",
      "打开最近关闭标签页",
    ]);
    expect(document.activeElement).toBe(duplicate);

    (popup.querySelector("[data-menu-action='duplicate']") as HTMLElement).click();
    expect(onCommand).toHaveBeenCalledWith({ action: "duplicate", tabId: 1 });
    expect(popup.hidden).toBe(true);
    menu.destroy();
  });

  it("calls the optional before-open hook once for each valid mouse or keyboard open", () => {
    const onBeforeOpen = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        onBeforeOpen,
        onCommand: vi.fn(),
      },
    );

    context(row(1));
    expect(onBeforeOpen).toHaveBeenCalledTimes(1);

    row(2).dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onBeforeOpen).toHaveBeenCalledTimes(2);

    context(list);
    list.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onBeforeOpen).toHaveBeenCalledTimes(2);

    menu.destroy();
  });

  it("dispatches add-shortcut from mouse and keyboard", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], onCommand },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    (popup.querySelector("[data-menu-action='add-shortcut']") as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "add-shortcut", tabId: 1 });

    context(row(2));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(
      popup.querySelector("[data-menu-action='add-shortcut']"),
    );
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenLastCalledWith({ action: "add-shortcut", tabId: 2 });
    menu.destroy();
  });

  it("dispatches close-below from mouse when a following tab can be closed", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, { canCloseBelow: id === 1 }),
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const closeBelow = popup.querySelector<HTMLButtonElement>("[data-menu-action='close-below']")!;
    expect(closeBelow.disabled).toBe(false);
    closeBelow.click();

    expect(onCommand).toHaveBeenCalledWith({ action: "close-below", tabId: 1 });
    expect(popup.hidden).toBe(true);
    menu.destroy();
  });

  it("dispatches close-above and open-all-shortcuts when enabled", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, { canCloseAbove: true, canOpenAllShortcuts: true }),
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    popup.querySelector<HTMLButtonElement>("[data-menu-action='open-all-shortcuts']")!.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "open-all-shortcuts", tabId: 1 });

    context(row(1));
    popup.querySelector<HTMLButtonElement>("[data-menu-action='close-above']")!.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "close-above", tabId: 1 });
    menu.destroy();
  });

  it("disables close-below without a following tab and skips it during navigation", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const closeBelow = popup.querySelector<HTMLButtonElement>("[data-menu-action='close-below']")!;
    expect(closeBelow.disabled).toBe(true);
    closeBelow.click();
    closeBelow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    closeBelow.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).not.toHaveBeenCalled();

    const addShortcut = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-shortcut']")!;
    addShortcut.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='add-to-group']"));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='duplicate']"));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='add-to-group']"));
    menu.destroy();
  });

  it("skips both separators while navigating visible menu commands", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, {
          canGroupSameSite: id === 1,
          canCloseBelow: id === 1,
        }),
        getGroups: () => [],
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const addShortcut = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-shortcut']")!;
    const addToGroup = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-to-group']")!;
    const groupSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-same-site']")!;
    const closeBelow = popup.querySelector<HTMLButtonElement>("[data-menu-action='close-below']")!;
    addShortcut.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(addToGroup);
    groupSameSite.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(closeBelow);
    menu.destroy();
  });

  it("configures same-site actions on open, skips disabled actions, and dispatches mouse and keyboard commands", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, {
          canGroupSameSite: id === 1,
          canCloseOtherSameSite: id === 2,
          canCloseBelow: true,
        }),
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const groupSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-same-site']")!;
    const closeSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='close-same-site']")!;
    expect(groupSameSite.disabled).toBe(false);
    expect(closeSameSite.disabled).toBe(true);
    closeSameSite.click();
    closeSameSite.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    closeSameSite.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).not.toHaveBeenCalled();
    groupSameSite.click();
    expect(onCommand).toHaveBeenCalledWith({ action: "group-same-site", tabId: 1 });

    context(row(2));
    const keyboardGroupSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-same-site']")!;
    expect(keyboardGroupSameSite.disabled).toBe(true);
    popup.querySelector<HTMLButtonElement>("[data-menu-action='remove-from-group']")!.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='close-below']"));
    popup.querySelector<HTMLButtonElement>("[data-menu-action='close-same-site']")!.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenLastCalledWith({ action: "close-same-site", tabId: 2 });
    menu.destroy();
  });

  it("reads all tab action availability from one context callback per open", () => {
    const getContext = vi.fn((id: number) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      return tab && {
        tab,
        canCloseBelow: true,
        canGroupSameSite: true,
        canCloseOtherSameSite: false,
      };
    });
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext, getGroups: () => [], onCommand: vi.fn() },
    );

    context(row(1));

    expect(getContext).toHaveBeenCalledOnce();
    expect(getContext).toHaveBeenCalledWith(1);
    expect(document.querySelector<HTMLButtonElement>(
      "[data-menu-action='close-below']",
    )?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(
      "[data-menu-action='group-same-site']",
    )?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(
      "[data-menu-action='close-same-site']",
    )?.disabled).toBe(true);
    menu.destroy();
  });

  it("marks the triggering row while either menu level is open and clears it for every close path", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => groups, onCommand: vi.fn() },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;
    const reopen = () => {
      context(row(1));
      expect(row(1).dataset.contextSelected).toBe("true");
    };
    const expectCleared = () => expect(row(1).hasAttribute("data-context-selected")).toBe(false);

    reopen();
    (popup.querySelector("[data-menu-action='add-to-group']") as HTMLButtonElement).click();
    expect(submenu.hidden).toBe(false);
    expect(row(1).dataset.contextSelected).toBe("true");
    (popup.querySelector("[data-menu-action='set-pinned']") as HTMLButtonElement).click(); expectCleared();
    reopen(); document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expectCleared();
    reopen(); popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expectCleared();
    reopen(); list.dispatchEvent(new Event("scroll")); expectCleared();
    reopen(); window.dispatchEvent(new Event("resize")); expectCleared();
    reopen(); menu.closeForTab(1); expectCleared();
    reopen(); context(row(2)); expectCleared(); expect(row(2).dataset.contextSelected).toBe("true");
    menu.destroy();
    expect(row(2).hasAttribute("data-context-selected")).toBe(false);
  });

  it("marks the Shift+F10 target row", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], onCommand: vi.fn() },
    );
    row(1).dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    expect(row(1).dataset.contextSelected).toBe("true");
    menu.destroy();
  });

  it("focuses enabled close-below and dispatches it from Enter", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, { canCloseBelow: true }),
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    for (let index = 0; index < 4; index += 1) {
      popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    }
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='close-below']"));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenCalledWith({ action: "close-below", tabId: 1 });
    menu.destroy();
  });

  it("disables restore-recently-closed without a session and skips it during navigation", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, { canCloseBelow: true }),
        getGroups: () => [],
        getRecentlyClosedSessionId: () => undefined,
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const restore = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='restore-recently-closed']",
    )!;
    expect(restore.disabled).toBe(true);
    restore.click();
    expect(onCommand).not.toHaveBeenCalled();

    popup.querySelector<HTMLButtonElement>("[data-menu-action='close-below']")!.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='duplicate']"));
    menu.destroy();
  });

  it("binds the recent session when opening and dispatches that snapshot", () => {
    let currentSessionId = "recent-session";
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        getRecentlyClosedSessionId: () => currentSessionId,
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    const restore = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='restore-recently-closed']",
    )!;
    expect(restore.disabled).toBe(false);
    currentSessionId = "newer-session";
    restore.click();

    expect(onCommand).toHaveBeenCalledWith({
      action: "restore-recently-closed",
      sessionId: "recent-session",
    });
    expect(restore.dataset.sessionId).toBeUndefined();
    menu.destroy();
  });

  it("dispatches restore-recently-closed from Enter", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        getRecentlyClosedSessionId: () => "keyboard-session",
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;

    context(row(1));
    popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='restore-recently-closed']",
    )!.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onCommand).toHaveBeenCalledWith({
      action: "restore-recently-closed",
      sessionId: "keyboard-session",
    });
    menu.destroy();
  });

  it.each([[1, "固定标签", true], [2, "取消固定", false]] as const)(
    "uses the current pinned state for tab %s",
    (id, label, pinned) => {
      const onCommand = vi.fn();
      const menu = createTabContextMenu(
        { document, list, viewport: window },
        { getContext: menuContext, getGroups: () => [], onCommand },
      );
      context(row(id));
      const button = document.querySelector<HTMLElement>("[data-menu-action='set-pinned']")!;
      expect(button.textContent).toBe(label);
      button.click();
      expect(onCommand).toHaveBeenCalledWith({ action: "set-pinned", tabId: id, pinned });
      menu.destroy();
    },
  );

  it("supports Shift+F10, arrow navigation, Enter, and Escape", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], onCommand },
    );
    row(1).dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='set-pinned']"));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenCalledWith({ action: "set-pinned", tabId: 1, pinned: true });
    context(row(1));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popup.hidden).toBe(true);
    expect(document.activeElement).toBe(row(1));
    menu.destroy();
  });

  it("closes on outside input, scroll, resize, target removal, and destroy", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], onCommand: vi.fn() },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
    const reopen = () => { context(row(1)); expect(popup.hidden).toBe(false); };
    reopen(); document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(popup.hidden).toBe(true);
    reopen(); list.dispatchEvent(new Event("scroll")); expect(popup.hidden).toBe(true);
    reopen(); window.dispatchEvent(new Event("resize")); expect(popup.hidden).toBe(true);
    reopen(); menu.closeForTab(1); expect(popup.hidden).toBe(true);
    reopen(); menu.destroy(); expect(document.querySelector(".tab-context-menu")).toBeNull();
    context(row(1)); expect(document.querySelector(".tab-context-menu")).toBeNull();
  });

  it("builds a dynamic group submenu with colors, unnamed fallback, and current selection", () => {
    const onCommand = vi.fn();
    createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => groups, onCommand },
    );

    context(row(2));
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const trigger = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-to-group']")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(popup.querySelector("[data-menu-action='remove-from-group']")?.hasAttribute("hidden")).toBe(false);

    trigger.click();
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;
    expect(submenu.classList.contains("tab-context-menu")).toBe(true);
    expect(submenu.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(submenu.querySelector("[data-menu-action='create-group']")?.textContent).toBe("新建分组");
    const groupItems = Array.from(submenu.querySelectorAll<HTMLButtonElement>("[data-group-id]"));
    expect(groupItems).toHaveLength(9);
    expect(groupItems.map((item) => item.querySelector<HTMLElement>(".group-menu-color")?.dataset.color)).toEqual(TAB_GROUP_COLORS);
    expect(groupItems.every((item) => item.querySelector(".group-menu-title"))).toBe(true);
    expect(groupItems[2]?.querySelector(".group-menu-title")?.textContent).toBe(longGroupTitle);
    expect(groupItems[1]?.textContent).toContain("未命名分组");
    expect(groupItems[0]?.getAttribute("aria-checked")).toBe("true");
    expect(groupItems[0]?.disabled).toBe(true);

    groupItems[2]?.click();
    expect(onCommand).toHaveBeenCalledWith({ action: "add-to-group", tabId: 2, groupId: 5 });
    expect(popup.hidden).toBe(true);
    expect(submenu.hidden).toBe(true);
  });

  it("rebuilds groups on each open and dispatches create and remove commands", () => {
    const onCommand = vi.fn();
    let availableGroups = groups.slice(0, 1);
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => availableGroups, onCommand },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;

    context(row(1));
    expect(popup.querySelector("[data-menu-action='remove-from-group']")?.hasAttribute("hidden")).toBe(true);
    (popup.querySelector("[data-menu-action='add-to-group']") as HTMLButtonElement).click();
    expect(submenu.querySelectorAll("[data-group-id]")).toHaveLength(1);
    (submenu.querySelector("[data-menu-action='create-group']") as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "create-group", tabId: 1 });

    availableGroups = groups.slice(0, 3);
    context(row(2));
    (popup.querySelector("[data-menu-action='add-to-group']") as HTMLButtonElement).click();
    expect(submenu.querySelectorAll("[data-group-id]")).toHaveLength(3);
    (popup.querySelector("[data-menu-action='remove-from-group']") as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "remove-from-group", tabId: 2 });
    menu.destroy();
  });

  it("opens the submenu on hover and flips it left and upward when space is constrained", () => {
    createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => groups.slice(0, 2), onCommand: vi.fn() },
    );
    context(row(1));
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;
    const trigger = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-to-group']")!;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight - 20, left: window.innerWidth - 80, right: window.innerWidth - 10, bottom: window.innerHeight, width: 70, height: 20, x: 0, y: 0, toJSON: () => ({}) });
    vi.spyOn(submenu, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 120, bottom: 100, width: 120, height: 100, x: 0, y: 0, toJSON: () => ({}) });

    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(submenu.hidden).toBe(false);
    expect(submenu.style.left).toBe(`${window.innerWidth - 200}px`);
    expect(submenu.style.top).toBe(`${window.innerHeight - 100}px`);
  });

  it("supports right, left, vertical navigation, activation, and Escape across both levels", () => {
    const onCommand = vi.fn();
    createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => groups.slice(0, 3), onCommand },
    );
    context(row(2));
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;
    const trigger = popup.querySelector<HTMLButtonElement>("[data-menu-action='add-to-group']")!;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const create = submenu.querySelector<HTMLButtonElement>("[data-menu-action='create-group']")!;
    expect(document.activeElement).toBe(create);

    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(submenu.querySelector("[data-group-id='5']"));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(create);
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(submenu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenCalledWith({ action: "create-group", tabId: 2 });

    context(row(2));
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).toHaveBeenCalledWith({ action: "add-to-group", tabId: 2, groupId: 4 });

    context(row(2));
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popup.hidden).toBe(true);
    expect(submenu.hidden).toBe(true);
    expect(document.activeElement).toBe(row(2));
  });

  it("closes both menu levels on outside input, scroll, resize, target removal, and destroy", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => groups, onCommand: vi.fn() },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu:not(.tab-context-submenu)")!;
    const submenu = document.querySelector<HTMLElement>(".tab-context-submenu")!;
    const reopen = () => {
      context(row(1));
      (popup.querySelector("[data-menu-action='add-to-group']") as HTMLButtonElement).click();
      expect(popup.hidden).toBe(false);
      expect(submenu.hidden).toBe(false);
    };
    const expectClosed = () => {
      expect(popup.hidden).toBe(true);
      expect(submenu.hidden).toBe(true);
    };

    reopen(); document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expectClosed();
    reopen(); list.dispatchEvent(new Event("scroll")); expectClosed();
    reopen(); window.dispatchEvent(new Event("resize")); expectClosed();
    reopen(); menu.closeForTab(1); expectClosed();
    reopen(); menu.destroy();
    expect(document.querySelector(".tab-context-menu")).toBeNull();
    expect(document.querySelector(".tab-context-submenu")).toBeNull();
  });
});
