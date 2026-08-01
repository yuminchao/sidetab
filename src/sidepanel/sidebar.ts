import { appendTabShortcut, createDefaultShortcutSettings } from "./shortcut-model";
import { createShortcutActions } from "./shortcut-actions";
import { createShortcutRenderer } from "./shortcut-renderer";
import { createShortcutStore, type StorageArea } from "./shortcut-store";
import { createShortcutFaviconCacheStore } from "./shortcut-favicon-cache";
import { createOriginFaviconMap, getHttpOrigin } from "./favicon-model";
import type { BookmarkSearchApi } from "./bookmark-search";
import {
  createRecentlyClosedTabController,
  type SessionsApi,
} from "./recently-closed-tab";
import {
  createHistorySearchController,
  type HistorySearchApi,
} from "./history-search";
import { createTabActions } from "./tab-actions";
import { getClosableTabsBelow } from "./tab-close-model";
import { createTabContextMenu } from "./tab-context-menu";
import { createTabDragController } from "./tab-drag-controller";
import { subscribeToTabEvents } from "./tab-events";
import { createTabGroupActions } from "./tab-group-actions";
import { createTabGroupDialog } from "./tab-group-dialog";
import { subscribeToTabGroupEvents } from "./tab-group-events";
import { TabGroupStore } from "./tab-group-store";
import { buildTabListItems } from "./tab-list-model";
import { createTabMiddleClickController } from "./tab-middle-click";
import { createTabReorderPlan } from "./tab-reorder-model";
import { createTabRenderer } from "./tab-renderer";
import { TabStore } from "./tab-store";

export type SidebarDependencies = {
  tabs: typeof chrome.tabs;
  tabGroups: typeof chrome.tabGroups;
  windows: Pick<typeof chrome.windows, "getCurrent">;
  storage: StorageArea;
  bookmarks: BookmarkSearchApi;
  history: HistorySearchApi;
  sessions: SessionsApi;
  document: Document;
};

type SidebarElements = {
  shortcutStrip: HTMLElement;
  search: HTMLInputElement;
  historyResults: HTMLElement;
  settingsButton: HTMLButtonElement;
  chromeAppearanceSettings: HTMLButtonElement;
  status: HTMLElement;
  tabRegion: HTMLElement;
  tabScroll: HTMLElement;
  empty: HTMLElement;
  list: HTMLElement;
  newTabButton: HTMLButtonElement;
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
  groupDialog: HTMLDialogElement;
  groupForm: HTMLFormElement;
  groupName: HTMLInputElement;
  groupColors: HTMLInputElement[];
  groupError: HTMLElement;
  groupCancel: HTMLButtonElement;
  groupCreate: HTMLButtonElement;
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
  const groupStore = new TabGroupStore();
  const tabActions = createTabActions(deps.tabs);
  const groupActions = createTabGroupActions(deps.tabs, deps.tabGroups);
  const shortcutStore = createShortcutStore(deps.storage);
  const faviconCacheStore = createShortcutFaviconCacheStore(deps.storage);
  const shortcutActions = createShortcutActions(deps.tabs);
  const tabRenderer = createTabRenderer({ list: elements.list, empty: elements.empty });
  let active = true;
  const recentlyClosed = createRecentlyClosedTabController(deps.sessions);
  let currentWindowId: number | undefined;
  let unsubscribeTabs: () => void = () => undefined;
  let unsubscribeGroups: () => void = () => undefined;
  let bufferingEvents = false;
  let faviconMapSignature: string | undefined;
  const bufferedEvents: Array<Promise<() => void>> = [];
  type AsyncEventSlot = {
    kind: "attached" | "replaced";
    removedTabId?: number;
    resolve(mutation: () => void): void;
  };
  const asyncEventSlotsById = new Map<number, AsyncEventSlot[]>();
  const pendingAsyncEventSlots = new Set<AsyncEventSlot>();
  const bufferedAttachedTabs = new WeakSet<chrome.tabs.Tab>();
  const bufferedReplacementTabs = new WeakSet<chrome.tabs.Tab>();
  let shortcutSettingsReady = false;
  let operationGeneration = 0;
  let reorderBusy = false;
  type ResyncPhase = "idle" | "querying" | "replaying";
  let resyncPhase: ResyncPhase = "idle";
  let resyncFollowUpRequested = false;
  let resyncPromise: Promise<void> | undefined;
  let addShortcutBusy = false;
  let appearanceSettingsBusy = false;
  let restoreRecentlyClosedBusy = false;
  const groupTabBusy = new Set<number>();
  const groupToggleBusy = new Set<number>();
  const statusSlots = {
    tabs: "",
    groups: "",
    shortcuts: "",
    operation: "",
  };

  const setStatus = (source: keyof typeof statusSlots, message: string): void => {
    if (active) {
      statusSlots[source] = message;
      elements.status.textContent = [
        statusSlots.tabs,
        statusSlots.groups,
        statusSlots.shortcuts,
        statusSlots.operation,
      ].filter(Boolean).join("；");
    }
  };

  const runTabOperation = (
    operation: Promise<void>,
    onSettled?: () => void,
    onRejected?: () => void,
  ): void => {
    const generation = ++operationGeneration;
    void operation.then(
      () => {
        if (generation === operationGeneration) setStatus("operation", "");
      },
      (error: unknown) => {
        if (generation === operationGeneration) {
          setStatus("operation", error instanceof Error ? error.message : "标签页操作失败");
        }
        onRejected?.();
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

  const discardPendingAsyncEvents = (): void => {
    for (const slot of pendingAsyncEventSlots) {
      slot.resolve(() => undefined);
    }
    pendingAsyncEventSlots.clear();
    asyncEventSlotsById.clear();
  };

  const finishBufferedEvents = async (): Promise<boolean> => {
    let replayed = false;
    while (active) {
      const pending = bufferedEvents.shift();
      if (!pending) {
        bufferingEvents = false;
        return replayed;
      }
      const apply = await pending;
      if (!active) return replayed;
      apply();
      replayed = true;
    }
    return replayed;
  };

  const renderTabList = (): void => {
    tabRenderer.render(buildTabListItems(tabStore.list(), groupStore.list()));
  };

  const flushFaviconCache = (): void => {
    void faviconCacheStore.flush().catch((error: unknown) => {
      setStatus(
        "shortcuts",
        error instanceof Error ? error.message : "无法保存快捷网站图标缓存",
      );
    });
  };

  let shortcutRenderer: ReturnType<typeof createShortcutRenderer>;
  shortcutRenderer = createShortcutRenderer(
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
      onFaviconLoaded(origin, url) {
        faviconCacheStore.update(origin, url);
        flushFaviconCache();
      },
      onCachedFaviconFailed(origin, url) {
        if (faviconCacheStore.snapshot().get(origin) !== url) return;
        faviconCacheStore.update(origin, undefined);
        queueMicrotask(() => {
          if (active) {
            shortcutRenderer.setCachedFaviconsByOrigin(faviconCacheStore.snapshot());
          }
        });
        flushFaviconCache();
      },
      async onSave(settings) {
        const saved = await shortcutStore.save(settings);
        faviconCacheStore.prune(createShortcutOrigins(saved));
        shortcutRenderer.setCachedFaviconsByOrigin(faviconCacheStore.snapshot());
        flushFaviconCache();
        return saved;
      },
    },
  );
  shortcutRenderer.render({ ...createDefaultShortcutSettings(), enabled: false });

  const historySearch = createHistorySearchController(
    {
      document: deps.document,
      input: elements.search,
      results: elements.historyResults,
    },
    {
      bookmarks: deps.bookmarks,
      history: deps.history,
      async onOpen(url) {
        try {
          await deps.tabs.create({ url, active: true });
        } catch {
          throw new Error("无法打开历史记录");
        }
      },
      onOpenError: (message) => setStatus("operation", message),
    },
  );

  const syncShortcutFavicons = (): void => {
    if (!active) return;
    const favicons = createOriginFaviconMap(tabStore.list());
    const signature = JSON.stringify(Array.from(favicons.entries()));
    if (signature === faviconMapSignature) return;
    faviconMapSignature = signature;
    shortcutRenderer.setFaviconsByOrigin(favicons);
    historySearch.setFaviconsByOrigin(favicons);
  };

  const resyncTabsAndGroups = (): Promise<void> => {
    if (resyncPromise) {
      if (resyncPhase === "replaying") {
        resyncFollowUpRequested = true;
      }
      return resyncPromise;
    }
    if (!active || currentWindowId === undefined) return Promise.resolve();
    const windowId = currentWindowId;
    let operation!: Promise<void>;
    operation = (async (): Promise<void> => {
      try {
        do {
          resyncFollowUpRequested = false;
          resyncPhase = "querying";
          bufferingEvents = true;
          let snapshotApplied = false;
          try {
            const [tabs, groups] = await Promise.all([
              deps.tabs.query({ windowId }),
              deps.tabGroups.query({ windowId }),
            ]);
            if (!active || currentWindowId !== windowId) break;
            tabStore.initialize(tabs);
            groupStore.initialize(groups, windowId);
            setStatus("groups", "");
            snapshotApplied = true;
          } catch {
            // A resync is best-effort; retaining the last coherent view avoids retry loops.
          }
          if (!active || currentWindowId !== windowId) break;
          resyncPhase = "replaying";
          const replayed = await finishBufferedEvents();
          if (!active || currentWindowId !== windowId) break;
          if (snapshotApplied || replayed) {
            syncShortcutFavicons();
            renderTabList();
          }
        } while (resyncFollowUpRequested);
      } finally {
        resyncPhase = "idle";
        resyncFollowUpRequested = false;
        if (resyncPromise === operation) resyncPromise = undefined;
      }
    })();
    resyncPromise = operation;
    return operation;
  };

  const runGroupOperation = (tabId: number, start: () => Promise<void>): void => {
    if (groupTabBusy.has(tabId)) return;
    groupTabBusy.add(tabId);
    runTabOperation(
      start(),
      () => groupTabBusy.delete(tabId),
      () => { void resyncTabsAndGroups(); },
    );
  };

  const groupDialog = createTabGroupDialog(
    {
      dialog: elements.groupDialog,
      form: elements.groupForm,
      name: elements.groupName,
      colors: elements.groupColors,
      error: elements.groupError,
      cancel: elements.groupCancel,
      create: elements.groupCreate,
    },
    {
      async onCreate(draft) {
        try {
          const groupId = await groupActions.create(draft);
          setStatus("operation", "");
          return groupId;
        } catch (error) {
          if (active) {
            setStatus("operation", error instanceof Error ? error.message : "无法创建标签组");
            void resyncTabsAndGroups();
          }
          throw error;
        }
      },
      async onUpdateCreated(draft) {
        try {
          await groupActions.updateCreated(
            draft.createdGroupId!,
            draft.title,
            draft.color,
          );
          setStatus("operation", "");
        } catch (error) {
          if (active) {
            setStatus("operation", error instanceof Error ? error.message : "无法更新标签组");
            void resyncTabsAndGroups();
          }
          throw error;
        }
      },
    },
  );

  const addTabShortcut = async (tabId: number): Promise<void> => {
    if (addShortcutBusy) return;
    addShortcutBusy = true;
    try {
      const tab = tabStore.list().find((item) => item.id === tabId);
      if (!tab) throw new Error("标签页已不存在");
      const settings = await shortcutStore.load();
      if (!active) return;
      const next = appendTabShortcut(settings, {
        id: crypto.randomUUID(),
        title: tab.title,
        url: tab.url,
      });
      const saved = await shortcutStore.save(next);
      if (!active) return;
      faviconCacheStore.prune(createShortcutOrigins(saved));
      shortcutRenderer.setCachedFaviconsByOrigin(faviconCacheStore.snapshot());
      flushFaviconCache();
      shortcutRenderer.render(saved);
      syncShortcutFavicons();
      setStatus("shortcuts", "已添加到快捷网站");
    } catch (error) {
      if (active) {
        setStatus(
          "shortcuts",
          error instanceof Error ? error.message : "无法保存快捷网站设置",
        );
      }
    } finally {
      addShortcutBusy = false;
    }
  };

  const updateDragEnabled = (): void => {
    tabRenderer.setDragEnabled(!reorderBusy);
  };

  const contextMenu = createTabContextMenu(
    { document: deps.document, list: elements.list, viewport: deps.document.defaultView! },
    {
      getTab: (id) => tabStore.list().find((tab) => tab.id === id),
      getGroups: () => groupStore.list(),
      canCloseBelow: (id) => getClosableTabsBelow(tabStore.list(), id).length > 0,
      getRecentlyClosedSessionId: () => recentlyClosed.getSessionId(),
      onCommand(command) {
        if (command.action === "add-shortcut") {
          void addTabShortcut(command.tabId);
          return;
        }
        if (command.action === "close-below") {
          const tabIds = getClosableTabsBelow(tabStore.list(), command.tabId);
          runTabOperation(tabActions.closeMany(tabIds));
          return;
        }
        if (command.action === "create-group") {
          if (currentWindowId !== undefined) {
            groupDialog.open(command.tabId, currentWindowId);
          }
          return;
        }
        if (command.action === "add-to-group") {
          runGroupOperation(command.tabId, () =>
            groupActions.add(command.tabId, command.groupId));
          return;
        }
        if (command.action === "remove-from-group") {
          runGroupOperation(command.tabId, () => groupActions.remove(command.tabId));
          return;
        }
        if (command.action === "duplicate") {
          runTabOperation(tabActions.duplicate(command.tabId));
          return;
        }
        if (command.action === "restore-recently-closed") {
          if (restoreRecentlyClosedBusy) return;
          restoreRecentlyClosedBusy = true;
          runTabOperation(
            recentlyClosed.restore(command.sessionId),
            () => {
              restoreRecentlyClosedBusy = false;
            },
          );
          return;
        }
        if (command.action === "set-pinned") {
          runTabOperation(tabActions.setPinned(command.tabId, command.pinned));
        }
      },
    },
  );

  const dragController = createTabDragController(
    { list: elements.list },
    {
      onDrop(intent) {
        if (reorderBusy) return;
        const plan = createTabReorderPlan(
          tabStore.list(), intent.sourceId, intent.target,
        );
        if (!plan) return;
        reorderBusy = true;
        updateDragEnabled();
        runTabOperation(
          tabActions.reorder(plan),
          () => {
            if (!active) return;
            reorderBusy = false;
            updateDragEnabled();
          },
          plan.groupChanged ? () => { void resyncTabsAndGroups(); } : undefined,
        );
      },
    },
  );

  const middleClickController = createTabMiddleClickController(
    { list: elements.list },
    { onClose: (tabId) => runTabOperation(tabActions.close(tabId)) },
  );

  const onNewTabClick = (): void => {
    if (elements.newTabButton.disabled) return;
    elements.newTabButton.disabled = true;
    runTabOperation(tabActions.create(), () => {
      if (active) elements.newTabButton.disabled = false;
    });
  };

  const onTabScroll = (): void => {
    contextMenu.close();
    dragController.cancel();
    historySearch.close();
  };

  const onSettingsClick = (): void => historySearch.close();

  const onChromeAppearanceSettingsClick = (): void => {
    if (appearanceSettingsBusy) return;
    appearanceSettingsBusy = true;
    elements.chromeAppearanceSettings.disabled = true;
    elements.shortcutError.textContent = "";

    void (async () => {
      try {
        await deps.tabs.create({
          url: "chrome://settings/appearance",
          active: true,
        });
      } catch {
        if (active) {
          elements.shortcutError.textContent = "无法打开 Chrome 外观设置";
        }
      } finally {
        if (active) {
          appearanceSettingsBusy = false;
          elements.chromeAppearanceSettings.disabled = false;
        }
      }
    })();
  };

  const cleanup = (): void => {
    if (!active) {
      return;
    }
    active = false;
    unsubscribeTabs();
    unsubscribeGroups();
    bufferingEvents = false;
    bufferedEvents.length = 0;
    discardPendingAsyncEvents();
    elements.list.removeEventListener("click", onListClick);
    elements.newTabButton.removeEventListener("click", onNewTabClick);
    elements.tabScroll.removeEventListener("scroll", onTabScroll);
    elements.settingsButton.removeEventListener("click", onSettingsClick);
    elements.chromeAppearanceSettings.removeEventListener(
      "click",
      onChromeAppearanceSettingsClick,
    );
    elements.settingsButton.removeEventListener("click", blockPendingSettings, true);
    contextMenu.destroy();
    recentlyClosed.destroy();
    groupDialog.close();
    groupDialog.destroy();
    dragController.destroy();
    middleClickController.destroy();
    historySearch.destroy();
    tabRenderer.destroy();
    shortcutRenderer.destroy();
    faviconCacheStore.destroy();
    signal?.removeEventListener("abort", cleanup);
  };

  const onListClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const actionElement = target.closest<HTMLElement>("[data-action]");
    const groupRow = actionElement?.closest<HTMLElement>("[data-group-id]");
    if (
      actionElement?.dataset.action === "toggle-group" &&
      groupRow &&
      elements.list.contains(groupRow)
    ) {
      const groupId = Number(groupRow.dataset.groupId);
      const group = Number.isInteger(groupId) ? groupStore.get(groupId) : undefined;
      if (!group || groupToggleBusy.has(group.id)) return;
      groupToggleBusy.add(group.id);
      runTabOperation(
        groupActions.setCollapsed(group.id, !group.collapsed),
        () => groupToggleBusy.delete(group.id),
        () => { void resyncTabsAndGroups(); },
      );
      return;
    }
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

  elements.list.addEventListener("click", onListClick);
  elements.newTabButton.addEventListener("click", onNewTabClick);
  elements.tabScroll.addEventListener("scroll", onTabScroll);
  elements.settingsButton.addEventListener("click", onSettingsClick);
  elements.chromeAppearanceSettings.addEventListener(
    "click",
    onChromeAppearanceSettingsClick,
  );
  updateDragEnabled();
  signal?.addEventListener("abort", cleanup, { once: true });
  if (signal?.aborted) {
    cleanup();
  }

  const applyEvent = (
    mutate: () => void,
    renderLive: () => void,
    syncFavicons = false,
  ): void => {
    if (!active) {
      return;
    }
    if (bufferingEvents) {
      bufferedEvents.push(Promise.resolve(mutate));
      return;
    }
    mutate();
    if (syncFavicons) syncShortcutFavicons();
    renderLive();
  };

  const removeTab = (tabId: number): void => {
    contextMenu.closeForTab(tabId);
    applyEvent(
      () => {
        tabStore.remove(tabId);
      },
      renderTabList,
      true,
    );
  };

  const tabEventHandlers = {
    created(tab: chrome.tabs.Tab) {
      applyEvent(
        () => {
          tabStore.add(tab);
        },
        renderTabList,
        true,
      );
    },
    attached(tab: chrome.tabs.Tab) {
      if (bufferedAttachedTabs.delete(tab)) {
        return;
      }
      applyEvent(
        () => {
          tabStore.add(tab);
        },
        renderTabList,
        true,
      );
    },
    replaced(tab: chrome.tabs.Tab, removedTabId: number) {
      if (bufferedReplacementTabs.delete(tab)) {
        return;
      }
      contextMenu.closeForTab(removedTabId);
      applyEvent(
        () => {
          tabStore.replaceId(removedTabId, tab);
        },
        renderTabList,
        true,
      );
    },
    replacementLookupFailed() {
      void resyncTabsAndGroups();
    },
    updated(tab: chrome.tabs.Tab) {
      let previous: ReturnType<TabStore["list"]>[number] | undefined;
      let model: ReturnType<TabStore["replace"]>;
      applyEvent(
        () => {
          const tabs = tabStore.list();
          previous = tab.id === undefined
            ? undefined
            : tabs.find((item) => item.id === tab.id);
          model = tabStore.replace(tab);
          if (previous && model && previous.pinned !== model.pinned) {
            contextMenu.closeForTab(model.id);
          }
        },
        () => {
          if (!model) return;
          const rowExists = findTabRow(elements.list, model.id) !== undefined;
          if (
            !previous ||
            !rowExists ||
            previous.index !== model.index ||
            previous.groupId !== model.groupId ||
            previous.pinned !== model.pinned
          ) {
            renderTabList();
          } else {
            tabRenderer.patchTab(model);
          }
        },
        true,
      );
    },
    activated(tabId: number) {
      let affected = new Set<number>();
      let tabs: ReturnType<TabStore["list"]> = [];
      applyEvent(
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
          for (const tab of tabs) {
            if (affected.has(tab.id)) {
              tabRenderer.patchTab(tab);
            }
          }
        },
        true,
      );
    },
    removed: removeTab,
    detached: removeTab,
    moved(tabId: number, index: number) {
      applyEvent(
        () => {
          tabStore.move(tabId, index);
        },
        renderTabList,
        true,
      );
    },
  };

  const groupEventHandlers = {
    created(group: chrome.tabGroups.TabGroup) {
      applyEvent(
        () => {
          if (currentWindowId !== undefined) groupStore.put(group, currentWindowId);
        },
        renderTabList,
      );
    },
    updated(group: chrome.tabGroups.TabGroup) {
      let previous: ReturnType<TabGroupStore["get"]>;
      let model: ReturnType<TabGroupStore["put"]>;
      applyEvent(
        () => {
          previous = groupStore.get(group.id);
          if (currentWindowId !== undefined) model = groupStore.put(group, currentWindowId);
        },
        () => {
          if (!model) return;
          if (!previous || previous.collapsed !== model.collapsed) {
            renderTabList();
          } else {
            tabRenderer.patchGroup(model);
          }
        },
      );
    },
    moved(group: chrome.tabGroups.TabGroup) {
      applyEvent(
        () => {
          if (currentWindowId !== undefined) groupStore.put(group, currentWindowId);
        },
        renderTabList,
      );
    },
    removed(groupId: number) {
      applyEvent(
        () => {
          groupStore.remove(groupId);
        },
        renderTabList,
      );
    },
  };

  const subscribeWithBufferedAsyncEvents = (windowId: number): (() => void) => {
    type AttachedListener = Parameters<typeof deps.tabs.onAttached.addListener>[0];
    type ReplacedListener = Parameters<typeof deps.tabs.onReplaced.addListener>[0];
    const attachedListeners = new Map<AttachedListener, AttachedListener>();
    const replacedListeners = new Map<ReplacedListener, ReplacedListener>();
    const reserveAsyncEvent = (
      tabId: number,
      kind: AsyncEventSlot["kind"],
      removedTabId?: number,
    ): void => {
      let resolve!: (mutation: () => void) => void;
      const promise = new Promise<() => void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      const slot: AsyncEventSlot = { kind, removedTabId, resolve };
      const slots = asyncEventSlotsById.get(tabId) ?? [];
      slots.push(slot);
      asyncEventSlotsById.set(tabId, slots);
      pendingAsyncEventSlots.add(slot);
      bufferedEvents.push(promise);
    };
    const wrappedOnAttached = {
      addListener(listener: AttachedListener): void {
        const wrapped: AttachedListener = (tabId, attachInfo) => {
          if (active && bufferingEvents && attachInfo.newWindowId === windowId) {
            reserveAsyncEvent(tabId, "attached");
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
    const wrappedOnReplaced = {
      addListener(listener: ReplacedListener): void {
        const wrapped: ReplacedListener = (addedTabId, removedTabId) => {
          if (active && bufferingEvents) {
            reserveAsyncEvent(addedTabId, "replaced", removedTabId);
          }
          listener(addedTabId, removedTabId);
        };
        replacedListeners.set(listener, wrapped);
        deps.tabs.onReplaced.addListener(wrapped);
      },
      removeListener(listener: ReplacedListener): void {
        const wrapped = replacedListeners.get(listener);
        if (wrapped) {
          deps.tabs.onReplaced.removeListener(wrapped);
          replacedListeners.delete(listener);
        }
      },
    } as typeof deps.tabs.onReplaced;

    const getAsyncEventTab = async (tabId: number): Promise<chrome.tabs.Tab> => {
      const slots = asyncEventSlotsById.get(tabId);
      const slot = slots?.shift();
      if (slots?.length === 0) {
        asyncEventSlotsById.delete(tabId);
      }
      try {
        const tab = await deps.tabs.get(tabId);
        if (slot) {
          pendingAsyncEventSlots.delete(slot);
          if (active && tab.windowId === windowId) {
            if (slot.kind === "attached") {
              bufferedAttachedTabs.add(tab);
              slot.resolve(() => {
                tabStore.add(tab);
              });
            } else {
              bufferedReplacementTabs.add(tab);
              slot.resolve(() => {
                if (slot.removedTabId !== undefined) {
                  contextMenu.closeForTab(slot.removedTabId);
                  tabStore.replaceId(slot.removedTabId, tab);
                }
              });
            }
          } else {
            slot.resolve(() => undefined);
          }
        }
        return tab;
      } catch (error) {
        if (slot) {
          pendingAsyncEventSlots.delete(slot);
          slot.resolve(() => undefined);
        }
        throw error;
      }
    };

    const tabsApi = new Proxy(deps.tabs, {
      get(target, property, receiver) {
        if (property === "onAttached") return wrappedOnAttached;
        if (property === "onReplaced") return wrappedOnReplaced;
        if (property === "get") return getAsyncEventTab;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    return subscribeToTabEvents(tabsApi, windowId, tabEventHandlers);
  };

  const finishShortcutLoad = (
    settings: ReturnType<typeof createDefaultShortcutSettings>,
    cachedFavicons: ReadonlyMap<string, string>,
  ): void => {
    if (!active) {
      return;
    }
    shortcutRenderer.setCachedFaviconsByOrigin(cachedFavicons);
    shortcutRenderer.render(settings);
    shortcutSettingsReady = true;
    elements.settingsButton.disabled = false;
  };

  const loadShortcuts = Promise.all([
    shortcutStore.load().then(
      (settings) => ({ settings, error: "" }),
      () => ({ settings: createDefaultShortcutSettings(), error: "无法读取快捷网站设置" }),
    ),
    faviconCacheStore.load().then(
      (cache) => ({ cache, error: "" }),
      () => ({ cache: new Map<string, string>(), error: "无法读取快捷网站图标缓存" }),
    ),
  ]).then(([settingsResult, cacheResult]) => {
    if (!active) return;
    faviconCacheStore.prune(createShortcutOrigins(settingsResult.settings));
    const cache = faviconCacheStore.snapshot();
    finishShortcutLoad(settingsResult.settings, cache);
    const message = [settingsResult.error, cacheResult.error].filter(Boolean).join("；");
    setStatus("shortcuts", message);
    flushFaviconCache();
  });

  const loadTabsAndGroups = (async () => {
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

      currentWindowId = windowId;
      bufferingEvents = true;
      unsubscribeTabs = subscribeWithBufferedAsyncEvents(windowId);
      unsubscribeGroups = subscribeToTabGroupEvents(
        deps.tabGroups,
        windowId,
        groupEventHandlers,
      );

      const [tabsResult, groupsResult] = await Promise.allSettled([
        deps.tabs.query({ windowId }),
        deps.tabGroups.query({ windowId }),
      ]);
      if (tabsResult.status === "rejected") {
        if (active) {
          unsubscribeTabs();
          unsubscribeGroups();
          unsubscribeTabs = () => undefined;
          unsubscribeGroups = () => undefined;
          bufferingEvents = false;
          bufferedEvents.length = 0;
          discardPendingAsyncEvents();
          setStatus("tabs", "无法读取当前窗口的标签页");
        }
        return;
      }
      if (!active) return;

      tabStore.initialize(tabsResult.value);
      if (groupsResult.status === "fulfilled") {
        groupStore.initialize(groupsResult.value, windowId);
        setStatus("groups", "");
      } else {
        groupStore.initialize([], windowId);
        setStatus("groups", "无法读取当前窗口的标签分组");
      }
      await finishBufferedEvents();
      if (!active) return;
      syncShortcutFavicons();
      renderTabList();
    } catch {
      setStatus("tabs", "无法读取当前窗口的标签页");
    }
  })();

  await Promise.all([loadShortcuts, loadTabsAndGroups]);
  if (active) {
    deps.document.documentElement.dataset.ready = "true";
  }

  return cleanup;
}

function getSidebarElements(document: Document): SidebarElements {
  return {
    shortcutStrip: requireElement(document, "shortcut-strip", HTMLElement),
    search: requireElement(document, "tab-search", HTMLInputElement),
    historyResults: requireElement(document, "history-search-results", HTMLElement),
    settingsButton: requireElement(document, "shortcut-settings", HTMLButtonElement),
    chromeAppearanceSettings: requireElement(
      document,
      "chrome-appearance-settings",
      HTMLButtonElement,
    ),
    status: requireElement(document, "status-message", HTMLElement),
    tabRegion: requireElement(document, "tab-region", HTMLElement),
    tabScroll: requireElement(document, "tab-scroll", HTMLElement),
    empty: requireElement(document, "tab-empty", HTMLElement),
    list: requireElement(document, "tab-list", HTMLElement),
    newTabButton: requireElement(document, "new-tab-button", HTMLButtonElement),
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
    groupDialog: requireElement(document, "tab-group-dialog", HTMLDialogElement),
    groupForm: requireElement(document, "tab-group-form", HTMLFormElement),
    groupName: requireElement(document, "tab-group-name", HTMLInputElement),
    groupColors: Array.from(document.querySelectorAll<HTMLInputElement>(
      "#tab-group-dialog input[type='radio'][name='tab-group-color']",
    )),
    groupError: requireElement(document, "tab-group-error", HTMLElement),
    groupCancel: requireElement(document, "tab-group-cancel", HTMLButtonElement),
    groupCreate: requireElement(document, "tab-group-create", HTMLButtonElement),
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

function createShortcutOrigins(
  settings: ReturnType<typeof createDefaultShortcutSettings>,
): ReadonlySet<string> {
  return new Set(
    settings.items
      .slice(0, 12)
      .map((shortcut) => getHttpOrigin(shortcut.url))
      .filter(Boolean),
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
    tabGroups: chrome.tabGroups,
    windows: chrome.windows,
    bookmarks: chrome.bookmarks,
    history: chrome.history,
    sessions: chrome.sessions,
    storage: chrome.storage.local,
    document,
  }, window);
}
