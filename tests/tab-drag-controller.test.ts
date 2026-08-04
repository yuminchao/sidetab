import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabDragController } from "../src/sidepanel/tab-drag-controller";

function drag(target: Element, type: string, clientY = 0, relatedTarget?: Node): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  if (relatedTarget !== undefined) Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  target.dispatchEvent(event);
  return event;
}

const dirtySelector = "[data-drag-source], [data-drag-group-source], [data-drop-placement], [data-drop-target]";

describe("tab drag controller", () => {
  let scroller: HTMLElement;
  let list: HTMLElement;
  let tabs: Map<number, HTMLElement>;
  let groups: Map<number, HTMLElement>;

  beforeEach(() => {
    document.body.innerHTML = `<div id="scroller"><div id="list">
      <div class="tab-row" data-tab-id="1" data-pinned="true" draggable="true"><button class="tab-close">x</button></div>
      <div class="tab-group-row" data-group-id="7" data-collapsed="false" draggable="true"><button class="tab-group-main">Seven</button></div>
      <div class="tab-row" data-tab-id="2" data-group-id="7" draggable="true"></div>
      <div class="tab-row" data-tab-id="3" data-group-id="7" draggable="true"></div>
      <div class="tab-group-row" data-group-id="8" data-collapsed="false" draggable="true"><button class="tab-group-main">Eight</button></div>
      <div class="tab-row" data-tab-id="4" data-group-id="8" draggable="true"></div>
      <div class="tab-row" data-tab-id="5" data-group-id="8" draggable="true"></div>
      <div class="tab-group-row" data-group-id="9" data-collapsed="true" draggable="true"><button class="tab-group-main">Nine</button></div>
      <div class="tab-row" data-tab-id="6" draggable="true"></div>
    </div></div>`;
    scroller = document.querySelector("#scroller")!;
    list = document.querySelector("#list")!;
    tabs = new Map(Array.from(list.querySelectorAll<HTMLElement>(".tab-row"), row => [Number(row.dataset.tabId), row]));
    groups = new Map(Array.from(list.querySelectorAll<HTMLElement>(".tab-group-row"), row => [Number(row.dataset.groupId), row]));
    for (const row of Array.from(list.querySelectorAll<HTMLElement>(".tab-row, .tab-group-row"))) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: 10, height: 30, bottom: 40, left: 0, right: 100, width: 100,
        x: 0, y: 10, toJSON: () => ({}),
      });
    }
  });

  const create = (onDrop = vi.fn(), canStartGroupDrag?: (groupId: number) => boolean) => ({
    onDrop,
    controller: createTabDragController({ list, viewport: window }, { onDrop, canStartGroupDrag }),
  });

  it.each([[11, "before"], [39, "after"]] as const)(
    "keeps single-tab drop intent semantics at y=%s",
    (clientY, placement) => {
      const { onDrop, controller } = create();
      drag(tabs.get(3)!, "dragstart");
      expect(drag(tabs.get(6)!, "dragover", clientY).defaultPrevented).toBe(true);
      expect(tabs.get(6)!.dataset.dropPlacement).toBe(placement);
      expect(tabs.get(3)!.dataset.dragSource).toBe("true");
      drag(tabs.get(6)!, "drop", clientY);
      expect(onDrop).toHaveBeenCalledWith({
        kind: "tab", sourceId: 3, target: { kind: "tab", tabId: 6, placement },
      });
      expect(list.querySelector(dirtySelector)).toBeNull();
      controller.destroy();
    },
  );

  it("keeps a collapsed group header as a merge target for a single tab", () => {
    const { onDrop, controller } = create();
    drag(tabs.get(3)!, "dragstart");
    drag(groups.get(9)!.querySelector(".tab-group-main")!, "dragover", 11);
    expect(groups.get(9)!.dataset.dropTarget).toBe("true");
    drag(groups.get(9)!, "drop", 11);
    expect(onDrop).toHaveBeenCalledWith({ kind: "tab", sourceId: 3, target: { kind: "group", groupId: 9 } });
    controller.destroy();
  });

  it.each([[11, "before"], [39, "after"]] as const)(
    "emits a group intent when hovering a target group header at y=%s",
    (clientY, placement) => {
      const { onDrop, controller } = create();
      drag(groups.get(7)!, "dragstart");
      expect(groups.get(7)!.dataset.dragGroupSource).toBe("true");
      expect(tabs.get(2)!.dataset.dragGroupSource).toBe("true");
      expect(tabs.get(3)!.dataset.dragGroupSource).toBe("true");
      drag(groups.get(8)!.querySelector(".tab-group-main")!, "dragover", clientY);
      const boundary = placement === "before" ? groups.get(8)! : tabs.get(5)!;
      expect(boundary.dataset.dropPlacement).toBe(placement);
      expect(groups.get(8)!.dataset.dropTarget).toBe("true");
      drag(groups.get(8)!, "drop", clientY);
      expect(onDrop).toHaveBeenCalledWith({
        kind: "group", sourceGroupId: 7, target: { kind: "group", groupId: 8, placement },
      });
      expect(list.querySelector(dirtySelector)).toBeNull();
      controller.destroy();
    },
  );

  it("normalizes a target member to its group while using the complete block boundary", () => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(4)!, "dragover", 39);
    expect(tabs.get(4)!.dataset.dropPlacement).toBeUndefined();
    expect(tabs.get(5)!.dataset.dropPlacement).toBe("after");
    drag(tabs.get(4)!, "drop", 39);
    expect(onDrop).toHaveBeenCalledWith({
      kind: "group", sourceGroupId: 7, target: { kind: "group", groupId: 8, placement: "after" },
    });
    controller.destroy();
  });

  it("keeps an ungrouped tab as a tab target for group dragging", () => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(6)!, "dragover", 11);
    drag(tabs.get(6)!, "drop", 11);
    expect(onDrop).toHaveBeenCalledWith({
      kind: "group", sourceGroupId: 7, target: { kind: "tab", tabId: 6, placement: "before" },
    });
    controller.destroy();
  });

  it.each([
    ["a pinned tab", () => tabs.get(1)!],
    ["its own header", () => groups.get(7)!],
    ["one of its own members", () => tabs.get(2)!],
  ])("rejects %s as a group target", (_name, target) => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    expect(drag(target(), "dragover", 11).defaultPrevented).toBe(false);
    drag(target(), "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("rejects invalid group IDs and a denied group source", () => {
    const { onDrop, controller } = create(vi.fn(), () => false);
    drag(groups.get(7)!, "dragstart");
    expect(list.querySelector("[data-drag-group-source]")).toBeNull();
    groups.get(7)!.dataset.groupId = "invalid";
    expect(drag(groups.get(7)!, "dragstart").defaultPrevented).toBe(true);
    drag(groups.get(8)!, "dragover", 11);
    drag(groups.get(8)!, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("rejects empty group and tab IDs instead of treating them as zero", () => {
    const { onDrop, controller } = create();
    groups.get(7)!.dataset.groupId = "";
    expect(drag(groups.get(7)!, "dragstart").defaultPrevented).toBe(true);
    groups.get(7)!.dataset.groupId = "7";
    drag(groups.get(7)!, "dragstart");
    tabs.get(6)!.dataset.tabId = "";
    expect(drag(tabs.get(6)!, "dragover", 11).defaultPrevented).toBe(false);
    drag(tabs.get(6)!, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("does not reuse stale feedback when drop occurs on a different target", () => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(4)!, "dragover", 11);
    drag(list, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector(dirtySelector)).toBeNull();
    controller.destroy();
  });

  it("does not start tab dragging from the close button", () => {
    const { onDrop, controller } = create();
    expect(drag(tabs.get(1)!.querySelector(".tab-close")!, "dragstart").defaultPrevented).toBe(true);
    drag(tabs.get(6)!, "dragover", 11);
    drag(tabs.get(6)!, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it.each([
    ["dragend", (controller: ReturnType<typeof createTabDragController>) => drag(groups.get(7)!, "dragend")],
    ["leaving the list", (_controller: ReturnType<typeof createTabDragController>) => drag(tabs.get(4)!, "dragleave", 0, document.body)],
    ["the captured parent scrolling", (_controller: ReturnType<typeof createTabDragController>) => scroller.dispatchEvent(new Event("scroll"))],
    ["viewport resize", (_controller: ReturnType<typeof createTabDragController>) => window.dispatchEvent(new Event("resize"))],
    ["cancel", (controller: ReturnType<typeof createTabDragController>) => controller.cancel()],
    ["matching cancelForGroup", (controller: ReturnType<typeof createTabDragController>) => controller.cancelForGroup(7)],
  ])("clears all state on %s", (_name, interrupt) => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(4)!, "dragover", 39);
    interrupt(controller);
    drag(tabs.get(4)!, "drop", 39);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector(dirtySelector)).toBeNull();
    controller.destroy();
  });

  it("ignores an unrelated cancelForGroup and a dragleave that remains inside the list", () => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(4)!, "dragover", 11);
    controller.cancelForGroup(8);
    drag(tabs.get(4)!, "dragleave", 0, tabs.get(5)!);
    drag(tabs.get(4)!, "drop", 11);
    expect(onDrop).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it.each(["source", "target"])("cancels when the %s is removed", (removed) => {
    const { onDrop, controller } = create();
    drag(groups.get(7)!, "dragstart");
    drag(tabs.get(4)!, "dragover", 39);
    (removed === "source" ? groups.get(7)! : tabs.get(5)!).remove();
    drag(tabs.get(4)!, "drop", 39);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector(dirtySelector)).toBeNull();
    controller.destroy();
  });

  it("destroy clears state and removes parent-scroll and viewport listeners", () => {
    const { onDrop, controller } = create();
    controller.destroy();
    drag(groups.get(7)!, "dragstart");
    scroller.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    drag(groups.get(8)!, "drop", 11);
    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector(dirtySelector)).toBeNull();
  });
});
