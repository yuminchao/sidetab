import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTabGroupRenameDialog,
  type TabGroupRenameDialogElements,
} from "../src/sidepanel/tab-group-rename-dialog";

function createFixture(): TabGroupRenameDialogElements {
  document.body.replaceChildren();
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  const name = document.createElement("input");
  const error = document.createElement("p");
  const cancel = document.createElement("button");
  cancel.type = "button";
  const save = document.createElement("button");
  save.type = "submit";
  form.append(name, error, cancel, save);
  dialog.append(form);
  document.body.append(dialog);

  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });
  name.select = vi.fn();

  return { dialog, form, name, error, cancel, save };
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

describe("tab group rename dialog", () => {
  let elements: TabGroupRenameDialogElements;
  let onSave: ReturnType<typeof vi.fn<(input: { groupId: number; title: string }) => Promise<void>>>;

  beforeEach(() => {
    elements = createFixture();
    onSave = vi.fn(async () => undefined);
  });

  it("prefills and selects the current group title, including an unnamed group", () => {
    const controller = createTabGroupRenameDialog(elements, { onSave });

    controller.open(7, " Work ");
    expect(elements.name.value).toBe(" Work ");
    expect(elements.name.select).toHaveBeenCalledOnce();
    expect(elements.dialog.showModal).toHaveBeenCalledOnce();

    controller.close();
    controller.open(8, "");
    expect(elements.name.value).toBe("");
    expect(elements.name.select).toHaveBeenCalledTimes(2);
  });

  it("trims the submitted title and allows an empty title", async () => {
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Old");
    elements.name.value = "  New name  ";

    submit(elements.form);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ groupId: 7, title: "New name" }));

    controller.open(8, "Other");
    elements.name.value = "   ";
    submit(elements.form);
    await vi.waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ groupId: 8, title: "" }));
  });

  it("disables every control and deduplicates submission while saving", async () => {
    const pending = deferred<void>();
    onSave.mockReturnValueOnce(pending.promise);
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Work");

    submit(elements.form);
    submit(elements.form);
    click(elements.cancel);

    expect(onSave).toHaveBeenCalledOnce();
    expect(elements.name.disabled).toBe(true);
    expect(elements.cancel.disabled).toBe(true);
    expect(elements.save.disabled).toBe(true);
    expect(elements.dialog.close).not.toHaveBeenCalled();

    pending.resolve();
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());
  });

  it("closes on successful save, cancel, Escape, or closeForGroup", async () => {
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Work");
    submit(elements.form);
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());

    controller.open(8, "Personal");
    click(elements.cancel);
    expect(elements.dialog.close).toHaveBeenCalledTimes(2);

    controller.open(9, "Reading");
    const cancelEvent = new Event("cancel", { cancelable: true });
    elements.dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(elements.dialog.close).toHaveBeenCalledTimes(3);

    controller.open(10, "Keep");
    controller.closeForGroup(11);
    expect(elements.dialog.open).toBe(true);
    controller.closeForGroup(10);
    expect(elements.dialog.open).toBe(false);
  });

  it("keeps the dialog, input, and useful error after a failed save", async () => {
    onSave.mockRejectedValueOnce(new Error("无法重命名标签组"));
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Old");
    elements.name.value = "  Draft  ";

    submit(elements.form);

    await vi.waitFor(() => expect(elements.error.textContent).toBe("无法重命名标签组"));
    expect(elements.dialog.open).toBe(true);
    expect(elements.name.value).toBe("  Draft  ");
    expect(elements.name.disabled).toBe(false);
    expect(elements.cancel.disabled).toBe(false);
    expect(elements.save.disabled).toBe(false);

    onSave.mockRejectedValueOnce("unknown");
    submit(elements.form);
    await vi.waitFor(() => expect(elements.error.textContent).toBe("无法重命名标签组"));
  });

  it("does not let an old promise close or overwrite a newer session", async () => {
    const oldSave = deferred<void>();
    onSave.mockReturnValueOnce(oldSave.promise).mockRejectedValueOnce(new Error("New failure"));
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Old");
    submit(elements.form);

    controller.open(8, "New");
    elements.name.value = "Current input";
    submit(elements.form);
    await vi.waitFor(() => expect(elements.error.textContent).toBe("New failure"));

    oldSave.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(elements.dialog.open).toBe(true);
    expect(elements.name.value).toBe("Current input");
    expect(elements.error.textContent).toBe("New failure");
  });

  it("removes listeners and ignores late work after destroy", async () => {
    const pending = deferred<void>();
    onSave.mockReturnValueOnce(pending.promise);
    const controller = createTabGroupRenameDialog(elements, { onSave });
    controller.open(7, "Work");
    submit(elements.form);
    controller.destroy();
    const closeCalls = vi.mocked(elements.dialog.close).mock.calls.length;

    pending.reject(new Error("Late failure"));
    await Promise.resolve();
    await Promise.resolve();
    submit(elements.form);
    click(elements.cancel);
    controller.open(8, "Ignored");

    expect(onSave).toHaveBeenCalledOnce();
    expect(elements.dialog.close).toHaveBeenCalledTimes(closeCalls);
    expect(elements.dialog.showModal).toHaveBeenCalledOnce();
    expect(elements.error.textContent).toBe("");
  });
});
