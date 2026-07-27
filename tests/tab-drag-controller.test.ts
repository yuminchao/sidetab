import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabDragController } from "../src/sidepanel/tab-drag-controller";

function drag(target: Element, type: string, clientY = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  target.dispatchEvent(event);
  return event;
}

describe("tab drag controller", () => {
  let list: HTMLElement;
  let rows: HTMLElement[];

  beforeEach(() => {
    document.body.innerHTML = `<div id="list">
      <div class="tab-row" data-tab-id="1" draggable="true"><button class="tab-close">x</button></div>
      <div class="tab-row" data-tab-id="2" draggable="true"></div>
      <div class="tab-row" data-tab-id="3" draggable="true"></div>
    </div>`;
    list = document.querySelector("#list")!;
    rows = Array.from(list.querySelectorAll<HTMLElement>(".tab-row"));
    for (const row of rows) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: 10, height: 30, bottom: 40, left: 0, right: 100, width: 100,
        x: 0, y: 10, toJSON: () => ({}),
      });
    }
  });

  it.each([[11, "before"], [39, "after"]] as const)(
    "emits one drop intent for the target half at y=%s",
    (clientY, placement) => {
      const onDrop = vi.fn();
      const controller = createTabDragController({ list }, { onDrop });

      drag(rows[2]!, "dragstart");
      const over = drag(rows[1]!, "dragover", clientY);
      expect(over.defaultPrevented).toBe(true);
      expect(rows[1]!.dataset.dropPlacement).toBe(placement);
      expect(rows[2]!.dataset.dragSource).toBe("true");
      drag(rows[1]!, "drop", clientY);

      expect(onDrop).toHaveBeenCalledOnce();
      expect(onDrop).toHaveBeenCalledWith({ sourceId: 3, targetId: 2, placement });
      expect(list.querySelector("[data-drop-placement]")).toBeNull();
      expect(list.querySelector("[data-drag-source]")).toBeNull();
      controller.destroy();
    },
  );

  it("does not start dragging from the close button", () => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });
    const started = drag(rows[0]!.querySelector(".tab-close")!, "dragstart");
    drag(rows[1]!, "dragover", 11);
    drag(rows[1]!, "drop", 11);
    expect(started.defaultPrevented).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("cancels same-row, invalid, ended, and destroyed drags without dispatch", () => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });
    drag(rows[0]!, "dragstart");
    drag(rows[0]!, "dragover", 11);
    drag(rows[0]!, "drop", 11);
    drag(rows[1]!, "dragstart");
    drag(rows[2]!, "dragover", 11);
    drag(rows[1]!, "dragend");
    controller.destroy();
    drag(rows[2]!, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector("[data-drop-placement], [data-drag-source]")).toBeNull();
  });
});
