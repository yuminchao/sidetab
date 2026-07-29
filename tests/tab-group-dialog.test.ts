import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartialTabGroupCreationError } from "../src/sidepanel/tab-group-actions";
import {
  createTabGroupDialog,
  type TabGroupDialogElements,
  type TabGroupDraft,
} from "../src/sidepanel/tab-group-dialog";

const COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;

function createFixture(): TabGroupDialogElements {
  document.body.replaceChildren();
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  const name = document.createElement("input");
  const colors = COLORS.map((color) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "tab-group-color";
    input.value = color;
    form.append(input);
    return input;
  });
  const error = document.createElement("p");
  const cancel = document.createElement("button");
  cancel.type = "button";
  const create = document.createElement("button");
  create.type = "submit";
  form.prepend(name);
  form.append(error, cancel, create);
  dialog.append(form);
  document.body.append(dialog);

  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });

  return { dialog, form, name, colors, error, cancel, create };
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("tab group dialog", () => {
  let elements: TabGroupDialogElements;
  let onCreate: ReturnType<typeof vi.fn<(draft: TabGroupDraft) => Promise<number>>>;
  let onUpdateCreated: ReturnType<typeof vi.fn<(draft: TabGroupDraft) => Promise<void>>>;

  beforeEach(() => {
    elements = createFixture();
    onCreate = vi.fn(async () => 7);
    onUpdateCreated = vi.fn(async () => undefined);
  });

  it("opens with an empty name and grey selected", () => {
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });

    controller.open(3, 10);

    expect(elements.dialog.showModal).toHaveBeenCalledOnce();
    expect(elements.name.value).toBe("");
    expect(elements.colors.find((input) => input.checked)?.value).toBe("grey");
    expect(elements.error.textContent).toBe("");
  });

  it("allows an empty name and submits the selected color", async () => {
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    elements.colors.find((input) => input.value === "blue")!.checked = true;

    submit(elements.form);

    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith({
      tabId: 3,
      windowId: 10,
      title: "",
      color: "blue",
    });
  });

  it("isolates a discarded draft when reopened for another tab", () => {
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    elements.name.value = "Unsaved";
    elements.colors.find((input) => input.value === "red")!.checked = true;

    click(elements.cancel);
    controller.open(4, 20);

    expect(elements.name.value).toBe("");
    expect(elements.colors.find((input) => input.checked)?.value).toBe("grey");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("deduplicates repeated submissions while creation is pending", async () => {
    const pending = deferred<number>();
    onCreate.mockReturnValueOnce(pending.promise);
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);

    submit(elements.form);
    submit(elements.form);

    expect(onCreate).toHaveBeenCalledOnce();
    expect(elements.name.disabled).toBe(true);
    expect(elements.create.disabled).toBe(true);
    pending.resolve(7);
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());
  });

  it("closes without submitting from cancel or Escape", () => {
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    click(elements.cancel);

    expect(elements.dialog.close).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();

    controller.open(4, 20);
    const cancelEvent = new Event("cancel", { cancelable: true });
    elements.dialog.dispatchEvent(cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(elements.dialog.close).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("closes after a successful creation", async () => {
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    elements.name.value = "Work";

    submit(elements.form);

    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());
    expect(elements.dialog.open).toBe(false);
    expect(elements.error.textContent).toBe("");
  });

  it("keeps the draft open and reports a failed creation", async () => {
    onCreate.mockRejectedValueOnce(new Error("无法创建标签组"));
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    elements.name.value = "Draft";
    elements.colors.find((input) => input.value === "green")!.checked = true;

    submit(elements.form);

    await vi.waitFor(() => expect(elements.error.textContent).toBe("无法创建标签组"));
    expect(elements.dialog.open).toBe(true);
    expect(elements.name.value).toBe("Draft");
    expect(elements.colors.find((input) => input.checked)?.value).toBe("green");
    expect(elements.name.disabled).toBe(false);
    expect(elements.create.disabled).toBe(false);
    expect(elements.dialog.close).not.toHaveBeenCalled();
  });

  it("retries metadata for a partially created group without creating another group", async () => {
    onCreate.mockRejectedValueOnce(new PartialTabGroupCreationError(17));
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    elements.name.value = "First";

    submit(elements.form);
    await vi.waitFor(() => expect(elements.error.textContent).toContain("分组已创建"));

    elements.name.value = "Retried";
    elements.colors.find((input) => input.value === "purple")!.checked = true;
    submit(elements.form);

    await vi.waitFor(() => expect(onUpdateCreated).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onUpdateCreated).toHaveBeenCalledWith({
      tabId: 3,
      windowId: 10,
      title: "Retried",
      color: "purple",
      createdGroupId: 17,
    });
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());
  });

  it("ignores late asynchronous results and DOM events after destroy", async () => {
    const pending = deferred<number>();
    onCreate.mockReturnValueOnce(pending.promise);
    const controller = createTabGroupDialog(elements, { onCreate, onUpdateCreated });
    controller.open(3, 10);
    submit(elements.form);
    controller.destroy();
    const closeCalls = vi.mocked(elements.dialog.close).mock.calls.length;

    pending.reject(new Error("Late failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(elements.error.textContent).toBe("");
    expect(elements.dialog.close).toHaveBeenCalledTimes(closeCalls);
    submit(elements.form);
    click(elements.cancel);
    controller.open(4, 20);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(elements.dialog.showModal).toHaveBeenCalledOnce();
  });
});
