import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_GROUP_COLORS,
  type TabGroupViewModel,
} from "../src/sidepanel/tab-group-model";
import { createTabGroupContextMenu } from "../src/sidepanel/tab-group-context-menu";

const group: TabGroupViewModel = {
  id: 7,
  windowId: 10,
  title: "工作",
  color: "blue",
  collapsed: false,
};

function context(target: Element, x = 20, y = 30): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
}

describe("tab group context menu", () => {
  let list: HTMLElement;
  let row: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-scroll">
        <div id="list">
          <div class="tab-group-row" data-group-id="7" data-group-color="blue">
            <button class="tab-group-main">工作</button>
          </div>
        </div>
      </div>`;
    list = document.querySelector("#list")!;
    row = document.querySelector(".tab-group-row")!;
  });

  it("opens a bounded two-section menu and dispatches primary commands", () => {
    const onBeforeOpen = vi.fn();
    const onCommand = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      { getGroup: () => group, isGroupBusy: () => false, canCloseGroup: () => true, onBeforeOpen, onCommand },
    );
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 150, bottom: 120, width: 150, height: 120,
      x: 0, y: 0, toJSON: () => ({}),
    });

    const event = context(row, window.innerWidth - 2, window.innerHeight - 2);
    expect(event.defaultPrevented).toBe(true);
    expect(onBeforeOpen).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe(`${window.innerWidth - 150}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 120}px`);
    expect(row.dataset.contextSelected).toBe("true");
    expect(Array.from(menu.children, (child) => child instanceof HTMLButtonElement
      ? child.dataset.groupMenuAction
      : child.className)).toEqual([
      "new-tab",
      "rename",
      "set-color",
      "tab-context-separator",
      "dissolve",
      "close",
    ]);
    expect(Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button"), (button) => button.textContent)).toEqual([
      "在分组中新建标签页",
      "重命名分组",
      "修改颜色",
      "解散分组",
      "关闭分组",
    ]);
    expect(document.activeElement).toBe(menu.querySelector("[data-group-menu-action='new-tab']"));

    for (const action of ["new-tab", "rename", "dissolve", "close"] as const) {
      context(row);
      menu.querySelector<HTMLButtonElement>(`[data-group-menu-action='${action}']`)!.click();
      expect(onCommand).toHaveBeenLastCalledWith({ action, groupId: 7 });
      expect(menu.hidden).toBe(true);
      expect(row.hasAttribute("data-context-selected")).toBe(false);
    }
    controller.destroy();
  });

  it("renders nine colors in order and dispatches a new color", () => {
    const onCommand = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      { getGroup: () => group, isGroupBusy: () => false, canCloseGroup: () => true, onBeforeOpen: vi.fn(), onCommand },
    );
    context(row);
    const colorTrigger = document.querySelector<HTMLButtonElement>("[data-group-menu-action='set-color']")!;
    expect(colorTrigger.getAttribute("aria-haspopup")).toBe("menu");
    vi.spyOn(colorTrigger, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 20,
      left: window.innerWidth - 20,
      right: window.innerWidth - 10,
      bottom: window.innerHeight - 10,
      width: 10,
      height: 10,
      x: window.innerWidth - 20,
      y: window.innerHeight - 20,
      toJSON: () => ({}),
    });
    const submenu = document.querySelector<HTMLElement>(".tab-group-color-submenu")!;
    vi.spyOn(submenu, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 150, bottom: 180, width: 150, height: 180,
      x: 0, y: 0, toJSON: () => ({}),
    });
    colorTrigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(submenu.hidden).toBe(false);
    expect(submenu.style.left).toBe(`${window.innerWidth - 170}px`);
    expect(submenu.style.top).toBe(`${window.innerHeight - 180}px`);
    expect(colorTrigger.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(submenu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']"));
    expect(items.map((item) => item.dataset.color)).toEqual(TAB_GROUP_COLORS);
    expect(items.map((item) => item.textContent)).toEqual([
      "灰色", "蓝色", "红色", "黄色", "绿色", "粉色", "紫色", "青色", "橙色",
    ]);
    expect(items[1]?.getAttribute("aria-checked")).toBe("true");
    expect(items[1]?.disabled).toBe(true);
    expect(items.every((item) => item.querySelector(".group-menu-color"))).toBe(true);

    items[2]!.click();
    expect(onCommand).toHaveBeenCalledWith({ action: "set-color", groupId: 7, color: "red" });
    expect(submenu.hidden).toBe(true);
    expect(row.hasAttribute("data-context-selected")).toBe(false);
    controller.destroy();
  });

  it("supports keyboard navigation and skips the current color", () => {
    const onCommand = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      { getGroup: () => group, isGroupBusy: () => false, canCloseGroup: () => true, onBeforeOpen: vi.fn(), onCommand },
    );
    row.querySelector<HTMLElement>(".tab-group-main")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    );
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    const colorTrigger = menu.querySelector<HTMLButtonElement>("[data-group-menu-action='set-color']")!;
    colorTrigger.focus();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    const submenu = document.querySelector<HTMLElement>(".tab-group-color-submenu")!;
    const grey = submenu.querySelector<HTMLButtonElement>("[data-color='grey']")!;
    const red = submenu.querySelector<HTMLButtonElement>("[data-color='red']")!;
    expect(document.activeElement).toBe(grey);
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(red);
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(grey);
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(submenu.querySelector("[data-color='orange']"));
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(submenu.hidden).toBe(true);
    expect(document.activeElement).toBe(colorTrigger);

    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(row.querySelector(".tab-group-main"));

    context(row);
    colorTrigger.focus();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    submenu.querySelector<HTMLButtonElement>("[data-color='red']")!.focus();
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onCommand).toHaveBeenCalledWith({ action: "set-color", groupId: 7, color: "red" });
    controller.destroy();
  });

  it("disables all commands while the group is busy", () => {
    const onCommand = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      { getGroup: () => group, isGroupBusy: () => true, canCloseGroup: () => true, onBeforeOpen: vi.fn(), onCommand },
    );
    context(row);
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button"));
    expect(buttons.every((button) => button.disabled)).toBe(true);
    buttons.forEach((button) => button.click());
    expect(onCommand).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("disables close-group when the group has no members", () => {
    const onCommand = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      {
        getGroup: () => group,
        isGroupBusy: () => false,
        canCloseGroup: () => false,
        onBeforeOpen: vi.fn(),
        onCommand,
      },
    );
    context(row);
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    const close = menu.querySelector<HTMLButtonElement>("[data-group-menu-action='close']")!;
    expect(close.disabled).toBe(true);
    close.click();
    expect(onCommand).not.toHaveBeenCalled();
    expect(menu.hidden).toBe(false);
    controller.destroy();
  });

  it("enables close-group when the group has members", () => {
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      {
        getGroup: () => group,
        isGroupBusy: () => false,
        canCloseGroup: () => true,
        onBeforeOpen: vi.fn(),
        onCommand: vi.fn(),
      },
    );
    context(row);
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    expect(menu.querySelector<HTMLButtonElement>("[data-group-menu-action='close']")!.disabled)
      .toBe(false);
    controller.destroy();
  });

  it("cleans temporary state on external close paths and destroy", () => {
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      { getGroup: () => group, isGroupBusy: () => false, canCloseGroup: () => true, onBeforeOpen: vi.fn(), onCommand: vi.fn() },
    );
    const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
    const assertClosed = () => {
      expect(menu.hidden).toBe(true);
      expect(row.hasAttribute("data-context-selected")).toBe(false);
    };

    context(row);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    assertClosed();
    context(row);
    list.parentElement!.dispatchEvent(new Event("scroll"));
    assertClosed();
    context(row);
    window.dispatchEvent(new Event("resize"));
    assertClosed();
    context(row);
    controller.closeForGroup(7);
    assertClosed();
    context(row);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assertClosed();
    expect(document.activeElement).toBe(row.querySelector(".tab-group-main"));
    context(row);
    controller.destroy();
    expect(document.querySelector(".tab-group-context-menu")).toBeNull();
    expect(document.querySelector(".tab-group-color-submenu")).toBeNull();
    expect(row.hasAttribute("data-context-selected")).toBe(false);
  });

  it("ignores invalid targets and closes the old group before opening another", () => {
    const groups = [group, { ...group, id: 8, title: "其他", color: "red" as const }];
    list.insertAdjacentHTML("beforeend", `
      <div class="tab-group-row" data-group-id="8" data-group-color="red">
        <button class="tab-group-main">其他</button>
      </div>`);
    const onBeforeOpen = vi.fn();
    const controller = createTabGroupContextMenu(
      { document, list, viewport: window },
      {
        getGroup: (id) => groups.find((candidate) => candidate.id === id),
        isGroupBusy: () => false,
        canCloseGroup: () => true,
        onBeforeOpen,
        onCommand: vi.fn(),
      },
    );
    const invalid = context(list);
    expect(invalid.defaultPrevented).toBe(false);
    expect(onBeforeOpen).not.toHaveBeenCalled();
    context(row);
    const other = list.querySelector<HTMLElement>("[data-group-id='8']")!;
    context(other);
    expect(row.hasAttribute("data-context-selected")).toBe(false);
    expect(other.dataset.contextSelected).toBe("true");
    expect(onBeforeOpen).toHaveBeenCalledTimes(2);
    controller.destroy();
  });
});
