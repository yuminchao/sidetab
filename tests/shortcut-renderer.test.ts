import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShortcutRenderer,
  type ShortcutRendererElements,
} from "../src/sidepanel/shortcut-renderer";
import {
  createDefaultShortcutSettings,
  validateShortcutSettings,
  type Shortcut,
  type ShortcutSettings,
} from "../src/sidepanel/shortcut-model";

function shortcut(overrides: Partial<Shortcut> = {}): Shortcut {
  return {
    id: "example",
    name: "Example",
    url: "https://example.com/",
    icon: "letter",
    ...overrides,
  };
}

function settings(overrides: Partial<ShortcutSettings> = {}): ShortcutSettings {
  return {
    enabled: true,
    items: [shortcut()],
    ...overrides,
  };
}

function createFixture(): ShortcutRendererElements & {
  cancel: HTMLButtonElement;
  save: HTMLButtonElement;
} {
  document.body.replaceChildren();
  const strip = document.createElement("div");
  const settingsButton = document.createElement("button");
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  const editor = document.createElement("div");
  const error = document.createElement("p");
  const add = document.createElement("button");
  add.type = "button";
  const reset = document.createElement("button");
  reset.type = "button";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.dataset.action = "cancel";
  const save = document.createElement("button");
  save.type = "submit";
  form.append(enabled, editor, error, add, reset, cancel, save);
  dialog.append(form);
  document.body.append(strip, settingsButton, dialog);

  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => dialog.removeAttribute("open"));

  return { strip, dialog, form, enabled, editor, error, add, reset, settingsButton, cancel, save };
}

function click(element: Element | null): void {
  expect(element).not.toBeNull();
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
}

describe("shortcut renderer", () => {
  let elements: ReturnType<typeof createFixture>;
  let onOpen: ReturnType<typeof vi.fn>;
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    elements = createFixture();
    onOpen = vi.fn();
    onSave = vi.fn(async (value: ShortcutSettings) => value);
  });

  it("hides and clears a disabled strip, then renders enabled shortcuts", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(createDefaultShortcutSettings());

    expect(elements.strip.hidden).toBe(true);
    expect(elements.strip.childElementCount).toBe(0);

    renderer.render({ ...createDefaultShortcutSettings(), enabled: true });
    const buttons = elements.strip.querySelectorAll<HTMLButtonElement>(".shortcut-button");
    expect(elements.strip.hidden).toBe(false);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.dataset.shortcutId).toBe("openai");
    expect(buttons[0]?.getAttribute("aria-label")).toBe("OpenAI");
    expect(buttons[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/shortcuts/openai.png",
    );
  });

  it("opens a shortcut through one delegated strip click", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings());

    click(elements.strip.querySelector(".shortcut-button"));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("https://example.com/");
  });

  it("opens settings from the gear with an isolated current-settings draft", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings());

    click(elements.settingsButton);
    const name = elements.editor.querySelector<HTMLInputElement>(".shortcut-name");
    expect(elements.dialog.showModal).toHaveBeenCalledOnce();
    expect(elements.dialog.open).toBe(true);
    expect(elements.enabled.checked).toBe(true);
    expect(name?.value).toBe("Example");

    if (name) {
      name.value = "Unsaved";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }
    click(elements.cancel);
    click(elements.settingsButton);
    expect(elements.editor.querySelector<HTMLInputElement>(".shortcut-name")?.value).toBe(
      "Example",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("exposes dialog errors through the alert element", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });

    renderer.setError("Unable to continue");

    expect(elements.error.textContent).toBe("Unable to continue");
  });

  it("shows the model validation error without closing or saving", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings());
    const url = elements.editor.querySelector<HTMLInputElement>(".shortcut-url");
    if (url) {
      url.value = "javascript:alert(1)";
      url.dispatchEvent(new Event("input", { bubbles: true }));
    }

    submit(elements.form);

    const validation = validateShortcutSettings({
      enabled: true,
      items: [shortcut({ url: "javascript:alert(1)" })],
    });
    expect(validation.ok).toBe(false);
    expect(elements.error.textContent).toBe(validation.ok ? "" : validation.message);
    expect(onSave).not.toHaveBeenCalled();
    expect(elements.dialog.close).not.toHaveBeenCalled();
    expect(elements.dialog.open).toBe(true);
  });

  it("awaits a successful save, renders the returned settings, and closes", async () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings());
    const name = elements.editor.querySelector<HTMLInputElement>(".shortcut-name");
    if (name) {
      name.value = "Saved name";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }

    submit(elements.form);
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());

    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      items: [shortcut({ name: "Saved name" })],
    });
    expect(elements.strip.querySelector(".shortcut-button")?.getAttribute("title")).toBe(
      "Saved name",
    );
    expect(elements.dialog.open).toBe(false);
  });

  it("keeps a rejected save open with its draft and error", async () => {
    onSave.mockRejectedValueOnce(new Error("Storage unavailable"));
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings());
    const name = elements.editor.querySelector<HTMLInputElement>(".shortcut-name");
    if (name) {
      name.value = "Draft name";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }

    submit(elements.form);
    await vi.waitFor(() => expect(elements.error.textContent).toBe("Storage unavailable"));

    expect(elements.dialog.open).toBe(true);
    expect(elements.editor.querySelector<HTMLInputElement>(".shortcut-name")?.value).toBe(
      "Draft name",
    );
    expect(elements.dialog.close).not.toHaveBeenCalled();
  });

  it("adds rows up to twelve and reports the thirteenth attempt in place", () => {
    const items = Array.from({ length: 11 }, (_, index) =>
      shortcut({ id: `site-${index}`, name: `Site ${index}`, url: `https://site-${index}.example/` }),
    );
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings({ items }));

    click(elements.add);
    expect(elements.editor.children).toHaveLength(12);
    click(elements.add);

    expect(elements.editor.children).toHaveLength(12);
    expect(elements.error.textContent).toBe("最多只能添加 12 个快捷网站");
  });

  it("moves rows in both directions and deletes through editor delegation", () => {
    const items = [
      shortcut({ id: "a", name: "A", url: "https://a.example/" }),
      shortcut({ id: "b", name: "B", url: "https://b.example/" }),
      shortcut({ id: "c", name: "C", url: "https://c.example/" }),
    ];
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings({ items }));

    click(elements.editor.children[1]?.querySelector("[data-action='move-up']") ?? null);
    expect(Array.from(elements.editor.querySelectorAll<HTMLInputElement>(".shortcut-name"), (input) => input.value)).toEqual([
      "B",
      "A",
      "C",
    ]);

    click(elements.editor.children[1]?.querySelector("[data-action='move-down']") ?? null);
    expect(Array.from(elements.editor.querySelectorAll<HTMLInputElement>(".shortcut-name"), (input) => input.value)).toEqual([
      "B",
      "C",
      "A",
    ]);

    click(elements.editor.children[1]?.querySelector("[data-action='delete']") ?? null);
    expect(Array.from(elements.editor.querySelectorAll<HTMLInputElement>(".shortcut-name"), (input) => input.value)).toEqual([
      "B",
      "A",
    ]);
  });

  it("resets the unsaved draft to the complete disabled defaults", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings());

    click(elements.reset);

    expect(elements.enabled.checked).toBe(false);
    expect(Array.from(elements.editor.querySelectorAll<HTMLInputElement>(".shortcut-name"), (input) => input.value)).toEqual([
      "OpenAI",
      "Google",
      "GitHub",
    ]);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders untrusted names as text in both strip and editor", () => {
    const malicious = settings({
      items: [shortcut({ name: "<img src=x onerror=alert(1)>", id: "<script>x</script>" })],
    });
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });

    renderer.render(malicious);
    renderer.openSettings(malicious);

    expect(document.querySelector("script")).toBeNull();
    expect(elements.strip.querySelector("img")).toBeNull();
    expect(elements.strip.querySelector(".shortcut-letter")?.textContent).toBe("<");
    expect(elements.editor.querySelector<HTMLInputElement>(".shortcut-name")?.value).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("removes all bound listeners when destroyed", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings());
    renderer.destroy();

    click(elements.strip.querySelector(".shortcut-button"));
    click(elements.settingsButton);
    submit(elements.form);

    expect(onOpen).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(elements.dialog.showModal).not.toHaveBeenCalled();
  });

  it("ignores an in-flight save result after destruction", async () => {
    let resolveSave: ((value: ShortcutSettings) => void) | undefined;
    onSave.mockImplementationOnce(
      () =>
        new Promise<ShortcutSettings>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings());
    submit(elements.form);
    expect(onSave).toHaveBeenCalledOnce();

    renderer.destroy();
    resolveSave?.(settings({ items: [shortcut({ name: "Late result" })] }));
    await Promise.resolve();

    expect(elements.dialog.close).not.toHaveBeenCalled();
    expect(elements.strip.childElementCount).toBe(0);
  });
});
