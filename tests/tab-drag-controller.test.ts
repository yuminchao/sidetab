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
  let groupRow: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="list">
      <div class="tab-row" data-tab-id="1" draggable="true"><button class="tab-close">x</button></div>
      <div class="tab-group-row" data-group-id="7" data-collapsed="true"><button class="tab-group-main">Group</button></div>
      <div class="tab-row" data-tab-id="2" draggable="true"></div>
      <div class="tab-row" data-tab-id="3" draggable="true"></div>
    </div>`;
    list = document.querySelector("#list")!;
    rows = Array.from(list.querySelectorAll<HTMLElement>(".tab-row"));
    groupRow = list.querySelector(".tab-group-row")!;
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
      expect(onDrop).toHaveBeenCalledWith({
        sourceId: 3,
        target: { kind: "tab", tabId: 2, placement },
      });
      expect(list.querySelector("[data-drop-placement]")).toBeNull();
      expect(list.querySelector("[data-drag-source]")).toBeNull();
      controller.destroy();
    },
  );

  it("accepts a collapsed group header as a target without showing a tab insertion line", () => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });

    drag(rows[2]!, "dragstart");
    const over = drag(groupRow.querySelector(".tab-group-main")!, "dragover", 11);

    expect(over.defaultPrevented).toBe(true);
    expect(groupRow.dataset.dropTarget).toBe("true");
    expect(list.querySelector("[data-drop-placement]")).toBeNull();

    drag(groupRow, "drop", 11);

    expect(onDrop).toHaveBeenCalledWith({
      sourceId: 3,
      target: { kind: "group", groupId: 7 },
    });
    expect(list.querySelector("[data-drop-target], [data-drag-source]")).toBeNull();
    controller.destroy();
  });

  it("allows a group header only as a target, never as a drag source", () => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });
    groupRow.draggable = true;

    const started = drag(groupRow, "dragstart");
    drag(rows[0]!, "dragover", 11);
    drag(rows[0]!, "drop", 11);

    expect(started.defaultPrevented).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

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

  it("cancels without dispatch when the source row disappears", () => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });

    drag(rows[0]!, "dragstart");
    rows[0]!.remove();
    const over = drag(rows[1]!, "dragover", 11);
    drag(rows[1]!, "drop", 11);

    expect(over.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector("[data-drop-placement], [data-drop-target], [data-drag-source]")).toBeNull();
    controller.destroy();
  });

  it.each([
    ["leaves the list", (list: HTMLElement, target: HTMLElement) => {
      const event = new Event("dragleave", { bubbles: true });
      Object.defineProperty(event, "relatedTarget", { value: document.body });
      target.dispatchEvent(event);
    }],
    ["the list scrolls", (list: HTMLElement) => list.dispatchEvent(new Event("scroll"))],
  ])("clears drag feedback when %s", (_reason, interrupt) => {
    const onDrop = vi.fn();
    const controller = createTabDragController({ list }, { onDrop });

    drag(rows[0]!, "dragstart");
    drag(rows[1]!, "dragover", 11);
    interrupt(list, rows[1]!);
    drag(rows[1]!, "drop", 11);

    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector("[data-drop-placement], [data-drop-target], [data-drag-source]")).toBeNull();
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
    expect(list.querySelector("[data-drop-placement], [data-drop-target], [data-drag-source]")).toBeNull();
  });
});
