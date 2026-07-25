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
  onSave(settings: ShortcutSettings): Promise<ShortcutSettings>;
};

export type ShortcutRenderer = {
  render(settings: ShortcutSettings): void;
  openSettings(settings: ShortcutSettings): void;
  setError(message: string): void;
  destroy(): void;
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
  let draft: ShortcutSettings | undefined;
  let saving = false;
  let active = true;

  const setError = (message: string) => {
    elements.error.textContent = message;
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
    for (const shortcut of draft?.items ?? []) {
      fragment.append(createEditorRow(shortcut));
    }
    elements.editor.replaceChildren(fragment);
  };

  const showSettings = (settings: ShortcutSettings) => {
    draft = copySettings(settings);
    elements.enabled.checked = draft.enabled;
    setError("");
    renderEditor();
    elements.dialog.showModal();
  };

  const syncDraftFromEditor = () => {
    if (!draft) {
      return;
    }

    draft.enabled = elements.enabled.checked;
    Array.from(elements.editor.children).forEach((child, index) => {
      const item = draft?.items[index];
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
    if (shortcut) {
      void callbacks.onOpen(shortcut.url);
    }
  };

  const onSettingsClick = () => {
    showSettings(current);
  };

  const onEnabledChange = () => {
    if (draft) {
      draft.enabled = elements.enabled.checked;
    }
  };

  const onEditorInput = () => {
    syncDraftFromEditor();
    setError("");
  };

  const onEditorClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !draft) {
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
    if (action === "move-up" && index > 0) {
      swap(draft.items, index, index - 1);
    } else if (action === "move-down" && index >= 0 && index < draft.items.length - 1) {
      swap(draft.items, index, index + 1);
    } else if (action === "delete" && index >= 0) {
      draft.items.splice(index, 1);
    } else {
      return;
    }
    setError("");
    renderEditor();
  };

  const onAddClick = () => {
    if (!draft) {
      return;
    }
    syncDraftFromEditor();
    if (draft.items.length >= 12) {
      setError("最多只能添加 12 个快捷网站");
      return;
    }

    draft.items.push({
      id: crypto.randomUUID(),
      name: "",
      url: "",
      icon: "letter",
    });
    setError("");
    renderEditor();
  };

  const onResetClick = () => {
    draft = createDefaultShortcutSettings();
    elements.enabled.checked = draft.enabled;
    setError("");
    renderEditor();
  };

  const onFormClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action='cancel']");
    if (button && elements.form.contains(button)) {
      draft = undefined;
      setError("");
      elements.dialog.close();
    }
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!draft || saving) {
      return;
    }

    syncDraftFromEditor();
    const validation = validateShortcutSettings(draft);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    saving = true;
    setError("");
    try {
      const saved = await callbacks.onSave(validation.value);
      if (!active) {
        return;
      }
      current = copySettings(saved);
      draft = undefined;
      renderStrip(current);
      elements.dialog.close();
    } catch (error) {
      if (active) {
        setError(error instanceof Error ? error.message : "无法保存快捷网站设置");
      }
    } finally {
      saving = false;
    }
  };

  elements.strip.addEventListener("click", onStripClick);
  elements.settingsButton.addEventListener("click", onSettingsClick);
  elements.enabled.addEventListener("change", onEnabledChange);
  elements.editor.addEventListener("input", onEditorInput);
  elements.editor.addEventListener("click", onEditorClick);
  elements.add.addEventListener("click", onAddClick);
  elements.reset.addEventListener("click", onResetClick);
  elements.form.addEventListener("click", onFormClick);
  elements.form.addEventListener("submit", onSubmit);

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
      draft = undefined;
      elements.strip.removeEventListener("click", onStripClick);
      elements.settingsButton.removeEventListener("click", onSettingsClick);
      elements.enabled.removeEventListener("change", onEnabledChange);
      elements.editor.removeEventListener("input", onEditorInput);
      elements.editor.removeEventListener("click", onEditorClick);
      elements.add.removeEventListener("click", onAddClick);
      elements.reset.removeEventListener("click", onResetClick);
      elements.form.removeEventListener("click", onFormClick);
      elements.form.removeEventListener("submit", onSubmit);
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

  if (shortcut.icon === "letter") {
    const letter = document.createElement("span");
    letter.className = "shortcut-letter";
    letter.textContent = shortcut.name.trim().charAt(0).toLocaleUpperCase() || "·";
    button.append(letter);
  } else {
    const image = document.createElement("img");
    image.src = shortcutIconPaths[shortcut.icon];
    image.width = 20;
    image.height = 20;
    image.alt = "";
    button.append(image);
  }
  return button;
}

function createEditorRow(shortcut: Shortcut): HTMLElement {
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
    createEditorButton("move-up", "↑", "上移"),
    createEditorButton("move-down", "↓", "下移"),
    createEditorButton("delete", "×", "删除"),
  );
  return row;
}

function createEditorButton(action: string, text: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "shortcut-editor-action";
  button.type = "button";
  button.dataset.action = action;
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
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
