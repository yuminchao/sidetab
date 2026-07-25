import {
  createDefaultShortcutSettings,
  validateShortcutSettings,
  type Shortcut,
  type ShortcutSettings,
} from "./shortcut-model";

export type ShortcutRendererElements = {
  strip: HTMLElement;
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  enabled: HTMLInputElement;
  editor: HTMLElement;
  error: HTMLElement;
  add: HTMLButtonElement;
  reset: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
};

export type ShortcutRendererCallbacks = {
  onOpen(url: string): void | Promise<void>;
  onOpenError?(message: string): void;
  onSave(settings: ShortcutSettings): Promise<ShortcutSettings>;
};

export type ShortcutRenderer = {
  render(settings: ShortcutSettings): void;
  openSettings(settings: ShortcutSettings): void;
  setError(message: string): void;
  destroy(): void;
};

type EditorSession = {
  generation: number;
  draft: ShortcutSettings;
  saving: boolean;
};

const shortcutIconPaths = {
  openai: "/assets/shortcuts/openai.png",
  google: "/assets/shortcuts/google.png",
  github: "/assets/shortcuts/github.png",
} as const;

export function createShortcutRenderer(
  elements: ShortcutRendererElements,
  callbacks: ShortcutRendererCallbacks,
): ShortcutRenderer {
  let current = createDefaultShortcutSettings();
  let generation = 0;
  let session: EditorSession | undefined;
  let active = true;

  const setError = (message: string) => {
    elements.error.textContent = message;
  };

  const invalidateSession = () => {
    generation += 1;
    session = undefined;
  };

  const isCurrentSession = (candidate: EditorSession): boolean =>
    active && session === candidate && candidate.generation === generation;

  const setFormBusy = (busy: boolean) => {
    const controls = elements.form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input, button",
    );
    for (const control of Array.from(controls)) {
      control.disabled = busy || control.dataset.boundaryDisabled === "true";
    }
  };

  const renderStrip = (settings: ShortcutSettings) => {
    const fragment = document.createDocumentFragment();
    if (settings.enabled) {
      for (const shortcut of settings.items.slice(0, 12)) {
        fragment.append(createShortcutButton(shortcut));
      }
    }
    elements.strip.replaceChildren(fragment);
    elements.strip.hidden = !settings.enabled;
  };

  const renderEditor = () => {
    const fragment = document.createDocumentFragment();
    const items = session?.draft.items ?? [];
    items.forEach((shortcut, index) => {
      fragment.append(createEditorRow(shortcut, index, items.length));
    });
    elements.editor.replaceChildren(fragment);
    setFormBusy(session?.saving ?? false);
  };

  const showSettings = (settings: ShortcutSettings) => {
    if (!active) {
      return;
    }
    invalidateSession();
    session = {
      generation,
      draft: copySettings(settings),
      saving: false,
    };
    elements.enabled.checked = session.draft.enabled;
    setError("");
    renderEditor();
    if (!elements.dialog.open) {
      elements.dialog.showModal();
    }
  };

  const syncDraftFromEditor = () => {
    const editorSession = session;
    if (!editorSession || editorSession.saving) {
      return;
    }

    editorSession.draft.enabled = elements.enabled.checked;
    Array.from(elements.editor.children).forEach((child, index) => {
      const item = editorSession.draft.items[index];
      if (!item || !(child instanceof HTMLElement)) {
        return;
      }
      const name = child.querySelector<HTMLInputElement>(".shortcut-name");
      const url = child.querySelector<HTMLInputElement>(".shortcut-url");
      if (name) {
        item.name = name.value;
      }
      if (url) {
        item.url = url.value;
      }
    });
  };

  const reportOpenError = (error: unknown) => {
    if (!active) {
      return;
    }
    const message = error instanceof Error ? error.message : "无法打开快捷网站";
    try {
      callbacks.onOpenError?.(message);
    } catch {
      // Renderer callbacks must not create an unhandled rejection from a click.
    }
  };

  const onStripClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>(".shortcut-button");
    if (!button || !elements.strip.contains(button)) {
      return;
    }
    const shortcut = current.items.find((item) => item.id === button.dataset.shortcutId);
    if (!shortcut) {
      return;
    }

    try {
      void Promise.resolve(callbacks.onOpen(shortcut.url)).catch(reportOpenError);
    } catch (error) {
      reportOpenError(error);
    }
  };

  const onShortcutIconError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !elements.strip.contains(target)) {
      return;
    }
    const button = target.parentElement;
    if (!button?.classList.contains("shortcut-button")) {
      return;
    }
    target.replaceWith(createShortcutLetter(target.dataset.fallback ?? ""));
  };

  const onSettingsClick = () => {
    showSettings(current);
  };

  const onEnabledChange = () => {
    if (session && !session.saving) {
      session.draft.enabled = elements.enabled.checked;
    }
  };

  const onEditorInput = () => {
    if (!session?.saving) {
      syncDraftFromEditor();
      setError("");
    }
  };

  const onEditorClick = (event: MouseEvent) => {
    const target = event.target;
    const editorSession = session;
    if (!(target instanceof Element) || !editorSession || editorSession.saving) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    const row = button?.closest<HTMLElement>(".shortcut-editor-row");
    if (!button || !row || !elements.editor.contains(row)) {
      return;
    }

    syncDraftFromEditor();
    const index = Array.from(elements.editor.children).indexOf(row);
    const action = button.dataset.action;
    const itemId = editorSession.draft.items[index]?.id;
    let moved = false;
    if (action === "move-up" && index > 0) {
      swap(editorSession.draft.items, index, index - 1);
      moved = true;
    } else if (
      action === "move-down" &&
      index >= 0 &&
      index < editorSession.draft.items.length - 1
    ) {
      swap(editorSession.draft.items, index, index + 1);
      moved = true;
    } else if (action === "delete" && index >= 0) {
      editorSession.draft.items.splice(index, 1);
    } else {
      return;
    }
    setError("");
    renderEditor();
    if (moved && itemId && action) {
      focusEditorAction(elements.editor, itemId, action);
    }
  };

  const onAddClick = () => {
    const editorSession = session;
    if (!editorSession || editorSession.saving) {
      return;
    }
    syncDraftFromEditor();
    if (editorSession.draft.items.length >= 12) {
      setError("最多只能添加 12 个快捷网站");
      return;
    }

    editorSession.draft.items.push({
      id: crypto.randomUUID(),
      name: "",
      url: "",
      icon: "letter",
    });
    setError("");
    renderEditor();
  };

  const onResetClick = () => {
    if (!session || session.saving) {
      return;
    }
    session.draft = createDefaultShortcutSettings();
    elements.enabled.checked = session.draft.enabled;
    setError("");
    renderEditor();
  };

  const onFormClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action='cancel']");
    if (!button || !elements.form.contains(button)) {
      return;
    }

    event.preventDefault();
    if (session?.saving) {
      return;
    }
    invalidateSession();
    setError("");
    elements.dialog.close();
  };

  const onDialogCancel = (event: Event) => {
    if (session?.saving) {
      event.preventDefault();
    } else {
      invalidateSession();
    }
  };

  const onDialogClose = () => {
    invalidateSession();
    setFormBusy(false);
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const submittedSession = session;
    if (!submittedSession || submittedSession.saving) {
      return;
    }

    syncDraftFromEditor();
    const validation = validateShortcutSettings(submittedSession.draft);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    submittedSession.saving = true;
    setError("");
    setFormBusy(true);
    try {
      const saved = await callbacks.onSave(validation.value);
      if (!isCurrentSession(submittedSession)) {
        return;
      }
      current = copySettings(saved);
      renderStrip(current);
      submittedSession.saving = false;
      setFormBusy(false);
      invalidateSession();
      elements.dialog.close();
    } catch (error) {
      if (!isCurrentSession(submittedSession)) {
        return;
      }
      submittedSession.saving = false;
      setFormBusy(false);
      setError(error instanceof Error ? error.message : "无法保存快捷网站设置");
    }
  };

  elements.strip.addEventListener("click", onStripClick);
  elements.strip.addEventListener("error", onShortcutIconError, true);
  elements.settingsButton.addEventListener("click", onSettingsClick);
  elements.enabled.addEventListener("change", onEnabledChange);
  elements.editor.addEventListener("input", onEditorInput);
  elements.editor.addEventListener("click", onEditorClick);
  elements.add.addEventListener("click", onAddClick);
  elements.reset.addEventListener("click", onResetClick);
  elements.form.addEventListener("click", onFormClick);
  elements.form.addEventListener("submit", onSubmit);
  elements.dialog.addEventListener("cancel", onDialogCancel);
  elements.dialog.addEventListener("close", onDialogClose);

  return {
    render(settings) {
      current = copySettings(settings);
      renderStrip(current);
    },

    openSettings(settings) {
      current = copySettings(settings);
      showSettings(current);
    },

    setError,

    destroy() {
      active = false;
      invalidateSession();
      elements.strip.removeEventListener("click", onStripClick);
      elements.strip.removeEventListener("error", onShortcutIconError, true);
      elements.settingsButton.removeEventListener("click", onSettingsClick);
      elements.enabled.removeEventListener("change", onEnabledChange);
      elements.editor.removeEventListener("input", onEditorInput);
      elements.editor.removeEventListener("click", onEditorClick);
      elements.add.removeEventListener("click", onAddClick);
      elements.reset.removeEventListener("click", onResetClick);
      elements.form.removeEventListener("click", onFormClick);
      elements.form.removeEventListener("submit", onSubmit);
      elements.dialog.removeEventListener("cancel", onDialogCancel);
      elements.dialog.removeEventListener("close", onDialogClose);
    },
  };
}

function createShortcutButton(shortcut: Shortcut): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "shortcut-button";
  button.type = "button";
  button.dataset.shortcutId = shortcut.id;
  button.title = shortcut.name;
  button.setAttribute("aria-label", shortcut.name);
  const fallback = getFirstCharacter(shortcut.name);

  if (shortcut.icon === "letter") {
    button.append(createShortcutLetter(fallback));
  } else {
    const image = document.createElement("img");
    image.src = shortcutIconPaths[shortcut.icon];
    image.width = 20;
    image.height = 20;
    image.alt = "";
    image.dataset.fallback = fallback;
    button.append(image);
  }
  return button;
}

function createShortcutLetter(text: string): HTMLElement {
  const letter = document.createElement("span");
  letter.className = "shortcut-letter";
  letter.textContent = text || "·";
  return letter;
}

function createEditorRow(shortcut: Shortcut, index: number, total: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "shortcut-editor-row";
  row.dataset.shortcutId = shortcut.id;

  const name = document.createElement("input");
  name.className = "shortcut-name";
  name.type = "text";
  name.value = shortcut.name;
  name.placeholder = "名称";
  name.setAttribute("aria-label", `${shortcut.name || "新网站"} 名称`);
  name.autocomplete = "off";

  const url = document.createElement("input");
  url.className = "shortcut-url";
  url.type = "text";
  url.inputMode = "url";
  url.value = shortcut.url;
  url.placeholder = "网址";
  url.setAttribute("aria-label", `${shortcut.name || "新网站"} 网址`);
  url.autocomplete = "off";

  row.append(
    name,
    url,
    createEditorButton("move-up", "↑", "上移", index === 0),
    createEditorButton("move-down", "↓", "下移", index === total - 1),
    createEditorButton("delete", "×", "删除", false),
  );
  return row;
}

function createEditorButton(
  action: string,
  text: string,
  label: string,
  boundaryDisabled: boolean,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "shortcut-editor-action";
  button.type = "button";
  button.dataset.action = action;
  button.dataset.boundaryDisabled = String(boundaryDisabled);
  button.disabled = boundaryDisabled;
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function focusEditorAction(editor: HTMLElement, itemId: string, action: string): void {
  const row = Array.from(editor.children).find(
    (child) => child instanceof HTMLElement && child.dataset.shortcutId === itemId,
  );
  row?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.focus();
}

function getFirstCharacter(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase() ?? "";
}

function copySettings(settings: ShortcutSettings): ShortcutSettings {
  return {
    enabled: settings.enabled,
    items: settings.items.map((shortcut) => ({ ...shortcut })),
  };
}

function swap<T>(items: T[], first: number, second: number): void {
  const value = items[first];
  if (value === undefined) {
    return;
  }
  items[first] = items[second] as T;
  items[second] = value;
}
