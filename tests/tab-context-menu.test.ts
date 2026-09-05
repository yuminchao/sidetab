import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_GROUP_COLORS,
  type TabGroupViewModel,
} from "../src/sidepanel/tab-group-model";
import { createTabContextMenu } from "../src/sidepanel/tab-context-menu";
import type { TabViewModel } from "../src/sidepanel/tab-model";
import { deferred } from "./helpers/fake-chrome";

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
    canDuplicate: boolean;
    canCloseBelow: boolean;
    canCloseAbove: boolean;
    canOpenAllShortcuts: boolean;
    canQuickGroupSameSite: boolean;
    canGroupAll: boolean;
    canManageGroupMembership: boolean;
    canCloseOtherSameSite: boolean;
    canDissolveTree: boolean;
    canDeleteSubtree: boolean;
  }> = {},
) {
  const tab = tabs.find((candidate) => candidate.id === id);
  return tab && {
    tab,
    canCloseBelow: false,
    canQuickGroupSameSite: false,
    canGroupAll: false,
    canManageGroupMembership: true,
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
    expect(popup.children).toHaveLength(18);
    expect(Array.from(popup.children, (item) => item instanceof HTMLButtonElement
      ? item.dataset.menuAction
      : item.className)).toEqual([
      "duplicate",
      "set-pinned",
      "add-bookmark",
      "add-shortcut",
      "open-all-shortcuts",
      "tab-context-separator",
      "add-to-group",
      "remove-from-group",
      "group-same-site",
      "group-all",
      "tab-context-separator",
      "dissolve-tree",
      "delete-subtree",
      "tab-context-separator",
      "close-below",
      "close-above",
      "close-same-site",
      "restore-recently-closed",
    ]);
    const separators = popup.querySelectorAll<HTMLElement>(".tab-context-separator");
    expect(separators).toHaveLength(3);
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
      "添加到分组",
    ]);
    expect(document.activeElement).toBe(duplicate);

    (popup.querySelector("[data-menu-action='duplicate']") as HTMLElement).click();
    expect(onCommand).toHaveBeenCalledWith({ action: "duplicate", tabId: 1 });
    expect(popup.hidden).toBe(true);
    menu.destroy();
  });

  it("shows tree commands in their own section and dispatches them only for a parent", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, {
          canDissolveTree: id === 1,
          canDeleteSubtree: id === 1,
        }),
        getGroups: () => [],
        onCommand,
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(2));
    const dissolveLeaf = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='dissolve-tree']",
    )!;
    const deleteLeaf = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='delete-subtree']",
    )!;
    expect(dissolveLeaf.hidden).toBe(true);
    expect(deleteLeaf.hidden).toBe(true);
    expect(dissolveLeaf.disabled).toBe(false);
    expect(deleteLeaf.disabled).toBe(false);
    dissolveLeaf.click();
    deleteLeaf.click();
    expect(onCommand).not.toHaveBeenCalled();

    context(row(1));
    const dissolve = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='dissolve-tree']",
    )!;
    const deleteSubtree = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='delete-subtree']",
    )!;
    expect(dissolve.textContent).toBe("解散树节点");
    expect(deleteSubtree.textContent).toBe("删除树节点及子标签");
    expect(dissolve.disabled).toBe(false);
    expect(deleteSubtree.disabled).toBe(false);
    expect(dissolve.previousElementSibling).toMatchObject({
      className: "tab-context-separator",
    });
    expect(deleteSubtree.previousElementSibling).toBe(dissolve);
    expect(deleteSubtree.nextElementSibling).toMatchObject({
      className: "tab-context-separator",
    });

    dissolve.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "dissolve-tree", tabId: 1 });
    context(row(1));
    deleteSubtree.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "delete-subtree", tabId: 1 });
    menu.destroy();
  });

  it("shows only executable actions and normalizes visible separators", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, {
          canDuplicate: false,
          canCloseBelow: false,
          canCloseAbove: false,
          canOpenAllShortcuts: false,
          canQuickGroupSameSite: false,
          canGroupAll: false,
          canCloseOtherSameSite: false,
          canDissolveTree: false,
          canDeleteSubtree: false,
        }),
        getGroups: () => [],
        getRecentlyClosedSessionId: () => undefined,
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));

    const unavailableActions = [
      "duplicate",
      "open-all-shortcuts",
      "group-same-site",
      "group-all",
      "dissolve-tree",
      "delete-subtree",
      "close-below",
      "close-above",
      "close-same-site",
      "restore-recently-closed",
    ];
    for (const action of unavailableActions) {
      const item = popup.querySelector<HTMLButtonElement>(`[data-menu-action='${action}']`)!;
      expect(item.hidden).toBe(true);
      expect(item.disabled).toBe(false);
    }

    const visibleItems = Array.from(popup.children).filter((item) => !item.hasAttribute("hidden"));
    expect(visibleItems.map((item) => ({
      action: item instanceof HTMLButtonElement ? item.dataset.menuAction : undefined,
      role: item.getAttribute("role"),
    }))).toEqual([
      { action: "set-pinned", role: "menuitem" },
      { action: "add-shortcut", role: "menuitem" },
      { action: undefined, role: "separator" },
      { action: "add-to-group", role: "menuitem" },
    ]);
    expect(visibleItems[0]?.getAttribute("role")).not.toBe("separator");
    expect(visibleItems.at(-1)?.getAttribute("role")).not.toBe("separator");
    for (let index = 1; index < visibleItems.length; index += 1) {
      expect(
        visibleItems[index - 1]?.getAttribute("role") === "separator"
          && visibleItems[index]?.getAttribute("role") === "separator",
      ).toBe(false);
    }
    menu.destroy();
  });

  it("hides group membership commands when the tab cannot change groups", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, { canManageGroupMembership: false }),
        getGroups: () => groups,
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(2));

    for (const action of ["add-to-group", "remove-from-group"]) {
      const item = popup.querySelector<HTMLButtonElement>(`[data-menu-action='${action}']`)!;
      expect(item.hidden).toBe(true);
      expect(item.disabled).toBe(false);
    }
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

  it("shows add-bookmark after an asynchronous check and dispatches it by mouse and keyboard", async () => {
    const onCommand = vi.fn();
    const canAddBookmark = vi.fn(async () => true);
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], canAddBookmark, onCommand },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    const firstEvent = context(row(1));
    expect(firstEvent.defaultPrevented).toBe(true);
    expect(popup.hidden).toBe(true);
    await vi.waitFor(() => expect(popup.hidden).toBe(false));
    const addBookmark = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='add-bookmark']",
    )!;
    expect(addBookmark.hidden).toBe(false);
    expect(addBookmark.textContent).toBe("添加到收藏夹");
    addBookmark.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "add-bookmark", tabId: 1 });

    context(row(2));
    await vi.waitFor(() => expect(row(2).dataset.contextSelected).toBe("true"));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(addBookmark);
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenLastCalledWith({ action: "add-bookmark", tabId: 2 });
    expect(canAddBookmark).toHaveBeenCalledTimes(2);
    menu.destroy();
  });

  it.each([
    ["already bookmarked", false],
    ["unsupported URL", false],
  ])("hides add-bookmark for %s while opening the remaining actions", async (_case, result) => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        canAddBookmark: vi.fn(async () => result),
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));
    await vi.waitFor(() => expect(popup.hidden).toBe(false));

    expect(popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='add-bookmark']",
    )?.hidden).toBe(true);
    expect(popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='duplicate']",
    )?.hidden).toBe(false);
    menu.destroy();
  });

  it("hides add-bookmark when its query rejects without blocking other actions", async () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        canAddBookmark: vi.fn(async () => {
          throw new Error("query failed");
        }),
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));
    await vi.waitFor(() => expect(popup.hidden).toBe(false));

    expect(popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='add-bookmark']",
    )?.hidden).toBe(true);
    expect(popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='set-pinned']",
    )?.hidden).toBe(false);
    menu.destroy();
  });

  it("does not let a stale first query open over a newer request", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const canAddBookmark = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onBeforeOpen = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: menuContext,
        getGroups: () => [],
        canAddBookmark,
        onBeforeOpen,
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));
    context(row(2));
    second.resolve(false);
    await vi.waitFor(() => expect(row(2).dataset.contextSelected).toBe("true"));
    expect(popup.hidden).toBe(false);
    expect(onBeforeOpen).toHaveBeenCalledOnce();

    first.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(row(1).dataset.contextSelected).toBeUndefined();
    expect(row(2).dataset.contextSelected).toBe("true");
    expect(popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='add-bookmark']",
    )?.hidden).toBe(true);
    expect(onBeforeOpen).toHaveBeenCalledOnce();
    menu.destroy();
  });

  it("clears an open menu while a newer bookmark lookup is pending", async () => {
    const second = deferred<boolean>();
    const canAddBookmark = vi.fn()
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(second.promise);
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getContext: menuContext, getGroups: () => [], canAddBookmark, onCommand },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));
    await vi.waitFor(() => expect(row(1).dataset.contextSelected).toBe("true"));
    const oldAddBookmark = popup.querySelector<HTMLButtonElement>(
      "[data-menu-action='add-bookmark']",
    )!;

    context(row(2));

    expect(popup.hidden).toBe(true);
    expect(row(1).dataset.contextSelected).toBeUndefined();
    expect(row(2).dataset.contextSelected).toBeUndefined();
    oldAddBookmark.click();
    expect(onCommand).not.toHaveBeenCalled();

    second.resolve(true);
    await vi.waitFor(() => expect(row(2).dataset.contextSelected).toBe("true"));
    expect(popup.hidden).toBe(false);
    menu.destroy();
  });

  it("does not open when the row or tab URL changes during the bookmark query", async () => {
    const availability = deferred<boolean>();
    let currentUrl = tabs[0]!.url;
    const getContext = (id: number) => {
      const result = menuContext(id);
      return result && { ...result, tab: { ...result.tab, url: currentUrl } };
    };
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext,
        getGroups: () => [],
        canAddBookmark: () => availability.promise,
        onCommand: vi.fn(),
      },
    );
    const popup = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu)",
    )!;

    context(row(1));
    currentUrl = "https://changed.example/";
    availability.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(popup.hidden).toBe(true);
    expect(row(1).dataset.contextSelected).toBeUndefined();
    menu.destroy();
  });

  it.each(["close", "scroll", "resize", "destroy"] as const)(
    "invalidates a pending bookmark query on %s",
    async (closePath) => {
      const availability = deferred<boolean>();
      const menu = createTabContextMenu(
        { document, list, viewport: window },
        {
          getContext: menuContext,
          getGroups: () => [],
          canAddBookmark: () => availability.promise,
          onCommand: vi.fn(),
        },
      );
      const popup = document.querySelector<HTMLElement>(
        ".tab-context-menu:not(.tab-context-submenu)",
      )!;
      context(row(1));

      if (closePath === "close") menu.close();
      else if (closePath === "scroll") list.dispatchEvent(new Event("scroll"));
      else if (closePath === "resize") window.dispatchEvent(new Event("resize"));
      else menu.destroy();
      availability.resolve(true);
      await Promise.resolve();
      await Promise.resolve();

      if (closePath === "destroy") {
        expect(document.querySelector(".tab-context-menu")).toBeNull();
      } else {
        expect(popup.hidden).toBe(true);
        menu.destroy();
      }
    },
  );

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

  it("hides close-below without a following tab and skips it during navigation", () => {
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
    expect(closeBelow.hidden).toBe(true);
    expect(closeBelow.disabled).toBe(false);
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
          canQuickGroupSameSite: id === 1,
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

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const)(
    "configures quick-site=%s and group-all=%s independently",
    (canQuickGroupSameSite, canGroupAll) => {
      const menu = createTabContextMenu(
        { document, list, viewport: window },
        {
          getContext: (id) => menuContext(id, { canQuickGroupSameSite, canGroupAll }),
          getGroups: () => [],
          onCommand: vi.fn(),
        },
      );

      context(row(1));
      const groupSameSite = document.querySelector<HTMLButtonElement>(
        "[data-menu-action='group-same-site']",
      )!;
      const groupAll = document.querySelector<HTMLButtonElement>(
        "[data-menu-action='group-all']",
      )!;
      expect(groupSameSite.hidden).toBe(!canQuickGroupSameSite);
      expect(groupAll.hidden).toBe(!canGroupAll);
      expect(groupSameSite.disabled).toBe(false);
      expect(groupAll.disabled).toBe(false);
      menu.destroy();
    },
  );

  it("skips hidden grouping actions and dispatches mouse, Enter, and Space commands", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      {
        getContext: (id) => menuContext(id, {
          canQuickGroupSameSite: id === 1,
          canGroupAll: id === 2,
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
    const groupAll = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-all']")!;
    const closeSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='close-same-site']")!;
    expect(groupSameSite.hidden).toBe(false);
    expect(groupAll.hidden).toBe(true);
    expect(closeSameSite.hidden).toBe(true);
    closeSameSite.click();
    closeSameSite.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    closeSameSite.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).not.toHaveBeenCalled();
    groupSameSite.click();
    expect(onCommand).toHaveBeenCalledWith({ action: "group-same-site", tabId: 1 });

    context(row(2));
    const keyboardGroupSameSite = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-same-site']")!;
    const keyboardGroupAll = popup.querySelector<HTMLButtonElement>("[data-menu-action='group-all']")!;
    expect(keyboardGroupSameSite.hidden).toBe(true);
    expect(keyboardGroupAll.hidden).toBe(false);
    popup.querySelector<HTMLButtonElement>("[data-menu-action='remove-from-group']")!.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(keyboardGroupAll);
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommand).toHaveBeenLastCalledWith({ action: "group-all", tabId: 2 });

    context(row(2));
    keyboardGroupAll.focus();
    popup.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).toHaveBeenLastCalledWith({ action: "group-all", tabId: 2 });

    context(row(2));
    keyboardGroupAll.click();
    expect(onCommand).toHaveBeenLastCalledWith({ action: "group-all", tabId: 2 });

    context(row(2));
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
        canQuickGroupSameSite: true,
        canGroupAll: false,
        canManageGroupMembership: true,
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
    )?.hidden).toBe(true);
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

  it("hides restore-recently-closed without a session and skips it during navigation", () => {
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
    expect(restore.hidden).toBe(true);
    expect(restore.disabled).toBe(false);
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
    const menu = createTabContextMenu(
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
    expect(groupItems[0]?.hidden).toBe(true);
    expect(groupItems[0]?.disabled).toBe(false);

    groupItems[2]?.click();
    expect(onCommand).toHaveBeenCalledWith({ action: "add-to-group", tabId: 2, groupId: 5 });
    expect(popup.hidden).toBe(true);
    expect(submenu.hidden).toBe(true);
    menu.destroy();
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
    const menu = createTabContextMenu(
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
    menu.destroy();
  });

  it("supports right, left, vertical navigation, activation, and Escape across both levels", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
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
    menu.destroy();
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
