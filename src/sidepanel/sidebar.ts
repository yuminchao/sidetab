import { createDefaultShortcutSettings } from "./shortcut-model";
import { createShortcutActions } from "./shortcut-actions";
import { createShortcutRenderer } from "./shortcut-renderer";
import { createShortcutStore, type StorageArea } from "./shortcut-store";
import { createTabActions } from "./tab-actions";
import { subscribeToTabEvents } from "./tab-events";
import { createTabRenderer } from "./tab-renderer";
import { TabStore } from "./tab-store";

export type SidebarDependencies = {
  tabs: typeof chrome.tabs;
  windows: Pick<typeof chrome.windows, "getCurrent">;
  storage: StorageArea;
  document: Document;
};

type SidebarElements = {
  shortcutStrip: HTMLElement;
  search: HTMLInputElement;
  settingsButton: HTMLButtonElement;
  status: HTMLElement;
  tabRegion: HTMLElement;
  empty: HTMLElement;
  list: HTMLElement;
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  dialogTitle: HTMLElement;
  shortcutEnabled: HTMLInputElement;
  shortcutEditor: HTMLElement;
  shortcutError: HTMLElement;
  shortcutAdd: HTMLButtonElement;
  shortcutReset: HTMLButtonElement;
  shortcutCancel: HTMLButtonElement;
  shortcutSave: HTMLButtonElement;
};

export function startSidebar(deps: SidebarDependencies): Promise<() => void> {
  return startSidebarInternal(deps);
}

async function startSidebarInternal(
  deps: SidebarDependencies,
  signal?: AbortSignal,
): Promise<() => void> {
  const elements = getSidebarElements(deps.document);
  const tabStore = new TabStore();
  const tabActions = createTabActions(deps.tabs);
  const shortcutStore = createShortcutStore(deps.storage);
  const shortcutActions = createShortcutActions(deps.tabs);
  const tabRenderer = createTabRenderer({ list: elements.list, empty: elements.empty });
  let active = true;
  let currentQuery = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeTabs: () => void = () => undefined;

  const setStatus = (message: string): void => {
    if (active) {
      elements.status.textContent = message;
    }
  };

  const shortcutRenderer = createShortcutRenderer(
    {
      strip: elements.shortcutStrip,
      dialog: elements.dialog,
      form: elements.form,
      enabled: elements.shortcutEnabled,
      editor: elements.shortcutEditor,
      error: elements.shortcutError,
      add: elements.shortcutAdd,
      reset: elements.shortcutReset,
      settingsButton: elements.settingsButton,
    },
    {
      onOpen: (url) => shortcutActions.open(url),
      onOpenError: setStatus,
      onSave: (settings) => shortcutStore.save(settings),
    },
  );

  const cleanup = (): void => {
    if (!active) {
      return;
    }
    active = false;
    unsubscribeTabs();
    elements.list.removeEventListener("click", onListClick);
    elements.search.removeEventListener("input", onSearchInput);
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
      searchTimer = undefined;
    }
    tabRenderer.destroy();
    shortcutRenderer.destroy();
    signal?.removeEventListener("abort", cleanup);
  };

  const renderFilteredTabs = (): void => {
    if (active) {
      tabRenderer.render(tabStore.filter(currentQuery));
    }
  };

  const onListClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const actionElement = target.closest<HTMLElement>("[data-action]");
    const row = actionElement?.closest<HTMLElement>("[data-tab-id]");
    if (!actionElement || !row || !elements.list.contains(row)) {
      return;
    }
    const tabId = Number(row.dataset.tabId);
    if (!Number.isFinite(tabId) || !Number.isInteger(tabId)) {
      return;
    }

    const action = actionElement.dataset.action;
    const operation = action === "activate"
      ? tabActions.activate(tabId)
      : action === "close"
        ? tabActions.close(tabId)
        : undefined;
    if (operation) {
      void operation.catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "标签页操作失败");
      });
    }
  };

  const onSearchInput = (): void => {
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      if (!active) {
        return;
      }
      currentQuery = elements.search.value;
      renderFilteredTabs();
    }, 100);
  };

  elements.list.addEventListener("click", onListClick);
  elements.search.addEventListener("input", onSearchInput);
  shortcutRenderer.render(createDefaultShortcutSettings());
  signal?.addEventListener("abort", cleanup, { once: true });
  if (signal?.aborted) {
    cleanup();
  }

  const loadShortcuts = shortcutStore.load().then(
    (settings) => {
      if (active) {
        shortcutRenderer.render(settings);
      }
    },
    () => {
      if (active) {
        shortcutRenderer.render(createDefaultShortcutSettings());
        setStatus("无法读取快捷网站设置");
      }
    },
  );

  const loadTabs = loadCurrentWindowTabs(deps, () => active).then(
    ({ windowId, tabs }) => {
      if (!active) {
        return;
      }
      tabStore.initialize(tabs);
      renderFilteredTabs();
      unsubscribeTabs = subscribeToTabEvents(deps.tabs, windowId, {
        created(tab) {
          if (!active) return;
          tabStore.add(tab);
          renderFilteredTabs();
        },
        attached(tab) {
          if (!active) return;
          tabStore.add(tab);
          renderFilteredTabs();
        },
        updated(tab) {
          if (!active) return;
          const previous = tab.id === undefined
            ? undefined
            : tabStore.list().find((item) => item.id === tab.id);
          const model = tabStore.replace(tab);
          if (!model) return;
          const rowExists = findTabRow(elements.list, model.id) !== undefined;
          if (currentQuery || !previous || !rowExists || previous.index !== model.index) {
            renderFilteredTabs();
          } else {
            tabRenderer.patch(model);
          }
        },
        activated(tabId) {
          if (!active) return;
          const previousActiveIds = tabStore.list()
            .filter((tab) => tab.active)
            .map((tab) => tab.id);
          tabStore.activate(tabId);
          if (currentQuery) {
            renderFilteredTabs();
            return;
          }
          const affected = new Set([...previousActiveIds, tabId]);
          for (const tab of tabStore.list()) {
            if (affected.has(tab.id)) {
              tabRenderer.patch(tab);
            }
          }
        },
        removed(tabId) {
          if (!active) return;
          tabStore.remove(tabId);
          if (currentQuery) {
            renderFilteredTabs();
          } else {
            tabRenderer.remove(tabId);
          }
        },
        detached(tabId) {
          if (!active) return;
          tabStore.remove(tabId);
          if (currentQuery) {
            renderFilteredTabs();
          } else {
            tabRenderer.remove(tabId);
          }
        },
        moved(tabId, index) {
          if (!active) return;
          tabStore.move(tabId, index);
          renderFilteredTabs();
        },
      });
    },
    () => {
      setStatus("无法读取当前窗口的标签页");
    },
  );

  await Promise.all([loadShortcuts, loadTabs]);
  if (active) {
    deps.document.documentElement.dataset.ready = "true";
  }

  return cleanup;
}

async function loadCurrentWindowTabs(
  deps: SidebarDependencies,
  isActive: () => boolean,
): Promise<{ windowId: number; tabs: chrome.tabs.Tab[] }> {
  const currentWindow = await deps.windows.getCurrent();
  if (!isActive()) {
    throw new Error("侧边栏已关闭");
  }
  const windowId = currentWindow.id;
  if (typeof windowId !== "number" || !Number.isFinite(windowId) || !Number.isInteger(windowId)) {
    throw new Error("当前窗口缺少有效 ID");
  }
  const tabs = await deps.tabs.query({ windowId });
  if (!isActive()) {
    throw new Error("侧边栏已关闭");
  }
  return { windowId, tabs };
}

function getSidebarElements(document: Document): SidebarElements {
  return {
    shortcutStrip: requireElement(document, "shortcut-strip", HTMLElement),
    search: requireElement(document, "tab-search", HTMLInputElement),
    settingsButton: requireElement(document, "shortcut-settings", HTMLButtonElement),
    status: requireElement(document, "status-message", HTMLElement),
    tabRegion: requireElement(document, "tab-region", HTMLElement),
    empty: requireElement(document, "tab-empty", HTMLElement),
    list: requireElement(document, "tab-list", HTMLElement),
    dialog: requireElement(document, "shortcut-dialog", HTMLDialogElement),
    form: requireElement(document, "shortcut-form", HTMLFormElement),
    dialogTitle: requireElement(document, "shortcut-dialog-title", HTMLElement),
    shortcutEnabled: requireElement(document, "shortcut-enabled", HTMLInputElement),
    shortcutEditor: requireElement(document, "shortcut-editor-list", HTMLElement),
    shortcutError: requireElement(document, "shortcut-error", HTMLElement),
    shortcutAdd: requireElement(document, "shortcut-add", HTMLButtonElement),
    shortcutReset: requireElement(document, "shortcut-reset", HTMLButtonElement),
    shortcutCancel: requireElement(document, "shortcut-cancel", HTMLButtonElement),
    shortcutSave: requireElement(document, "shortcut-save", HTMLButtonElement),
  };
}

function requireElement<T extends HTMLElement>(
  document: Document,
  id: string,
  constructor: { new(): T },
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`缺少必需的界面元素 #${id}`);
  }
  return element;
}

function findTabRow(list: HTMLElement, tabId: number): HTMLElement | undefined {
  return Array.from(list.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.tabId === String(tabId),
  );
}

function bootstrapSidebar(
  deps: SidebarDependencies,
  lifecycleTarget: Pick<Window, "addEventListener" | "removeEventListener">,
): Promise<void> {
  const controller = new AbortController();
  let closed = false;
  let cleanup: (() => void) | undefined;
  const onPageHide = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (cleanup) {
      cleanup();
      cleanup = undefined;
    } else {
      controller.abort();
    }
  };

  lifecycleTarget.addEventListener("pagehide", onPageHide, { once: true });
  return startSidebarInternal(deps, controller.signal).then(
    (resolvedCleanup) => {
      if (closed) {
        resolvedCleanup();
      } else {
        cleanup = resolvedCleanup;
      }
    },
    (error: unknown) => {
      lifecycleTarget.removeEventListener("pagehide", onPageHide);
      reportStartupError(deps.document, error);
    },
  );
}

function reportStartupError(document: Document, error: unknown): void {
  const message = error instanceof Error ? error.message : "侧边栏启动失败";
  try {
    const status = document.getElementById("status-message");
    if (status) {
      status.textContent = message;
    }
  } catch {
    // Startup failures must never become an unhandled rejection.
  }
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  void bootstrapSidebar({
    tabs: chrome.tabs,
    windows: chrome.windows,
    storage: chrome.storage.local,
    document,
  }, window);
}
