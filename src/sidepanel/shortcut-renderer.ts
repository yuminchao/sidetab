import {
  MAX_TAB_TITLE_FONT_SIZE,
  MIN_TAB_TITLE_FONT_SIZE,
  createDefaultShortcutSettings,
  validateShortcutSettings,
  type Shortcut,
  type ShortcutSettings,
} from "./shortcut-model";
import { createFaviconCandidates, getAllowedImageUrl, getHttpOrigin } from "./favicon-model";

export type ShortcutRendererElements = {
  strip: HTMLElement;
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  enabled: HTMLInputElement;
  fontSize: HTMLInputElement;
  newTabBehavior: NodeListOf<HTMLInputElement>;
  editor: HTMLElement;
  error: HTMLElement;
  add: HTMLButtonElement;
  reset: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
};

export type ShortcutRendererCallbacks = {
  onOpen(url: string): void | Promise<void>;
  onOpenError?(message: string): void;
  onFontSizePreview?(size: number): void;
  onFaviconLoaded?(origin: string, url: string): void;
  onCachedFaviconFailed?(origin: string, url: string): void;
  onSave(settings: ShortcutSettings): Promise<ShortcutSettings>;
};

export type ShortcutRenderer = {
  render(settings: ShortcutSettings): void;
  setFaviconsByOrigin(favicons: ReadonlyMap<string, string>): void;
  setCachedFaviconsByOrigin(favicons: ReadonlyMap<string, string>): void;
  openSettings(settings: ShortcutSettings): void;
  setError(message: string): void;
  destroy(): void;
};

type EditorSession = {
  generation: number;
  draft: ShortcutSettings;
  saving: boolean;
};

export function createShortcutRenderer(
  elements: ShortcutRendererElements,
  callbacks: ShortcutRendererCallbacks,
): ShortcutRenderer {
  let current = createDefaultShortcutSettings();
  let generation = 0;
  let session: EditorSession | undefined;
  let active = true;
  let faviconsByOrigin = new Map<string, string>();
  let cachedFaviconsByOrigin = new Map<string, string>();
  const shortcutButtons = new Map<string, HTMLButtonElement>();

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
    const visible = settings.enabled ? settings.items.slice(0, 12) : [];
    const nextButtons = new Map<string, HTMLButtonElement>();
    for (const [index, shortcut] of visible.entries()) {
      const button = shortcutButtons.get(shortcut.id) ?? createShortcutButton(shortcut.id);
      updateShortcutButton(button, shortcut, faviconsByOrigin, cachedFaviconsByOrigin);
      nextButtons.set(shortcut.id, button);
      const current = elements.strip.children[index] ?? null;
      if (current !== button) elements.strip.insertBefore(button, current);
    }
    for (const [id, button] of shortcutButtons) {
      if (!nextButtons.has(id)) button.remove();
    }
    shortcutButtons.clear();
    for (const [id, button] of nextButtons) shortcutButtons.set(id, button);
    elements.strip.hidden = !settings.enabled;
  };

  const previewFontSize = (size: number) => {
    callbacks.onFontSizePreview?.(size);
  };

  const isValidFontSize = (size: number): boolean =>
    Number.isFinite(size) &&
    Number.isInteger(size) &&
    size >= MIN_TAB_TITLE_FONT_SIZE &&
    size <= MAX_TAB_TITLE_FONT_SIZE;

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
    elements.fontSize.value = String(session.draft.tabTitleFontSize);
    setNewTabBehavior(elements.newTabBehavior, session.draft.newTabBehavior);
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
    editorSession.draft.newTabBehavior = readNewTabBehavior(elements.newTabBehavior);
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
    const candidates = readFaviconCandidates(target);
    const index = Number.parseInt(target.dataset.candidateIndex ?? "0", 10);
    const currentCandidate = candidates[index];
    const origin = target.dataset.origin ?? "";
    if (currentCandidate?.source === "cache" && origin) {
      callbacks.onCachedFaviconFailed?.(origin, currentCandidate.url);
    }
    const nextIndex = index + 1;
    const nextCandidate = candidates[nextIndex];
    if (nextCandidate) {
      target.dataset.candidateIndex = String(nextIndex);
      target.dataset.nextUrl = candidates[nextIndex + 1]?.url ?? "";
      target.src = nextCandidate.url;
      return;
    }
    target.replaceWith(createShortcutFallback());
  };

  const onShortcutIconLoad = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !elements.strip.contains(target)) return;
    const candidates = readFaviconCandidates(target);
    const index = Number.parseInt(target.dataset.candidateIndex ?? "0", 10);
    const candidate = candidates[index];
    const origin = target.dataset.origin ?? "";
    if (candidate && origin) callbacks.onFaviconLoaded?.(origin, candidate.url);
  };

  const onSettingsClick = () => {
    showSettings(current);
  };

  const onEnabledChange = () => {
    if (session && !session.saving) {
      session.draft.enabled = elements.enabled.checked;
    }
  };

  const onFontSizeInput = () => {
    const editorSession = session;
    if (!editorSession || editorSession.saving) {
      return;
    }
    const size = elements.fontSize.valueAsNumber;
    editorSession.draft.tabTitleFontSize = size;
    setError("");
    if (isValidFontSize(size)) {
      previewFontSize(size);
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
    elements.fontSize.value = String(session.draft.tabTitleFontSize);
    setNewTabBehavior(elements.newTabBehavior, session.draft.newTabBehavior);
    previewFontSize(session.draft.tabTitleFontSize);
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
    previewFontSize(current.tabTitleFontSize);
    invalidateSession();
    setError("");
    elements.dialog.close();
  };

  const onDialogCancel = (event: Event) => {
    if (session?.saving) {
      event.preventDefault();
    } else {
      previewFontSize(current.tabTitleFontSize);
      invalidateSession();
    }
  };

  const onDialogClose = () => {
    previewFontSize(current.tabTitleFontSize);
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
      previewFontSize(current.tabTitleFontSize);
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
  elements.strip.addEventListener("load", onShortcutIconLoad, true);
  elements.settingsButton.addEventListener("click", onSettingsClick);
  elements.enabled.addEventListener("change", onEnabledChange);
  elements.fontSize.addEventListener("input", onFontSizeInput);
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
      previewFontSize(current.tabTitleFontSize);
    },

    setFaviconsByOrigin(favicons) {
      if (!active) {
        return;
      }
      const previousSignature = createShortcutFaviconSignature(
        current,
        faviconsByOrigin,
        cachedFaviconsByOrigin,
      );
      faviconsByOrigin = new Map(favicons);
      const nextSignature = createShortcutFaviconSignature(
        current,
        faviconsByOrigin,
        cachedFaviconsByOrigin,
      );
      if (current.enabled && !stringArraysEqual(previousSignature, nextSignature)) {
        renderStrip(current);
      }
    },

    setCachedFaviconsByOrigin(favicons) {
      if (!active) return;
      const previousSignature = createShortcutFaviconSignature(
        current,
        faviconsByOrigin,
        cachedFaviconsByOrigin,
      );
      cachedFaviconsByOrigin = new Map(favicons);
      const nextSignature = createShortcutFaviconSignature(
        current,
        faviconsByOrigin,
        cachedFaviconsByOrigin,
      );
      if (current.enabled && !stringArraysEqual(previousSignature, nextSignature)) {
        renderStrip(current);
      }
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
      elements.strip.removeEventListener("load", onShortcutIconLoad, true);
      shortcutButtons.clear();
      elements.settingsButton.removeEventListener("click", onSettingsClick);
      elements.enabled.removeEventListener("change", onEnabledChange);
      elements.fontSize.removeEventListener("input", onFontSizeInput);
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

function createShortcutButton(
  shortcutId: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "shortcut-button";
  button.type = "button";
  button.dataset.shortcutId = shortcutId;
  return button;
}

function updateShortcutButton(
  button: HTMLButtonElement,
  shortcut: Shortcut,
  faviconsByOrigin: ReadonlyMap<string, string>,
  cachedFaviconsByOrigin: ReadonlyMap<string, string>,
): void {
  button.dataset.shortcutId = shortcut.id;
  button.title = shortcut.name;
  button.setAttribute("aria-label", shortcut.name);
  const origin = getHttpOrigin(shortcut.url);
  const candidates = createShortcutFaviconCandidates(
    faviconsByOrigin.get(origin),
    cachedFaviconsByOrigin.get(origin),
    shortcut.url,
  );
  const candidatesKey = JSON.stringify(candidates);

  if (button.dataset.candidatesKey !== candidatesKey) {
    button.dataset.candidatesKey = candidatesKey;
    button.replaceChildren(createShortcutFavicon(candidates, origin));
  }
}

type ShortcutFaviconCandidate = {
  url: string;
  source: "live" | "cache" | "root";
};

function createShortcutFaviconCandidates(
  liveUrl: string | undefined,
  cachedUrl: string | undefined,
  pageUrl: string,
): ShortcutFaviconCandidate[] {
  const rootUrl = createFaviconCandidates(undefined, pageUrl)[0] ?? "";
  const candidates: ShortcutFaviconCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    { url: getAllowedImageUrl(liveUrl), source: "live" as const },
    { url: getAllowedImageUrl(cachedUrl), source: "cache" as const },
    { url: rootUrl, source: "root" as const },
  ]) {
    if (candidate.url && !seen.has(candidate.url)) {
      seen.add(candidate.url);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function createShortcutFavicon(
  candidates: readonly ShortcutFaviconCandidate[],
  origin: string,
): HTMLElement {
  const first = candidates[0];
  if (!first) return createShortcutFallback();
  const image = document.createElement("img");
  image.src = first.url;
  image.width = 20;
  image.height = 20;
  image.alt = "";
  image.dataset.candidates = JSON.stringify(candidates);
  image.dataset.candidateIndex = "0";
  image.dataset.nextUrl = candidates[1]?.url ?? "";
  image.dataset.origin = origin;
  return image;
}

function readFaviconCandidates(image: HTMLImageElement): ShortcutFaviconCandidate[] {
  try {
    const parsed = JSON.parse(image.dataset.candidates ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ShortcutFaviconCandidate =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as ShortcutFaviconCandidate).url === "string" &&
        ["live", "cache", "root"].includes((item as ShortcutFaviconCandidate).source),
    );
  } catch {
    return [];
  }
}

function createShortcutFallback(): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "site-favicon-fallback shortcut-favicon-fallback";
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
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
  if (!row) {
    return;
  }

  const preferred = row.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  if (preferred && !preferred.disabled) {
    preferred.focus();
    return;
  }

  const alternateAction = action === "move-up" ? "move-down" : "move-up";
  const alternate = row.querySelector<HTMLButtonElement>(
    `button[data-action="${alternateAction}"]`,
  );
  if (alternate && !alternate.disabled) {
    alternate.focus();
    return;
  }

  row.querySelector<HTMLInputElement>(".shortcut-name")?.focus();
}

function copySettings(settings: ShortcutSettings): ShortcutSettings {
  return {
    enabled: settings.enabled,
    tabTitleFontSize: settings.tabTitleFontSize,
    newTabBehavior: settings.newTabBehavior,
    items: settings.items.map((shortcut) => ({ ...shortcut })),
  };
}

function readNewTabBehavior(inputs: NodeListOf<HTMLInputElement>): "root" | "child" {
  return Array.from(inputs).find((input) => input.checked)?.value === "child" ? "child" : "root";
}

function setNewTabBehavior(
  inputs: NodeListOf<HTMLInputElement>,
  behavior: "root" | "child",
): void {
  for (const input of Array.from(inputs)) input.checked = input.value === behavior;
}

function createShortcutFaviconSignature(
  settings: ShortcutSettings,
  faviconsByOrigin: ReadonlyMap<string, string>,
  cachedFaviconsByOrigin: ReadonlyMap<string, string>,
): string[] {
  return settings.items.slice(0, 12).map((shortcut) => {
    const origin = getHttpOrigin(shortcut.url);
    return JSON.stringify(createShortcutFaviconCandidates(
      faviconsByOrigin.get(origin),
      cachedFaviconsByOrigin.get(origin),
      shortcut.url,
    ));
  });
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function swap<T>(items: T[], first: number, second: number): void {
  const value = items[first];
  if (value === undefined) {
    return;
  }
  items[first] = items[second] as T;
  items[second] = value;
}
