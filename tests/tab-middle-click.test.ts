import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabMiddleClickController } from "../src/sidepanel/tab-middle-click";

function mouse(target: Element, type: "mousedown" | "auxclick", button: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
  return event;
}

describe("tab middle-click controller", () => {
  let container: HTMLElement;
  let list: HTMLElement;
  let mainContent: HTMLElement;
  let closeButton: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<main id="container">
      <div id="list">
        <div class="tab-group-header">Group</div>
        <div class="tab-row" data-tab-id="7">
          <button class="tab-main"><span class="tab-title">Seven</span></button>
          <button class="tab-close">Close</button>
        </div>
        <div class="tab-row" data-tab-id="1.5">Fractional</div>
        <div class="tab-row" data-tab-id="">Empty id</div>
        <div class="tab-row" data-tab-id="not-a-number">Invalid id</div>
      </div>
      <button id="outside">Outside</button>
    </main>`;
    container = document.querySelector("#container")!;
    list = document.querySelector("#list")!;
    mainContent = document.querySelector(".tab-title")!;
    closeButton = document.querySelector(".tab-close")!;
  });

  it("prevents middle-button mousedown on a tab without closing it", () => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });

    const event = mouse(mainContent, "mousedown", 1);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("closes once and consumes middle auxclick from the main button", () => {
    const onClose = vi.fn();
    const bubbled = vi.fn();
    container.addEventListener("auxclick", bubbled);
    const controller = createTabMiddleClickController({ list }, { onClose });

    const event = mouse(mainContent, "auxclick", 1);

    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(7);
    controller.destroy();
  });

  it("handles middle clicks in the close-button area as a row close", () => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });

    const down = mouse(closeButton, "mousedown", 1);
    const click = mouse(closeButton, "auxclick", 1);

    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(7);
    controller.destroy();
  });

  it("delegates middle clicks to a row inserted after controller creation", () => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });
    const row = document.createElement("div");
    row.className = "tab-row";
    row.dataset.tabId = "31";
    row.innerHTML = `<button class="tab-main"><span>Dynamic tab</span></button>`;
    list.append(row);
    const target = row.querySelector("span")!;

    const down = mouse(target, "mousedown", 1);
    const click = mouse(target, "auxclick", 1);

    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(31);
    controller.destroy();
  });

  it.each([
    ["group header", ".tab-group-header"],
    ["list whitespace", "#list"],
    ["fractional tab id", "[data-tab-id='1.5']"],
    ["empty tab id", "[data-tab-id='']"],
    ["non-numeric tab id", "[data-tab-id='not-a-number']"],
    ["outside the list", "#outside"],
  ])("ignores middle-button events on %s", (_case, selector) => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });
    const target = document.querySelector<HTMLElement>(selector)!;

    const down = mouse(target, "mousedown", 1);
    const click = mouse(target, "auxclick", 1);

    expect(down.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    controller.destroy();
  });

  it.each([0, 2])("ignores button %s on a tab row", (button) => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });

    const down = mouse(mainContent, "mousedown", button);
    const click = mouse(mainContent, "auxclick", button);

    expect(down.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("removes both listeners when destroyed and can be destroyed twice", () => {
    const onClose = vi.fn();
    const controller = createTabMiddleClickController({ list }, { onClose });

    expect(() => {
      controller.destroy();
      controller.destroy();
    }).not.toThrow();
    const down = mouse(mainContent, "mousedown", 1);
    const click = mouse(mainContent, "auxclick", 1);

    expect(down.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
