import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabContextMenu } from "../src/sidepanel/tab-context-menu";
import type { TabViewModel } from "../src/sidepanel/tab-model";

const tabs: TabViewModel[] = [
  { id: 1, windowId: 10, index: 0, title: "One", url: "https://one.example/", domain: "one.example", active: false, pinned: false },
  { id: 2, windowId: 10, index: 1, title: "Two", url: "https://two.example/", domain: "two.example", active: false, pinned: true },
];

function row(id: number): HTMLElement {
  return document.querySelector(`[data-tab-id='${id}']`)!;
}

function context(target: Element, x = 20, y = 30): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
}

describe("tab context menu", () => {
  let list: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="list"><button class="tab-row" data-tab-id="1">One</button><button class="tab-row" data-tab-id="2">Two</button></div>`;
    list = document.querySelector("#list")!;
  });

  it("opens one bounded menu and dispatches duplicate", () => {
    const onCommand = vi.fn();
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getTab: (id) => tabs.find((tab) => tab.id === id), onCommand },
    );
    const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
    vi.spyOn(popup, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 120, bottom: 60, width: 120, height: 60, x: 0, y: 0, toJSON: () => ({}) });

    const event = context(row(1), window.innerWidth - 2, window.innerHeight - 2);
    expect(event.defaultPrevented).toBe(true);
    expect(popup.hidden).toBe(false);
    expect(popup.style.left).toBe(`${window.innerWidth - 120}px`);
    expect(popup.style.top).toBe(`${window.innerHeight - 60}px`);
    expect(document.querySelectorAll(".tab-context-menu")).toHaveLength(1);
    expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='duplicate']"));

    (popup.querySelector("[data-menu-action='duplicate']") as HTMLElement).click();
    expect(onCommand).toHaveBeenCalledWith({ action: "duplicate", tabId: 1 });
    expect(popup.hidden).toBe(true);
    menu.destroy();
  });

  it.each([[1, "固定标签", true], [2, "取消固定", false]] as const)(
    "uses the current pinned state for tab %s",
    (id, label, pinned) => {
      const onCommand = vi.fn();
      const menu = createTabContextMenu(
        { document, list, viewport: window },
        { getTab: (tabId) => tabs.find((tab) => tab.id === tabId), onCommand },
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
      { getTab: (id) => tabs.find((tab) => tab.id === id), onCommand },
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
    menu.destroy();
  });

  it("closes on outside input, scroll, resize, target removal, and destroy", () => {
    const menu = createTabContextMenu(
      { document, list, viewport: window },
      { getTab: (id) => tabs.find((tab) => tab.id === id), onCommand: vi.fn() },
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
});
