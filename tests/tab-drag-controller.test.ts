import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTabDragController } from "../src/sidepanel/tab-drag-controller";
import type { TabDropTarget } from "../src/sidepanel/tab-reorder-model";

function drag(
  target: Element,
  type: string,
  clientY = 0,
  relatedTarget?: Node,
  clientX = 0,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "clientX", { value: clientX });
  if (relatedTarget !== undefined) Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  target.dispatchEvent(event);
  return event;
}

const dirtySelector = [
  "[data-drag-source]",
  "[data-drag-group-source]",
  "[data-drop-placement]",
  "[data-drop-depth]",
  "[data-drop-target]",
].join(", ");

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

  const create = (
    onDrop = vi.fn(),
    canStartGroupDrag?: (groupId: number) => boolean,
    prepareTabDrag?: (sourceId: number) => (
      target: TabDropTarget,
      requestedDepth: number,
    ) => TabDropTarget | undefined,
    canDropTab?: (sourceId: number, target: TabDropTarget) => boolean,
  ) => ({
    onDrop,
    controller: createTabDragController(
      { list, viewport: window },
      { onDrop, canStartGroupDrag, prepareTabDrag, canDropTab },
    ),
  });

  it("previews and emits the resolved horizontal tree depth", () => {
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 300, bottom: 300, left: 0, right: 200, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    });
    const prepareTabDrag = vi.fn(() => (
      target: TabDropTarget,
      requestedDepth: number,
    ): TabDropTarget => target.kind === "group"
      ? target
      : {
          ...target,
          tree: { depth: requestedDepth, parentId: 6 },
        });
    const { onDrop, controller } = create(vi.fn(), undefined, prepareTabDrag);

    drag(tabs.get(3)!, "dragstart");
    drag(tabs.get(6)!, "dragover", 39, undefined, 28);
    expect(tabs.get(6)!.dataset.dropDepth).toBe("2");
    drag(tabs.get(6)!, "drop", 39, undefined, 28);

    expect(prepareTabDrag).toHaveBeenCalledWith(3);
    expect(onDrop).toHaveBeenCalledWith({
      kind: "tab",
      sourceId: 3,
      target: {
        kind: "tab",
        tabId: 6,
        placement: "after",
        tree: { depth: 2, parentId: 6 },
      },
    });
    controller.destroy();
  });

  it("cancels when the resolved tree parent disappears before drop", () => {
    const prepareTabDrag = () => (target: TabDropTarget): TabDropTarget =>
      target.kind === "group" ? target : { ...target, tree: { depth: 1, parentId: 2 } };
    const { onDrop, controller } = create(vi.fn(), undefined, prepareTabDrag);

    drag(tabs.get(3)!, "dragstart");
    drag(tabs.get(6)!, "dragover", 39, undefined, 16);
    tabs.get(2)!.remove();
    drag(tabs.get(6)!, "drop", 39, undefined, 16);

    expect(onDrop).not.toHaveBeenCalled();
    expect(list.querySelector(dirtySelector)).toBeNull();
    controller.destroy();
  });

  it("cancels before dispatch when the latest tab state rejects the target", () => {
    let valid = true;
    const canDropTab = vi.fn(() => valid);
    const { onDrop, controller } = create(vi.fn(), undefined, undefined, canDropTab);

    drag(tabs.get(3)!, "dragstart");
    drag(tabs.get(6)!, "dragover", 39);
    valid = false;
    drag(tabs.get(6)!, "drop", 39);

    expect(canDropTab).toHaveBeenCalledWith(3, {
      kind: "tab", tabId: 6, placement: "after",
    });
    expect(onDrop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("uses the last row within four pixels and a root tail target beyond it", () => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".tab-row, .tab-group-row"));
    rows.forEach((row, index) => {
      const top = index * 34;
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top,
        height: 30,
        bottom: top + 30,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 500, bottom: 500, left: 0, right: 200, width: 200,
      x: 0, y: 0, toJSON: () => ({}),
    });
    const prepareTabDrag = () => (
      target: TabDropTarget,
      requestedDepth: number,
    ): TabDropTarget => target.kind === "group"
      ? target
      : { ...target, tree: { depth: target.kind === "end" ? 0 : requestedDepth } };
    const { onDrop, controller } = create(vi.fn(), undefined, prepareTabDrag);
    const lastBottom = 8 * 34 + 30;

    drag(tabs.get(3)!, "dragstart");
    drag(list, "dragover", lastBottom + 4, undefined, 16);
    expect(tabs.get(6)!.dataset.dropPlacement).toBe("after");

    drag(list, "dragover", lastBottom + 5, undefined, 40);
    expect(tabs.get(6)!.dataset.dropPlacement).toBeUndefined();
    expect(list.dataset).toMatchObject({ dropPlacement: "after", dropDepth: "0" });
    drag(list, "drop", lastBottom + 5, undefined, 40);
    expect(onDrop).toHaveBeenCalledWith({
      kind: "tab",
      sourceId: 3,
      target: { kind: "end", tree: { depth: 0 } },
    });
    controller.destroy();
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
    ["group", () => groups.get(7)!, () => tabs.get(6)!],
    ["tab", () => tabs.get(3)!, () => tabs.get(6)!],
  ])("clears %s drag state before propagating a synchronous drop callback error", (_kind, source, target) => {
    const callbackError = new Error("drop callback failed");
    const reportedErrors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      reportedErrors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    const { controller } = create(vi.fn(() => { throw callbackError; }));

    try {
      drag(source(), "dragstart");
      drag(target(), "dragover", 11);
      drag(target(), "drop", 11);
      expect(reportedErrors).toEqual([callbackError]);
      expect(list.querySelector(dirtySelector)).toBeNull();
    } finally {
      window.removeEventListener("error", onError);
      controller.destroy();
    }
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

  it("resolves a tab target when the pointer is in the vertical gap after its row", () => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".tab-row, .tab-group-row"));
    rows.forEach((row, index) => {
      const top = index * 34;
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top,
        height: 30,
        bottom: top + 30,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    });
    const { onDrop, controller } = create();
    const gapY = 133;

    drag(tabs.get(6)!, "dragstart");
    expect(drag(list, "dragover", gapY).defaultPrevented).toBe(true);
    expect(tabs.get(3)!.dataset.dropPlacement).toBe("after");
    drag(list, "drop", gapY);

    expect(onDrop).toHaveBeenCalledWith({
      kind: "tab",
      sourceId: 6,
      target: { kind: "tab", tabId: 3, placement: "after" },
    });
    expect(list.querySelector(dirtySelector)).toBeNull();
    controller.destroy();
  });

  it("keeps five-hundred-row gap targeting logarithmic after one drag-start scan", () => {
    const boundReads = vi.fn();
    const largeRows = Array.from({ length: 500 }, (_, index) => {
      const row = document.createElement("div");
      row.className = "tab-row";
      row.dataset.tabId = String(index + 1);
      row.draggable = true;
      const top = index * 34;
      vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => {
        boundReads();
        return {
          top, height: 30, bottom: top + 30, left: 0, right: 200, width: 200,
          x: 0, y: top, toJSON: () => ({}),
        };
      });
      return row;
    });
    list.replaceChildren(...largeRows);
    const queryRows = vi.spyOn(list, "querySelectorAll");
    const { controller } = create();

    drag(largeRows[0]!, "dragstart");
    const callsAfterStart = queryRows.mock.calls.length;
    const boundsAfterStart = boundReads.mock.calls.length;
    drag(list, "dragover", 250 * 34 + 32, undefined, 4);

    expect(queryRows.mock.calls.length).toBe(callsAfterStart);
    expect(boundReads.mock.calls.length - boundsAfterStart).toBeLessThan(20);
    controller.destroy();
  });

  it("uses the drag-start row index for a tree parent on a five-hundred-row list", () => {
    const largeRows = Array.from({ length: 500 }, (_, index) => {
      const row = document.createElement("div");
      row.className = "tab-row";
      row.dataset.tabId = String(index + 1);
      row.draggable = true;
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: index * 30, height: 30, bottom: index * 30 + 30,
        left: 0, right: 200, width: 200, x: 0, y: index * 30,
        toJSON: () => ({}),
      });
      return row;
    });
    list.replaceChildren(...largeRows);
    const prepareTabDrag = () => (target: TabDropTarget): TabDropTarget =>
      target.kind === "group"
        ? target
        : { ...target, tree: { depth: 1, parentId: 499 } };
    const { controller } = create(vi.fn(), undefined, prepareTabDrag);

    drag(largeRows[0]!, "dragstart");
    const find = vi.spyOn(Array.prototype, "find");
    drag(largeRows[499]!, "dragover", 14_999, undefined, 16);

    expect(find).not.toHaveBeenCalled();
    expect(largeRows[498]!.isConnected).toBe(true);
    find.mockRestore();
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
