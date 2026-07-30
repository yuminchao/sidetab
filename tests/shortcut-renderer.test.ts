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
    tabTitleFontSize: 14,
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
  const fontSize = document.createElement("input");
  fontSize.type = "number";
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
  form.append(fontSize, enabled, editor, error, add, reset, cancel, save);
  dialog.append(form);
  document.body.append(strip, settingsButton, dialog);

  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });

  return { strip, dialog, form, fontSize, enabled, editor, error, add, reset, settingsButton, cancel, save };
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
  let onFontSizePreview: ReturnType<typeof vi.fn>;
  let onFaviconLoaded: ReturnType<typeof vi.fn>;
  let onCachedFaviconFailed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    elements = createFixture();
    onOpen = vi.fn();
    onSave = vi.fn(async (value: ShortcutSettings) => value);
    onFontSizePreview = vi.fn();
    onFaviconLoaded = vi.fn();
    onCachedFaviconFailed = vi.fn();
  });

  it("previews valid font sizes and restores the saved size on cancel, Escape, or close", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave, onFontSizePreview });
    renderer.render(settings());
    renderer.openSettings(settings());
    expect(elements.fontSize.value).toBe("14");

    elements.fontSize.value = "18";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onFontSizePreview).toHaveBeenLastCalledWith(18);
    click(elements.cancel);
    expect(onFontSizePreview).toHaveBeenLastCalledWith(14);

    renderer.openSettings(settings());
    elements.fontSize.value = "17";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    elements.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onFontSizePreview).toHaveBeenLastCalledWith(14);

    renderer.openSettings(settings());
    elements.fontSize.value = "16";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    elements.dialog.close();
    expect(onFontSizePreview).toHaveBeenLastCalledWith(14);
  });

  it("keeps a saved font size after close and resets an open draft to 14", async () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave, onFontSizePreview });
    renderer.openSettings(settings());
    elements.fontSize.value = "16";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    submit(elements.form);
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tabTitleFontSize: 16 }));
    expect(onFontSizePreview).toHaveBeenLastCalledWith(16);

    renderer.openSettings(settings({ tabTitleFontSize: 18 }));
    click(elements.reset);
    expect(elements.fontSize.value).toBe("14");
    expect(onFontSizePreview).toHaveBeenLastCalledWith(14);
  });

  it("does not preview or save an invalid font size", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave, onFontSizePreview });
    renderer.openSettings(settings());
    onFontSizePreview.mockClear();
    elements.fontSize.value = "14.5";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onFontSizePreview).not.toHaveBeenCalled();
    submit(elements.form);
    expect(onSave).not.toHaveBeenCalled();
    expect(elements.dialog.open).toBe(true);
    expect(elements.error.textContent).not.toBe("");
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
      "https://chatgpt.com/favicon.ico",
    );
  });

  it.each(["openai", "google", "github", "letter"] as const)(
    "renders the same network favicon candidates for the legacy %s icon value",
    (icon) => {
      const renderer = createShortcutRenderer(elements, { onOpen, onSave });
      renderer.setFaviconsByOrigin(
        new Map([["https://example.com", "https://cdn.example/icon.png"]]),
      );

      renderer.render(settings({ items: [shortcut({ icon })] }));

      const image = elements.strip.querySelector("img");
      expect(image?.getAttribute("src")).toBe("https://cdn.example/icon.png");
      expect(image?.dataset.nextUrl).toBe("https://example.com/favicon.ico");
      expect(image?.dataset.fallback).toBe("E");
      expect(image?.width).toBe(20);
      expect(image?.height).toBe(20);
      expect(image?.alt).toBe("");
    },
  );

  it("supports HTTP shortcut origins and filters a dangerous mapped URL", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.setFaviconsByOrigin(
      new Map([["http://example.com", "javascript:alert(1)"]]),
    );

    renderer.render(settings({ items: [shortcut({ url: "http://example.com/path" })] }));

    const image = elements.strip.querySelector("img");
    expect(image?.getAttribute("src")).toBe("http://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");
  });

  it("does not redraw equal favicon maps, redraws changed maps, and copies map state", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    const favicons = new Map([["https://example.com", "https://cdn.example/first.png"]]);
    renderer.setFaviconsByOrigin(favicons);
    renderer.render(settings());
    const firstButton = elements.strip.firstElementChild;

    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/first.png"]]),
    );
    expect(elements.strip.firstElementChild).toBe(firstButton);

    favicons.set("https://example.com", "https://cdn.example/mutated.png");
    renderer.render(settings());
    expect(elements.strip.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/first.png",
    );

    const buttonBeforeChange = elements.strip.firstElementChild;
    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/second.png"]]),
    );
    expect(elements.strip.firstElementChild).toBe(buttonBeforeChange);
    expect(elements.strip.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/second.png",
    );
  });

  it("preserves shortcut nodes and fallback progress when unrelated favicons change", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/docs.png"]]),
    );
    renderer.render(settings());
    const button = elements.strip.querySelector<HTMLButtonElement>(".shortcut-button");
    const image = button?.querySelector<HTMLImageElement>("img");
    image?.dispatchEvent(new Event("error"));
    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");

    renderer.setFaviconsByOrigin(
      new Map([
        ["https://unrelated.example", "https://cdn.example/unrelated-one.png"],
        ["https://example.com", "https://cdn.example/docs.png"],
      ]),
    );
    renderer.setFaviconsByOrigin(
      new Map([
        ["https://example.com", "https://cdn.example/docs.png"],
        ["https://unrelated.example", "https://cdn.example/unrelated-two.png"],
      ]),
    );
    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/docs.png"]]),
    );

    expect(elements.strip.querySelector(".shortcut-button")).toBe(button);
    expect(elements.strip.querySelector("img")).toBe(image);
    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");

    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/docs-new.png"]]),
    );
    const changedButton = elements.strip.querySelector(".shortcut-button");
    expect(changedButton).toBe(button);
    expect(changedButton?.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/docs-new.png",
    );

    renderer.setFaviconsByOrigin(new Map());
    expect(elements.strip.querySelector(".shortcut-button")).toBe(changedButton);
    expect(elements.strip.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/favicon.ico",
    );
  });

  it("does not render favicon images or redraw when favicon maps change while disabled", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings({ enabled: false }));
    const replaceChildren = vi.spyOn(elements.strip, "replaceChildren");

    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/icon.png"]]),
    );
    renderer.setFaviconsByOrigin(
      new Map([["https://latest.example", "https://cdn.example/latest.png"]]),
    );

    expect(replaceChildren).not.toHaveBeenCalled();
    expect(elements.strip.querySelector("img")).toBeNull();

    renderer.render(
      settings({ items: [shortcut({ url: "https://latest.example/path" })] }),
    );
    expect(elements.strip.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/latest.png",
    );
  });

  it("opens a shortcut through one delegated strip click", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings());

    click(elements.strip.querySelector(".shortcut-button"));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("https://example.com/");
  });

  it("reports rejected shortcut opens without an unhandled rejection", async () => {
    const onOpenError = vi.fn();
    onOpen.mockRejectedValueOnce(new Error("Open failed"));
    const renderer = createShortcutRenderer(elements, { onOpen, onSave, onOpenError });
    renderer.render(settings());

    click(elements.strip.querySelector(".shortcut-button"));

    await vi.waitFor(() => expect(onOpenError).toHaveBeenCalledWith("Open failed"));
  });

  it("falls back from a mapped favicon to the root and then the shortcut letter", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/icon.png"]]),
    );
    renderer.render(settings());
    const image = elements.strip.querySelector("img");

    image?.dispatchEvent(new Event("error"));

    expect(elements.strip.querySelector("img")).toBe(image);
    expect(image?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(image?.dataset.nextUrl).toBe("");

    image?.dispatchEvent(new Event("error"));

    const firstButton = elements.strip.querySelector(".shortcut-button");
    expect(firstButton?.querySelector("img")).toBeNull();
    expect(firstButton?.querySelector(".shortcut-letter")?.textContent).toBe("E");

    renderer.render(settings());
    const imageAfterRender = elements.strip.querySelector("img");
    renderer.destroy();
    imageAfterRender?.dispatchEvent(new Event("error"));
    expect(elements.strip.querySelector("img")).toBe(imageAfterRender);
  });

  it("tries live, cached, and root candidates in order and reports loading feedback", () => {
    const renderer = createShortcutRenderer(elements, {
      onOpen,
      onSave,
      onFaviconLoaded,
      onCachedFaviconFailed,
    });
    renderer.setFaviconsByOrigin(
      new Map([["https://example.com", "https://cdn.example/live.png"]]),
    );
    renderer.setCachedFaviconsByOrigin(
      new Map([["https://example.com", "https://cache.example/cached.png"]]),
    );
    renderer.render(settings());
    const image = elements.strip.querySelector<HTMLImageElement>("img")!;

    expect(image.getAttribute("src")).toBe("https://cdn.example/live.png");
    image.dispatchEvent(new Event("error"));
    expect(image.getAttribute("src")).toBe("https://cache.example/cached.png");
    expect(onCachedFaviconFailed).not.toHaveBeenCalled();
    image.dispatchEvent(new Event("error"));
    expect(onCachedFaviconFailed).toHaveBeenCalledWith(
      "https://example.com",
      "https://cache.example/cached.png",
    );
    expect(image.getAttribute("src")).toBe("https://example.com/favicon.ico");
    image.dispatchEvent(new Event("load"));
    expect(onFaviconLoaded).toHaveBeenCalledWith(
      "https://example.com",
      "https://example.com/favicon.ico",
    );
  });

  it("deduplicates equivalent live and cached candidates", () => {
    const renderer = createShortcutRenderer(elements, {
      onOpen,
      onSave,
      onCachedFaviconFailed,
    });
    const shared = "https://cdn.example/shared.png";
    renderer.setFaviconsByOrigin(new Map([["https://example.com", shared]]));
    renderer.setCachedFaviconsByOrigin(new Map([["https://example.com", shared]]));
    renderer.render(settings());
    const image = elements.strip.querySelector<HTMLImageElement>("img")!;

    image.dispatchEvent(new Event("error"));

    expect(image.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(onCachedFaviconFailed).not.toHaveBeenCalled();
  });

  it("reuses shortcut buttons and unchanged images across cached map updates", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.render(settings({
      items: [
        shortcut({ id: "a", url: "https://a.example/" }),
        shortcut({ id: "b", url: "https://b.example/" }),
      ],
    }));
    const firstButton = elements.strip.children[0];
    const secondButton = elements.strip.children[1];
    const firstImage = firstButton?.querySelector("img");
    const secondImage = secondButton?.querySelector("img");

    renderer.setCachedFaviconsByOrigin(
      new Map([["https://a.example", "https://cache.example/a.png"]]),
    );

    expect(elements.strip.children[0]).toBe(firstButton);
    expect(elements.strip.children[1]).toBe(secondButton);
    expect(firstButton?.querySelector("img")).not.toBe(firstImage);
    expect(secondButton?.querySelector("img")).toBe(secondImage);
    const changedFirstImage = firstButton?.querySelector("img");
    renderer.setCachedFaviconsByOrigin(
      new Map([["https://a.example", "https://cache.example/a.png"]]),
    );
    expect(firstButton?.querySelector("img")).toBe(changedFirstImage);
  });

  it("stops favicon feedback after destruction", () => {
    const renderer = createShortcutRenderer(elements, {
      onOpen,
      onSave,
      onFaviconLoaded,
      onCachedFaviconFailed,
    });
    renderer.setCachedFaviconsByOrigin(
      new Map([["https://example.com", "https://cache.example/icon.png"]]),
    );
    renderer.render(settings());
    const image = elements.strip.querySelector<HTMLImageElement>("img")!;
    renderer.destroy();

    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    expect(onFaviconLoaded).not.toHaveBeenCalled();
    expect(onCachedFaviconFailed).not.toHaveBeenCalled();
  });

  it("keeps an emoji intact when deriving a letter icon", () => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });

    renderer.render(settings({ items: [shortcut({ name: "😀 Site" })] }));

    elements.strip.querySelector("img")?.dispatchEvent(new Event("error"));

    expect(elements.strip.querySelector(".shortcut-letter")?.textContent).toBe("😀");
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
      tabTitleFontSize: 14,
      items: [shortcut({ name: "Saved name" })],
    });
    expect(elements.strip.querySelector(".shortcut-button")?.getAttribute("title")).toBe(
      "Saved name",
    );
    expect(elements.dialog.open).toBe(false);
  });

  it("keeps a rejected save open with its draft and error", async () => {
    onSave.mockRejectedValueOnce(new Error("Storage unavailable"));
    const renderer = createShortcutRenderer(elements, { onOpen, onSave, onFontSizePreview });
    renderer.openSettings(settings());
    elements.fontSize.value = "18";
    elements.fontSize.dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(elements.cancel.disabled).toBe(false);
    expect(onFontSizePreview).toHaveBeenLastCalledWith(18);

    click(elements.cancel);
    expect(onFontSizePreview).toHaveBeenLastCalledWith(14);
  });

  it("disables form actions and blocks cancel or repeat submit while saving", async () => {
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
    expect(
      Array.from(elements.form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")).every(
        (control) => control.disabled,
      ),
    ).toBe(true);
    click(elements.cancel);
    submit(elements.form);

    expect(elements.dialog.close).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();

    resolveSave?.(settings());
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledOnce());
  });

  it("ignores an old save after close and reopen while allowing the new session to save", async () => {
    let resolveOldSave: ((value: ShortcutSettings) => void) | undefined;
    onSave
      .mockImplementationOnce(
        () =>
          new Promise<ShortcutSettings>((resolve) => {
            resolveOldSave = resolve;
          }),
      )
      .mockImplementationOnce(async (value: ShortcutSettings) => value);
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings({ items: [shortcut({ name: "Old draft" })] }));
    submit(elements.form);

    elements.dialog.close();
    renderer.openSettings(settings({ items: [shortcut({ name: "New draft" })] }));
    resolveOldSave?.(settings({ items: [shortcut({ name: "Old result" })] }));
    await Promise.resolve();

    expect(elements.dialog.close).toHaveBeenCalledOnce();
    expect(elements.dialog.open).toBe(true);
    expect(elements.editor.querySelector<HTMLInputElement>(".shortcut-name")?.value).toBe(
      "New draft",
    );

    submit(elements.form);
    await vi.waitFor(() => expect(elements.dialog.close).toHaveBeenCalledTimes(2));
    expect(elements.strip.querySelector(".shortcut-button")?.getAttribute("title")).toBe(
      "New draft",
    );
    expect(onSave).toHaveBeenCalledTimes(2);
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

  it("disables impossible moves and restores focus to the moved item's same action", () => {
    const items = [
      shortcut({ id: "a", name: "A", url: "https://a.example/" }),
      shortcut({ id: "b", name: "B", url: "https://b.example/" }),
      shortcut({ id: "c", name: "C", url: "https://c.example/" }),
      shortcut({ id: "d", name: "D", url: "https://d.example/" }),
    ];
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings({ items }));

    expect(elements.editor.children[0]?.querySelector<HTMLButtonElement>("[data-action='move-up']")?.disabled).toBe(true);
    expect(elements.editor.children[3]?.querySelector<HTMLButtonElement>("[data-action='move-down']")?.disabled).toBe(true);
    click(elements.editor.children[2]?.querySelector("[data-action='move-up']") ?? null);

    const movedRow = Array.from(elements.editor.children).find(
      (row) => row instanceof HTMLElement && row.dataset.shortcutId === "c",
    );
    expect(document.activeElement).toBe(
      movedRow?.querySelector("[data-action='move-up']"),
    );
  });

  it.each([
    {
      name: "moves the middle item to the first position",
      items: [
        shortcut({ id: "a", name: "A", url: "https://a.example/" }),
        shortcut({ id: "b", name: "B", url: "https://b.example/" }),
        shortcut({ id: "c", name: "C", url: "https://c.example/" }),
      ],
      sourceIndex: 1,
      action: "move-up",
      expectedAction: "move-down",
    },
    {
      name: "moves the middle item to the last position",
      items: [
        shortcut({ id: "a", name: "A", url: "https://a.example/" }),
        shortcut({ id: "b", name: "B", url: "https://b.example/" }),
        shortcut({ id: "c", name: "C", url: "https://c.example/" }),
      ],
      sourceIndex: 1,
      action: "move-down",
      expectedAction: "move-up",
    },
    {
      name: "keeps focus operable when sorting two items",
      items: [
        shortcut({ id: "a", name: "A", url: "https://a.example/" }),
        shortcut({ id: "b", name: "B", url: "https://b.example/" }),
      ],
      sourceIndex: 1,
      action: "move-up",
      expectedAction: "move-down",
    },
  ])("$name", ({ items, sourceIndex, action, expectedAction }) => {
    const renderer = createShortcutRenderer(elements, { onOpen, onSave });
    renderer.openSettings(settings({ items }));
    const movedId = items[sourceIndex]?.id;

    click(elements.editor.children[sourceIndex]?.querySelector(`[data-action='${action}']`) ?? null);

    const movedRow = Array.from(elements.editor.children).find(
      (row) => row instanceof HTMLElement && row.dataset.shortcutId === movedId,
    );
    const focused = document.activeElement;
    expect(movedRow?.contains(focused)).toBe(true);
    expect(focused).toBe(movedRow?.querySelector(`[data-action='${expectedAction}']`));
    expect(focused).toBeInstanceOf(HTMLButtonElement);
    expect((focused as HTMLButtonElement).disabled).toBe(false);
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

    elements.strip.querySelector("img")?.dispatchEvent(new Event("error"));

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
