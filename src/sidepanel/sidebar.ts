import { createDefaultShortcutSettings } from "./shortcut-model";
import { createShortcutActions } from "./shortcut-actions";
import { createShortcutRenderer } from "./shortcut-renderer";
import { createShortcutStore, type StorageArea } from "./shortcut-store";
import { createOriginFaviconMap } from "./favicon-model";
import { createTabActions } from "./tab-actions";
import { createTabContextMenu } from "./tab-context-menu";
import { createTabDragController } from "./tab-drag-controller";
import { subscribeToTabEvents } from "./tab-events";
import { createTabReorderPlan } from "./tab-reorder-model";
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
  tabTitleFontSize: HTMLInputElement;
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
  let bufferingTabEvents = false;
  const bufferedTabEvents: Array<Promise<() => void>> = [];
  type AttachedSlot = { resolve(mutation: () => void): void };
  const attachedSlotsById = new Map<number, AttachedSlot[]>();
  const pendingAttachedSlots = new Set<AttachedSlot>();
  const bufferedAttachedTabs = new WeakSet<chrome.tabs.Tab>();
  let shortcutSettingsReady = false;
  let operationGeneration = 0;
  let reorderBusy = false;
  const statusSlots = {
    tabs: "",
    shortcuts: "",
    operation: "",
  };

  const setStatus = (source: keyof typeof statusSlots, message: string): void => {
    if (active) {
      statusSlots[source] = message;
      elements.status.textContent = [
        statusSlots.tabs,
        statusSlots.shortcuts,
        statusSlots.operation,
      ].filter(Boolean).join("；");
    }
  };

  const runTabOperation = (operation: Promise<void>, onSettled?: () => void): void => {
    const generation = ++operationGeneration;
    void operation.then(
      () => {
        if (generation === operationGeneration) setStatus("operation", "");
      },
      (error: unknown) => {
        if (generation === operationGeneration) {
          setStatus("operation", error instanceof Error ? error.message : "标签页操作失败");
        }
      },
    ).finally(onSettled);
  };

  const blockPendingSettings = (event: MouseEvent): void => {
    if (!shortcutSettingsReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  elements.settingsButton.disabled = true;
  elements.settingsButton.addEventListener("click", blockPendingSettings, true);

  const discardPendingAttached = (): void => {
    for (const slot of pendingAttachedSlots) {
      slot.resolve(() => undefined);
    }
    pendingAttachedSlots.clear();
    attachedSlotsById.clear();
  };

  const shortcutRenderer = createShortcutRenderer(
    {
      strip: elements.shortcutStrip,
      dialog: elements.dialog,
      form: elements.form,
      enabled: elements.shortcutEnabled,
      fontSize: elements.tabTitleFontSize,
      editor: elements.shortcutEditor,
      error: elements.shortcutError,
      add: elements.shortcutAdd,
      reset: elements.shortcutReset,
      settingsButton: elements.settingsButton,
    },
    {
      async onOpen(url) {
        const generation = ++operationGeneration;
        try {
          await shortcutActions.open(url);
          if (generation === operationGeneration) {
            setStatus("operation", "");
          }
        } catch (error) {
          if (generation === operationGeneration) {
            throw error;
          }
        }
      },
      onOpenError: (message) => setStatus("operation", message),
      onFontSizePreview: (size) => {
        deps.document.documentElement.style.setProperty("--tab-title-font-size", `${size}px`);
      },
      onSave: (settings) => shortcutStore.save(settings),
    },
  );

  const syncShortcutFavicons = (): void => {
    if (active) {
      shortcutRenderer.setFaviconsByOrigin(createOriginFaviconMap(tabStore.list()));
    }
  };

  const updateDragEnabled = (): void => {
    tabRenderer.setDragEnabled(elements.search.value.trim() === "" && !reorderBusy);
  };

  const contextMenu = createTabContextMenu(
    { document: deps.document, list: elements.list, viewport: deps.document.defaultView! },
    {
      getTab: (id) => tabStore.list().find((tab) => tab.id === id),
      onCommand(command) {
        const operation = command.action === "duplicate"
          ? tabActions.duplicate(command.tabId)
          : tabActions.setPinned(command.tabId, command.pinned);
        runTabOperation(operation);
      },
    },
  );

  const dragController = createTabDragController(
    { list: elements.list },
    {
      onDrop(intent) {
        if (reorderBusy || elements.search.value.trim()) return;
        const plan = createTabReorderPlan(
          tabStore.list(), intent.sourceId, intent.targetId, intent.placement,
        );
        if (!plan) return;
        reorderBusy = true;
        updateDragEnabled();
        runTabOperation(tabActions.reorder(plan), () => {
          if (!active) return;
          reorderBusy = false;
          updateDragEnabled();
        });
      },
    },
  );

  const cleanup = (): void => {
    if (!active) {
      return;
    }
    active = false;
    unsubscribeTabs();
    bufferingTabEvents = false;
    bufferedTabEvents.length = 0;
    discardPendingAttached();
    elements.list.removeEventListener("click", onListClick);
    elements.search.removeEventListener("input", onSearchInput);
    elements.settingsButton.removeEventListener("click", blockPendingSettings, true);
    contextMenu.destroy();
    dragController.destroy();
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
      runTabOperation(operation);
    }
  };

  const onSearchInput = (): void => {
    updateDragEnabled();
    contextMenu.close();
    dragController.cancel();
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
  updateDragEnabled();
  signal?.addEventListener("abort", cleanup, { once: true });
  if (signal?.aborted) {
    cleanup();
  }

  const applyTabEvent = (mutate: () => void, renderLive: () => void): void => {
    if (!active) {
      return;
    }
    if (bufferingTabEvents) {
      bufferedTabEvents.push(Promise.resolve(mutate));
      return;
    }
    mutate();
    syncShortcutFavicons();
    renderLive();
  };

  const removeTab = (tabId: number): void => {
    contextMenu.closeForTab(tabId);
    applyTabEvent(
      () => {
        tabStore.remove(tabId);
      },
      () => {
        if (currentQuery) {
          renderFilteredTabs();
        } else {
          tabRenderer.remove(tabId);
        }
      },
    );
  };

  const tabEventHandlers = {
    created(tab: chrome.tabs.Tab) {
      applyTabEvent(
        () => {
          tabStore.add(tab);
        },
        renderFilteredTabs,
      );
    },
    attached(tab: chrome.tabs.Tab) {
      if (bufferedAttachedTabs.delete(tab)) {
        return;
      }
      applyTabEvent(
        () => {
          tabStore.add(tab);
        },
        renderFilteredTabs,
      );
    },
    updated(tab: chrome.tabs.Tab) {
      if (tab.id !== undefined) {
        contextMenu.closeForTab(tab.id);
      }
      let previous: ReturnType<TabStore["list"]>[number] | undefined;
      let model: ReturnType<TabStore["replace"]>;
      applyTabEvent(
        () => {
          const tabs = tabStore.list();
          previous = tab.id === undefined
            ? undefined
            : tabs.find((item) => item.id === tab.id);
          model = tabStore.replace(tab);
        },
        () => {
          if (!model) return;
          const rowExists = findTabRow(elements.list, model.id) !== undefined;
          if (currentQuery || !previous || !rowExists || previous.index !== model.index) {
            renderFilteredTabs();
          } else {
            tabRenderer.patch(model);
          }
        },
      );
    },
    activated(tabId: number) {
      let affected = new Set<number>();
      let tabs: ReturnType<TabStore["list"]> = [];
      applyTabEvent(
        () => {
          const before = tabStore.list();
          affected = new Set([
            ...before.filter((tab) => tab.active).map((tab) => tab.id),
            tabId,
          ]);
          tabStore.activate(tabId);
          tabs = tabStore.list();
        },
        () => {
          if (currentQuery) {
            renderFilteredTabs();
            return;
          }
          for (const tab of tabs) {
            if (affected.has(tab.id)) {
              tabRenderer.patch(tab);
            }
          }
        },
      );
    },
    removed: removeTab,
    detached: removeTab,
    moved(tabId: number, index: number) {
      applyTabEvent(
        () => {
          tabStore.move(tabId, index);
        },
        renderFilteredTabs,
      );
    },
  };

  const subscribeWithBufferedAttachments = (windowId: number): (() => void) => {
    type AttachedListener = Parameters<typeof deps.tabs.onAttached.addListener>[0];
    const attachedListeners = new Map<AttachedListener, AttachedListener>();
    const wrappedOnAttached = {
      addListener(listener: AttachedListener): void {
        const wrapped: AttachedListener = (tabId, attachInfo) => {
          if (active && bufferingTabEvents && attachInfo.newWindowId === windowId) {
            let resolve!: (mutation: () => void) => void;
            const promise = new Promise<() => void>((resolvePromise) => {
              resolve = resolvePromise;
            });
            const slot: AttachedSlot = { resolve };
            const slots = attachedSlotsById.get(tabId) ?? [];
            slots.push(slot);
            attachedSlotsById.set(tabId, slots);
            pendingAttachedSlots.add(slot);
            bufferedTabEvents.push(promise);
          }
          listener(tabId, attachInfo);
        };
        attachedListeners.set(listener, wrapped);
        deps.tabs.onAttached.addListener(wrapped);
      },
      removeListener(listener: AttachedListener): void {
        const wrapped = attachedListeners.get(listener);
        if (wrapped) {
          deps.tabs.onAttached.removeListener(wrapped);
          attachedListeners.delete(listener);
        }
      },
    } as typeof deps.tabs.onAttached;

    const getAttachedTab = async (tabId: number): Promise<chrome.tabs.Tab> => {
      const slots = attachedSlotsById.get(tabId);
      const slot = slots?.shift();
      if (slots?.length === 0) {
        attachedSlotsById.delete(tabId);
      }
      try {
        const tab = await deps.tabs.get(tabId);
        if (slot) {
          pendingAttachedSlots.delete(slot);
          if (active && tab.windowId === windowId) {
            bufferedAttachedTabs.add(tab);
            slot.resolve(() => {
              tabStore.add(tab);
            });
          } else {
            slot.resolve(() => undefined);
          }
        }
        return tab;
      } catch (error) {
        if (slot) {
          pendingAttachedSlots.delete(slot);
          slot.resolve(() => undefined);
        }
        throw error;
      }
    };

    const tabsApi = new Proxy(deps.tabs, {
      get(target, property, receiver) {
        if (property === "onAttached") return wrappedOnAttached;
        if (property === "get") return getAttachedTab;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    return subscribeToTabEvents(tabsApi, windowId, tabEventHandlers);
  };

  const finishShortcutLoad = (
    settings: ReturnType<typeof createDefaultShortcutSettings>,
  ): void => {
    if (!active) {
      return;
    }
    shortcutRenderer.render(settings);
    shortcutSettingsReady = true;
    elements.settingsButton.disabled = false;
  };

  const loadShortcuts = shortcutStore.load().then(
    (settings) => {
      finishShortcutLoad(settings);
    },
    () => {
      if (active) {
        finishShortcutLoad(createDefaultShortcutSettings());
        setStatus("shortcuts", "无法读取快捷网站设置");
      }
    },
  );

  const loadTabs = (async () => {
    try {
      const currentWindow = await deps.windows.getCurrent();
      if (!active) return;
      const windowId = currentWindow.id;
      if (
        typeof windowId !== "number" ||
        !Number.isFinite(windowId) ||
        !Number.isInteger(windowId)
      ) {
        throw new Error("当前窗口缺少有效 ID");
      }

      bufferingTabEvents = true;
      unsubscribeTabs = subscribeWithBufferedAttachments(windowId);

      let snapshot: chrome.tabs.Tab[];
      try {
        snapshot = await deps.tabs.query({ windowId });
      } catch {
        if (active) {
          unsubscribeTabs();
          unsubscribeTabs = () => undefined;
          bufferingTabEvents = false;
          bufferedTabEvents.length = 0;
          discardPendingAttached();
          setStatus("tabs", "无法读取当前窗口的标签页");
        }
        return;
      }
      if (!active) return;

      tabStore.initialize(snapshot);
      while (bufferedTabEvents.length > 0) {
        const pending = bufferedTabEvents.shift();
        if (!pending) break;
        const apply = await pending;
        if (!active) return;
        apply();
      }
      bufferingTabEvents = false;
      syncShortcutFavicons();
      renderFilteredTabs();
    } catch {
      setStatus("tabs", "无法读取当前窗口的标签页");
    }
  })();

  await Promise.all([loadShortcuts, loadTabs]);
  if (active) {
    deps.document.documentElement.dataset.ready = "true";
  }

  return cleanup;
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
    tabTitleFontSize: requireElement(document, "tab-title-font-size", HTMLInputElement),
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
