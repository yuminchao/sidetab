import { appendTabShortcut, createDefaultShortcutSettings, getShortcutUrlsToOpen } from "./shortcut-model";
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
import { getClosableTabsAbove, getClosableTabsBelow } from "./tab-close-model";
import { createTabContextMenu } from "./tab-context-menu";
import { createTabDragController } from "./tab-drag-controller";
import { subscribeToTabEvents } from "./tab-events";
import { createTabGroupActions } from "./tab-group-actions";
import { createTabGroupContextMenu } from "./tab-group-context-menu";
import { createTabGroupDialog } from "./tab-group-dialog";
import { subscribeToTabGroupEvents } from "./tab-group-events";
import { createTabGroupRenameDialog } from "./tab-group-rename-dialog";
import { TabGroupStore } from "./tab-group-store";
import { buildTabListItems } from "./tab-list-model";
import { createTabMiddleClickController } from "./tab-middle-click";
import {
  createTabBlockReorderPlan,
  createTabReorderPlan,
  type TabDropTarget,
} from "./tab-reorder-model";
import { createTabGroupReorderPlan } from "./tab-group-reorder-model";
import type { TabDragIntent } from "./tab-drag-controller";
import { createTabRenderer } from "./tab-renderer";
import { TabStore } from "./tab-store";
import { createTabTreeSessionStore } from "./tab-tree-session-store";
import {
  classifySmartGroupTab,
  createOneClickGroupPlan,
  createQuickGroupPlan,
  type SmartGroupOperation,
  type SmartGroupPlan,
} from "./smart-group-model";
import {
  executeSmartGroupPlan,
  SmartGroupExecutionError,
} from "./smart-group-actions";
import { createSmartGroupSessionStore } from "./smart-group-session-store";
import { TAB_GROUP_ID_NONE } from "./tab-group-model";
import {
  getTabSubtreeIds,
  getTabTreeAncestorIds,
  getTabTreeParentId,
} from "./tab-tree-model";
import {
  createTabTreeDropResolver,
  type TabTreeDropRequest,
} from "./tab-tree-drop-model";
import {
  getOtherSameSiteTabIds,
} from "./same-site-tab-model";

export type SidebarDependencies = {
  tabs: typeof chrome.tabs;
  tabGroups: typeof chrome.tabGroups;
  windows: Pick<typeof chrome.windows, "getCurrent">;
  storage: StorageArea;
  sessionStorage?: StorageArea;
  bookmarks: BookmarkSearchApi;
  history: HistorySearchApi;
  sessions: SessionsApi;
  document: Document;
};

function resolveFlatTabDrop(request: TabTreeDropRequest): TabDropTarget | undefined {
  return request.relation === "sibling" ? request.target : undefined;
}

/** 从拖拽开始时的解析结果恢复用户原始意图，供 drop 时用最新标签树重新解析。 */
function requestFromResolvedTarget(target: TabDropTarget): TabTreeDropRequest | undefined {
  if (target.kind === "group" || !target.tree) return undefined;
  if (target.tree.relation === "child") {
    return { relation: "child", parentId: target.tree.referenceId };
  }
  if (target.kind === "end") {
    return { relation: "sibling", target: { kind: "end" } };
  }
  if (target.tree.referenceId === undefined) return undefined;
  return {
    relation: "sibling",
    target: {
      kind: "tab",
      tabId: target.tree.referenceId,
      placement: target.placement,
    },
  };
}

/** 精确比较最新解析结果，避免树结构变化后使用陈旧的排序锚点。 */
function sameResolvedTabTarget(left: TabDropTarget, right: TabDropTarget): boolean {
  if (left.kind !== right.kind || left.kind === "group" || right.kind === "group") {
    return false;
  }
  if (left.kind === "tab" && right.kind === "tab") {
    if (left.tabId !== right.tabId || left.placement !== right.placement) return false;
  }
  return left.tree?.relation === right.tree?.relation
    && left.tree?.referenceId === right.tree?.referenceId
    && left.tree?.depth === right.tree?.depth
    && left.tree?.parentId === right.tree?.parentId;
}

function planHasBusyTabs(
  plan: { operations: readonly SmartGroupOperation[] } | undefined,
  busyTabIds: ReadonlySet<number>,
): boolean {
  return plan?.operations.some((operation) =>
    operation.tabIds.some((tabId) => busyTabIds.has(tabId))) === true;
}

function toSmartGroupSnapshot(
  groups: ReturnType<TabGroupStore["list"]>,
): chrome.tabGroups.TabGroup[] {
  return groups.map((group) => ({ ...group, shared: false }));
}

type SidebarElements = {
  shortcutStrip: HTMLElement;
  locateActiveTab: HTMLButtonElement;
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
  contentTreeEnabled: HTMLInputElement;
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
  groupRenameDialog: HTMLDialogElement;
  groupRenameForm: HTMLFormElement;
  groupRenameName: HTMLInputElement;
  groupRenameError: HTMLElement;
  groupRenameCancel: HTMLButtonElement;
  groupRenameSave: HTMLButtonElement;
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
  const treeSessionStore = createTabTreeSessionStore(deps.sessionStorage);
  const smartGroupSessionStore = createSmartGroupSessionStore(deps.sessionStorage ?? {
    get: async () => ({}),
    set: async () => undefined,
  });
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
  let treeSessionReady = false;
  let tabsReady = false;
  let shortcutSettings = createDefaultShortcutSettings();
  let lastScrolledActiveTabId: number | undefined;
  const collapsedTabIds = new Set<number>();
  const detachedTabIds = new Set<number>();
  const attachedTabParentIds = new Map<number, number>();
  let treeSessionRevision = 0;
  // 仅父子关系变化推进版本；展开状态变化不应废弃正在进行的关系事务。
  let treeRelationRevision = 0;
  // 模式切换只废弃旧拖放的树关系提交，不影响 child 模式内的并发 session 合并。
  let treeModeGeneration = 0;
  const replacementTabIds = new Map<number, number>();
  let operationGeneration = 0;
  let reorderBusy = false;
  type ResyncPhase = "idle" | "querying" | "replaying";
  let resyncPhase: ResyncPhase = "idle";
  let resyncFollowUpRequested = false;
  let resyncPromise: Promise<void> | undefined;
  let addShortcutBusy = false;
  let appearanceSettingsBusy = false;
  let restoreRecentlyClosedBusy = false;
  let groupsReady = false;
  let groupingSnapshotsReady = false;
  let smartGroupRoleReady = false;
  let smartGroupingBusy = false;
  let otherGroupId: number | undefined;
  let otherGroupConfirmation: {
    groupId: number;
    tabIds: readonly number[];
    windowId: number;
  } | undefined;
  let smartGroupingGeneration = 0;
  let roleRevision = 0;
  let pendingOtherGroup: {
    groupId: number;
    token: number;
    clear?: Promise<void>;
  } | undefined;
  const groupTabBusy = new Set<number>();
  const groupToggleBusy = new Set<number>();
  const groupCommandBusy = new Set<number>();
  const smartGroupingTabIds = new Set<number>();
  const smartGroupingGroupIds = new Set<number>();
  const pendingGroupMoves = new Map<number, number>();
  const groupMovesCompletedByEvent = new Map<number, number>();
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
  elements.newTabButton.disabled = true;
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

  const isTreeEnabled = (): boolean =>
    treeSessionReady && shortcutSettings.contentTreeEnabled;

  const renderTabList = (): void => {
    const tabs = tabStore.list();
    tabRenderer.render(buildTabListItems(tabs, groupStore.list(), {
      treeEnabled: isTreeEnabled(),
      collapsedTabIds,
      detachedTabIds,
      attachedTabParentIds,
    }));
    const activeTabId = tabs.find((tab) => tab.active)?.id;
    if (
      isTreeEnabled() &&
      activeTabId !== undefined &&
      activeTabId !== lastScrolledActiveTabId
    ) {
      lastScrolledActiveTabId = activeTabId;
      queueMicrotask(() => {
        if (!active) return;
        elements.list.querySelector<HTMLElement>('[data-active="true"]')
          ?.scrollIntoView?.({ block: "nearest" });
      });
    } else if (!isTreeEnabled()) {
      lastScrolledActiveTabId = undefined;
    }
    elements.locateActiveTab.disabled = !tabsReady || !tabs.some((tab) => tab.active);
  };

  const onLocateActiveTabClick = (): void => {
    const activeTab = tabStore.list().find((tab) => tab.active);
    if (!activeTab) return;
    let row = findTabRow(elements.list, activeTab.id);
    if (!row && isTreeEnabled()) {
      let expanded = false;
      for (const ancestorId of getTabTreeAncestorIds(
        tabStore.list(),
        activeTab.id,
        detachedTabIds,
        attachedTabParentIds,
      )) {
        expanded = collapsedTabIds.delete(ancestorId) || expanded;
      }
      if (expanded) {
        renderTabList();
        persistTreeSession();
        row = findTabRow(elements.list, activeTab.id);
      }
    }
    if (!row) return;
    row.scrollIntoView?.({ block: "center", inline: "nearest" });
    row.querySelector<HTMLButtonElement>(".tab-main")?.focus({ preventScroll: true });
  };

  const saveTreeSession = (): Promise<void> => {
    if (!isTreeEnabled() || currentWindowId === undefined) return Promise.resolve();
    return treeSessionStore.save(
      currentWindowId,
      { collapsedTabIds, detachedTabIds, attachedTabParentIds },
    );
  };

  const restoreTreeSessionAfterFailure = async (
    windowId: number,
    revision: number,
    error: unknown,
  ): Promise<boolean> => {
    if (!active || currentWindowId !== windowId || treeSessionRevision !== revision) {
      return false;
    }
    const stored = await treeSessionStore.load(windowId);
    if (!active || currentWindowId !== windowId || treeSessionRevision !== revision) {
      return false;
    }
    treeSessionRevision += 1;
    collapsedTabIds.clear();
    detachedTabIds.clear();
    attachedTabParentIds.clear();
    for (const id of stored.collapsedTabIds) collapsedTabIds.add(id);
    for (const id of stored.detachedTabIds) detachedTabIds.add(id);
    for (const [childId, parentId] of stored.attachedTabParentIds) {
      attachedTabParentIds.set(childId, parentId);
    }
    treeRelationRevision += 1;
    renderTabList();
    setStatus(
      "operation",
      error instanceof Error ? error.message : "无法保存标签树状态",
    );
    void resyncTabsAndGroups();
    return true;
  };

  const persistTreeSession = (): void => {
    const windowId = currentWindowId;
    const revision = ++treeSessionRevision;
    void saveTreeSession().catch(async (error: unknown) => {
      if (windowId === undefined) return;
      await restoreTreeSessionAfterFailure(windowId, revision, error);
    });
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
      contentTreeEnabled: elements.contentTreeEnabled,
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
        if (saved.contentTreeEnabled !== shortcutSettings.contentTreeEnabled) {
          treeModeGeneration += 1;
          treeSessionRevision += 1;
        }
        if (!saved.contentTreeEnabled) {
          const hadTreeRelations = detachedTabIds.size > 0
            || attachedTabParentIds.size > 0;
          collapsedTabIds.clear();
          detachedTabIds.clear();
          attachedTabParentIds.clear();
          if (hadTreeRelations) treeRelationRevision += 1;
          if (currentWindowId !== undefined) {
            void treeSessionStore.clear(currentWindowId).catch(() => undefined);
          }
        }
        shortcutSettings = saved;
        renderTabList();
        updateDragEnabled();
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

  /**
   * 连接角色保存与 Chrome 事件：普通事件需完整成员证据，完整快照只需确认组仍存在。
   * 这样既不依赖事件先于保存，也不会用本地推测冒充可规划的权威 Store 状态。
   */
  const reconcileOtherGroupConfirmation = (authoritative: boolean): void => {
    const confirmation = otherGroupConfirmation;
    if (!confirmation || currentWindowId !== confirmation.windowId) return;
    const group = groupStore.get(confirmation.groupId);
    if (
      group?.windowId === confirmation.windowId
      && (authoritative || confirmation.tabIds.every((tabId) =>
        tabStore.get(tabId)?.groupId === confirmation.groupId))
    ) {
      otherGroupConfirmation = undefined;
      return;
    }
    if (!authoritative || group?.windowId === confirmation.windowId) return;

    otherGroupConfirmation = undefined;
    otherGroupId = undefined;
    roleRevision += 1;
    void smartGroupSessionStore.clearOtherGroup(confirmation.windowId).catch(() => undefined);
  };

  const resyncTabsAndGroups = (reportInitialGroupFailure = false): Promise<void> => {
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
      let shouldReportGroupFailure = reportInitialGroupFailure;
      try {
        do {
          resyncFollowUpRequested = false;
          groupingSnapshotsReady = false;
          resyncPhase = "querying";
          bufferingEvents = true;
          const tabsSnapshot = Promise.resolve().then(() =>
            deps.tabs.query({ windowId }));
          const groupsSnapshot = Promise.resolve().then(() =>
            deps.tabGroups.query({ windowId }));
          const [tabsResult, groupsResult] = await Promise.allSettled([
            tabsSnapshot,
            groupsSnapshot,
          ]);
          if (!active || currentWindowId !== windowId) break;
          let snapshotApplied = false;
          if (tabsResult.status === "fulfilled") {
            tabStore.initialize(tabsResult.value);
            snapshotApplied = true;
          }
          if (groupsResult.status === "fulfilled") {
            groupStore.initialize(groupsResult.value, windowId);
            groupsReady = true;
            setStatus("groups", "");
            snapshotApplied = true;
          } else if (shouldReportGroupFailure) {
            setStatus("groups", "无法读取当前窗口的标签分组");
          }
          shouldReportGroupFailure = false;
          if (!active || currentWindowId !== windowId) break;
          resyncPhase = "replaying";
          const replayed = await finishBufferedEvents();
          if (!active || currentWindowId !== windowId) break;
          groupingSnapshotsReady = tabsResult.status === "fulfilled" && groupsReady;
          if (tabsResult.status === "fulfilled" && groupsResult.status === "fulfilled") {
            reconcileOtherGroupConfirmation(true);
          }
          validateStoredOtherGroup();
          if (snapshotApplied || replayed) {
            syncShortcutFavicons();
            renderTabList();
          }
        } while (resyncFollowUpRequested);
      } catch {
        // Reconciliation is best-effort and must not escape fire-and-forget callers.
      } finally {
        if (active && bufferingEvents) {
          bufferingEvents = false;
          bufferedEvents.length = 0;
          discardPendingAsyncEvents();
        }
        resyncPhase = "idle";
        resyncFollowUpRequested = false;
        if (resyncPromise === operation) resyncPromise = undefined;
      }
    })();
    resyncPromise = operation;
    return operation;
  };

  const runGroupOperation = (tabId: number, start: () => Promise<void>): void => {
    if (smartGroupingBusy || groupTabBusy.has(tabId)) return;
    groupTabBusy.add(tabId);
    runTabOperation(
      start(),
      () => groupTabBusy.delete(tabId),
      () => { void resyncTabsAndGroups(); },
    );
  };

  const groupHasSmartGroupingConflict = (groupId: number): boolean =>
    smartGroupingGroupIds.has(groupId)
    || tabStore.list().some((tab) =>
      tab.groupId === groupId && smartGroupingTabIds.has(tab.id));

  const planHasOrdinaryGroupConflict = (plan: SmartGroupPlan): boolean =>
    planHasBusyTabs(plan, groupTabBusy)
    || plan.operations.some((operation) => {
      if (
        operation.kind === "reuse"
        && (groupCommandBusy.has(operation.groupId) || groupToggleBusy.has(operation.groupId))
      ) return true;
      return operation.tabIds.some((operationTabId) => {
        const tab = tabStore.get(operationTabId);
        return tab !== undefined && tab.groupId >= 0 && (
          groupCommandBusy.has(tab.groupId) || groupToggleBusy.has(tab.groupId)
        );
      });
    });

  const getValidOtherGroupId = (): number | undefined => {
    if (otherGroupId === undefined) return undefined;
    if (otherGroupConfirmation?.groupId === otherGroupId) return undefined;
    const group = groupStore.get(otherGroupId);
    if (group?.windowId === currentWindowId) return otherGroupId;

    const staleWindowId = currentWindowId;
    const staleRevision = ++roleRevision;
    otherGroupId = undefined;
    if (staleWindowId !== undefined) {
      void smartGroupSessionStore.clearOtherGroup(staleWindowId).catch(() => undefined).then(() => {
        if (!active || currentWindowId !== staleWindowId || roleRevision !== staleRevision) return;
      });
    }
    return undefined;
  };

  const isSmartGroupingReady = (): boolean =>
    groupingSnapshotsReady && smartGroupRoleReady && otherGroupConfirmation === undefined;

  const validateStoredOtherGroup = (): void => {
    if (isSmartGroupingReady()) getValidOtherGroupId();
  };

  /**
   * 从最新 Store 重新规划，并在调用 Chrome 前同步占用计划涉及的 tab/group 资源。
   * executor 每步通过 O(1) Store 读取重验语义，完成后统一释放资源锁。
   */
  const runSmartGrouping = (kind: "quick" | "all", tabId: number): void => {
    if (!isSmartGroupingReady() || smartGroupingBusy) return;
    const tabs = tabStore.list();
    if (!tabs.some((tab) => tab.id === tabId)) return;
    const groups = toSmartGroupSnapshot(groupStore.list());
    const validOtherGroupId = getValidOtherGroupId();
    const plan = kind === "quick"
      ? createQuickGroupPlan(tabs, groups, tabId)
      : createOneClickGroupPlan(tabs, groups, validOtherGroupId);
    if (!plan || planHasOrdinaryGroupConflict(plan)) return;

    smartGroupingBusy = true;
    for (const operation of plan.operations) {
      for (const operationTabId of operation.tabIds) {
        smartGroupingTabIds.add(operationTabId);
      }
      if (operation.kind === "reuse") smartGroupingGroupIds.add(operation.groupId);
    }
    const generation = ++smartGroupingGeneration;
    const expectedCategories = new Map<number, string>();
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
    for (const operation of plan.operations) {
      for (const operationTabId of operation.tabIds) {
        const operationTab = tabsById.get(operationTabId);
        const category = operationTab && classifySmartGroupTab(operationTab);
        if (category) expectedCategories.set(operationTabId, category.key);
      }
    }
    void executeSmartGroupPlan(plan, {
      tabs: deps.tabs,
      tabGroups: deps.tabGroups,
      validate(operation) {
        if (!active || generation !== smartGroupingGeneration) return false;
        const target = kind === "quick"
          ? tabStore.get(tabId)
          : undefined;
        if (kind === "quick" && (!target || target.windowId !== plan.windowId)) return false;
        if (operation.kind === "reuse") {
          const group = groupStore.get(operation.groupId);
          if (group?.windowId !== plan.windowId) return false;
        }
        return operation.tabIds.every((operationTabId) => {
          const tab = tabStore.get(operationTabId);
          if (!tab || tab.windowId !== plan.windowId || tab.pinned) return false;
          const category = classifySmartGroupTab(tab);
          if (category?.key !== expectedCategories.get(operationTabId)) return false;
          return kind === "all"
            ? tab.groupId === TAB_GROUP_ID_NONE
            : operation.kind !== "reuse" || tab.groupId !== operation.groupId;
        });
      },
      async onOtherGroupCreated(groupId) {
        const windowId = currentWindowId;
        const token = ++roleRevision;
        const operation = plan.operations.find((candidate) =>
          candidate.kind === "create" && candidate.role === "other");
        if (!active || windowId !== plan.windowId || generation !== smartGroupingGeneration) {
          throw new Error("智能分组会话已失效");
        }
        if (!operation || operation.kind !== "create") {
          throw new Error("Other 分组计划已失效");
        }
        pendingOtherGroup = { groupId, token };
        try {
          await smartGroupSessionStore.saveOtherGroup(windowId, groupId);
          if (
            !active
            || currentWindowId !== windowId
            || generation !== smartGroupingGeneration
            || roleRevision !== token
          ) {
            await (
              pendingOtherGroup?.clear
              ?? smartGroupSessionStore.clearOtherGroup(windowId)
            );
            throw new Error("Other 分组角色已失效");
          }
          otherGroupId = groupId;
          otherGroupConfirmation = {
            groupId,
            windowId,
            tabIds: operation.tabIds,
          };
          reconcileOtherGroupConfirmation(false);
          roleRevision += 1;
        } finally {
          if (pendingOtherGroup?.token === token) pendingOtherGroup = undefined;
        }
      },
    }).then(
      () => {
        if (active && generation === smartGroupingGeneration) setStatus("operation", "");
      },
      (error: unknown) => {
        if (!active || generation !== smartGroupingGeneration) return;
        const partial = error instanceof SmartGroupExecutionError && error.partial;
        setStatus(
          "operation",
          kind === "quick"
            ? "同网站快速分组失败"
            : partial ? "一键分组部分失败" : "一键分组失败",
        );
        void resyncTabsAndGroups();
      },
    ).finally(() => {
      if (generation === smartGroupingGeneration) {
        smartGroupingTabIds.clear();
        smartGroupingGroupIds.clear();
        if (active) smartGroupingBusy = false;
      }
    });
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
      shortcutSettings = saved;
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
    const dragInteractionsReady = shortcutSettingsReady && (
      !shortcutSettings.contentTreeEnabled || treeSessionReady
    );
    tabRenderer.setDragEnabled(dragInteractionsReady);
    if (dragInteractionsReady) tabRenderer.setTabDragEnabled(!reorderBusy);
  };

  const updateNewTabEnabled = (): void => {
    elements.newTabButton.disabled = !shortcutSettingsReady || !tabsReady;
  };

  let groupContextMenu: ReturnType<typeof createTabGroupContextMenu> | undefined;
  let dragController: ReturnType<typeof createTabDragController>;
  const contextMenu = createTabContextMenu(
    { document: deps.document, list: elements.list, viewport: deps.document.defaultView! },
    {
      getContext(id) {
        const tabs = tabStore.list();
        const tab = tabs.find((candidate) => candidate.id === id);
        if (!tab) return undefined;
        const groups = toSmartGroupSnapshot(groupStore.list());
        const ready = isSmartGroupingReady();
        const busy = smartGroupingBusy;
        const quickPlan = createQuickGroupPlan(tabs, groups, id);
        const allPlan = createOneClickGroupPlan(tabs, groups, getValidOtherGroupId());
        const subtreeIds = isTreeEnabled()
          ? getTabSubtreeIds(tabs, id, detachedTabIds, attachedTabParentIds)
          : [];
        return {
          tab,
          canDuplicate: !shortcutSettings.contentTreeEnabled || treeSessionReady,
          canCloseBelow: getClosableTabsBelow(tabs, id).length > 0,
          canCloseAbove: getClosableTabsAbove(tabs, id).length > 0,
          canOpenAllShortcuts: shortcutSettingsReady
            && shortcutSettings.enabled
            && getShortcutUrlsToOpen(shortcutSettings.items, tabs).length > 0,
          canQuickGroupSameSite: ready && !busy
            && quickPlan !== undefined
            && !planHasOrdinaryGroupConflict(quickPlan),
          canGroupAll: ready && !busy
            && allPlan !== undefined
            && !planHasOrdinaryGroupConflict(allPlan),
          canCloseOtherSameSite: getOtherSameSiteTabIds(tabs, id).length > 0,
          canDissolveTree: subtreeIds.length > 1,
          canDeleteSubtree: subtreeIds.length > 1,
        };
      },
      getGroups: () => groupStore.list(),
      getRecentlyClosedSessionId: () => recentlyClosed.getSessionId(),
      onBeforeOpen: () => groupContextMenu?.close(),
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
        if (command.action === "dissolve-tree") {
          if (!isTreeEnabled()) return;
          const subtreeIds = getTabSubtreeIds(
            tabStore.list(),
            command.tabId,
            detachedTabIds,
            attachedTabParentIds,
          );
          if (subtreeIds.length <= 1) return;
          for (const tabId of subtreeIds) {
            collapsedTabIds.delete(tabId);
            attachedTabParentIds.delete(tabId);
            detachedTabIds.add(tabId);
          }
          treeRelationRevision += 1;
          renderTabList();
          persistTreeSession();
          return;
        }
        if (command.action === "delete-subtree") {
          if (!isTreeEnabled()) return;
          const subtreeIds = getTabSubtreeIds(
            tabStore.list(),
            command.tabId,
            detachedTabIds,
            attachedTabParentIds,
          );
          if (subtreeIds.length <= 1) return;
          runTabOperation(tabActions.closeSubtree(subtreeIds));
          return;
        }
        if (command.action === "close-above") {
          const tabIds = getClosableTabsAbove(tabStore.list(), command.tabId);
          runTabOperation(tabActions.closeAbove(tabIds));
          return;
        }
        if (command.action === "open-all-shortcuts") {
          if (!shortcutSettingsReady || !shortcutSettings.enabled) return;
          const urls = getShortcutUrlsToOpen(shortcutSettings.items, tabStore.list());
          runTabOperation(shortcutActions.openMany(urls));
          return;
        }
        if (command.action === "close-same-site") {
          const tabIds = getOtherSameSiteTabIds(tabStore.list(), command.tabId);
          runTabOperation(tabActions.closeOtherSameSite(tabIds));
          return;
        }
        if (command.action === "group-same-site") {
          runSmartGrouping("quick", command.tabId);
          return;
        }
        if (command.action === "group-all") {
          runSmartGrouping("all", command.tabId);
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
          if (shortcutSettings.contentTreeEnabled && !treeSessionReady) return;
          runTabOperation(tabActions.duplicate(command.tabId).then((duplicatedTabId) => {
            if (
              duplicatedTabId !== undefined &&
              isTreeEnabled()
            ) {
              detachedTabIds.add(duplicatedTabId);
              attachedTabParentIds.delete(duplicatedTabId);
              treeRelationRevision += 1;
              persistTreeSession();
              renderTabList();
            }
          }));
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

  const executeGroupCommand = async (
    groupId: number,
    start: () => Promise<void>,
    moveGroupId?: number,
  ): Promise<void> => {
    if (
      !active
      || groupCommandBusy.has(groupId)
      || groupToggleBusy.has(groupId)
      || groupHasSmartGroupingConflict(groupId)
    ) return;
    dragController?.cancelForGroup(groupId);
    groupCommandBusy.add(groupId);
    const generation = ++operationGeneration;
    let completedByEvent = false;
    try {
      await start();
      if (
        active
        && generation === operationGeneration
        && !(groupMovesCompletedByEvent.get(groupId) ?? 0)
      ) setStatus("operation", "");
      const completed = groupMovesCompletedByEvent.get(groupId) ?? 0;
      completedByEvent = completed > 0;
      if (completedByEvent) groupMovesCompletedByEvent.set(groupId, completed - 1);
    } catch (error) {
      if (active) {
        const completed = groupMovesCompletedByEvent.get(groupId) ?? 0;
        completedByEvent = completed > 0;
        if (completedByEvent) groupMovesCompletedByEvent.set(groupId, completed - 1);
        if (generation === operationGeneration && !completedByEvent) {
          setStatus(
            "operation",
            error instanceof Error ? error.message : "标签组操作失败",
          );
        }
        if (!completedByEvent) void resyncTabsAndGroups();
      }
      throw error;
    } finally {
      if (moveGroupId !== undefined && !completedByEvent) {
        const pending = pendingGroupMoves.get(moveGroupId) ?? 0;
        if (pending <= 1) pendingGroupMoves.delete(moveGroupId);
        else pendingGroupMoves.set(moveGroupId, pending - 1);
      }
      if (!(pendingGroupMoves.get(groupId) ?? 0)) groupCommandBusy.delete(groupId);
      dragController?.cancelForGroup(groupId);
    }
  };

  const groupRenameDialog = createTabGroupRenameDialog(
    {
      dialog: elements.groupRenameDialog,
      form: elements.groupRenameForm,
      name: elements.groupRenameName,
      error: elements.groupRenameError,
      cancel: elements.groupRenameCancel,
      save: elements.groupRenameSave,
    },
    {
      async onSave({ groupId, title }) {
        if (!groupStore.get(groupId)) return;
        if (
          groupCommandBusy.has(groupId)
          || groupToggleBusy.has(groupId)
          || groupHasSmartGroupingConflict(groupId)
        ) {
          throw new Error("标签组操作正在进行");
        }
        await executeGroupCommand(groupId, () => groupActions.rename(groupId, title));
      },
    },
  );

  groupContextMenu = createTabGroupContextMenu(
    { document: deps.document, list: elements.list, viewport: deps.document.defaultView! },
    {
      getGroup: (groupId) => groupStore.get(groupId),
      isGroupBusy: (groupId) =>
        groupCommandBusy.has(groupId)
        || groupToggleBusy.has(groupId)
        || groupHasSmartGroupingConflict(groupId),
      onBeforeOpen: () => contextMenu.close(),
      onCommand(command) {
        const group = groupStore.get(command.groupId);
        if (!group) return;
        if (command.action === "rename") {
          groupRenameDialog.open(group.id, group.title);
          return;
        }
        if (command.action === "new-tab") {
          const members = tabStore.list().filter((tab) => tab.groupId === group.id);
          if (members.length === 0) return;
          const index = Math.max(...members.map((tab) => tab.index)) + 1;
          void executeGroupCommand(group.id, () => groupActions.createTabInGroup({
            groupId: group.id,
            windowId: group.windowId,
            index,
          })).catch(() => undefined);
          return;
        }
        if (command.action === "set-color") {
          if (group.color === command.color) return;
          void executeGroupCommand(group.id, () =>
            groupActions.setColor(group.id, command.color)).catch(() => undefined);
          return;
        }
        const tabIds = tabStore.list()
          .filter((tab) => tab.groupId === group.id)
          .map((tab) => tab.id);
        if (tabIds.length === 0) return;
        void executeGroupCommand(group.id, () => groupActions.dissolve(tabIds))
          .catch(() => undefined);
      },
    },
  );

  dragController = createTabDragController(
    { list: elements.list, viewport: deps.document.defaultView! },
    {
      canStartGroupDrag: (groupId) =>
        shortcutSettingsReady
        && (!shortcutSettings.contentTreeEnabled || treeSessionReady)
        && Boolean(groupStore.get(groupId))
        && !groupCommandBusy.has(groupId)
        && !groupToggleBusy.has(groupId)
        && !groupHasSmartGroupingConflict(groupId),
      prepareTabDrag: (sourceId) => {
        if (!isTreeEnabled()) return resolveFlatTabDrop;
        const tabs = tabStore.list();
        const source = tabs.find((tab) => tab.id === sourceId);
        if (!source || source.pinned || source.groupId >= 0) return resolveFlatTabDrop;
        return createTabTreeDropResolver(
          tabs,
          sourceId,
          collapsedTabIds,
          detachedTabIds,
          attachedTabParentIds,
        );
      },
      canDropTab: (sourceId, target) => {
        const latestTabs = tabStore.list();
        const source = latestTabs.find((tab) => tab.id === sourceId);
        if (!source) return false;
        if (target.kind === "group") return Boolean(groupStore.get(target.groupId));
        if (!isTreeEnabled() || source.pinned || source.groupId >= 0) {
          if (target.tree !== undefined) return false;
          return target.kind === "end"
            || latestTabs.some((tab) => tab.id === target.tabId);
        }
        const request = requestFromResolvedTarget(target);
        if (!request) return false;
        const latestTarget = createTabTreeDropResolver(
          latestTabs,
          sourceId,
          collapsedTabIds,
          detachedTabIds,
          attachedTabParentIds,
        )(request);
        return latestTarget !== undefined && sameResolvedTabTarget(latestTarget, target);
      },
      onDrop(intent: TabDragIntent) {
        if (intent.kind === "group") {
          const groupId = intent.sourceGroupId;
          if (
            groupCommandBusy.has(groupId)
            || groupToggleBusy.has(groupId)
            || groupHasSmartGroupingConflict(groupId)
          ) return;
          const plan = createTabGroupReorderPlan(
            tabStore.list(),
            groupStore.list(),
            groupId,
            intent.target,
          );
          if (!plan) return;
          pendingGroupMoves.set(groupId, (pendingGroupMoves.get(groupId) ?? 0) + 1);
          void executeGroupCommand(groupId, () => groupActions.move(plan), groupId)
            .catch(() => undefined);
          return;
        }
        if (reorderBusy) return;
        const tabs = tabStore.list();
        const sourceIds = isTreeEnabled()
          ? getTabSubtreeIds(
            tabs, intent.sourceId, detachedTabIds, attachedTabParentIds,
          )
          : [intent.sourceId];
        const currentParentId = isTreeEnabled()
          ? getTabTreeParentId(
            tabs,
            intent.sourceId,
            detachedTabIds,
            attachedTabParentIds,
          )
          : undefined;
        const treePlacement = intent.target.kind !== "group"
          ? intent.target.tree
          : undefined;
        const movesToNativeGroup = intent.target.kind === "group";
        const hasExplicitTreePlacement = isTreeEnabled()
          && (treePlacement !== undefined || movesToNativeGroup);
        const attachmentParentId = treePlacement?.parentId;
        const blockPlan = sourceIds.length > 1
          ? createTabBlockReorderPlan(tabs, sourceIds, intent.target)
          : undefined;
        const plan = createTabReorderPlan(
          tabs, intent.sourceId, intent.target,
        );
        const shouldDetach = hasExplicitTreePlacement
          && attachmentParentId === undefined
          && currentParentId !== undefined;
        const shouldAttach = hasExplicitTreePlacement
          && attachmentParentId !== undefined
          && attachmentParentId !== currentParentId;
        const shouldExpandParent = treePlacement?.relation === "child"
          && attachmentParentId !== undefined
          && collapsedTabIds.has(attachmentParentId);
        const preparedTreeModeGeneration = treeModeGeneration;
        const preparedTreeRelationRevision = treeRelationRevision;
        const applyTreeMutation = async (): Promise<void> => {
          if (
            !isTreeEnabled()
            || treeModeGeneration !== preparedTreeModeGeneration
            || treeRelationRevision !== preparedTreeRelationRevision
          ) return;
          const latestTabs = tabStore.list();
          const latestSource = latestTabs.find((tab) => tab.id === intent.sourceId);
          const latestParent = attachmentParentId === undefined
            ? undefined
            : latestTabs.find((tab) => tab.id === attachmentParentId);
          if (
            !latestSource
            || latestSource.pinned
            || (!movesToNativeGroup && latestSource.groupId >= 0)
          ) {
            await resyncTabsAndGroups();
            return;
          }
          const invalidAttachment = shouldAttach && (
            !latestParent
            || latestSource.windowId !== latestParent.windowId
            || latestParent.pinned
            || latestParent.groupId >= 0
            || getTabSubtreeIds(
              latestTabs,
              intent.sourceId,
              detachedTabIds,
              attachedTabParentIds,
            ).includes(attachmentParentId!)
          );
          if (invalidAttachment) {
            await resyncTabsAndGroups();
            return;
          }
          if (shouldAttach && attachmentParentId !== undefined) {
            attachedTabParentIds.set(intent.sourceId, attachmentParentId);
            detachedTabIds.delete(intent.sourceId);
            treeRelationRevision += 1;
          } else if (shouldDetach) {
            attachedTabParentIds.delete(intent.sourceId);
            detachedTabIds.add(intent.sourceId);
            treeRelationRevision += 1;
          }
          if (shouldExpandParent && attachmentParentId !== undefined) {
            collapsedTabIds.delete(attachmentParentId);
          }
          const windowId = currentWindowId;
          const revision = ++treeSessionRevision;
          try {
            await saveTreeSession();
            renderTabList();
          } catch (error) {
            if (
              windowId !== undefined
              && await restoreTreeSessionAfterFailure(windowId, revision, error)
            ) throw error;
          }
        };
        const hasTreeMutation = shouldAttach || shouldDetach || shouldExpandParent;
        if (!plan) {
          if (hasTreeMutation) {
            runTabOperation(
              applyTreeMutation(),
              undefined,
              () => { void resyncTabsAndGroups(); },
            );
          }
          return;
        }
        if (sourceIds.length > 1 && !blockPlan) return;
        reorderBusy = true;
        updateDragEnabled();
        const reorderOperation = blockPlan
          ? tabActions.reorderMany(blockPlan)
          : tabActions.reorder(plan);
        runTabOperation(
          hasTreeMutation
            ? reorderOperation.then(applyTreeMutation)
            : reorderOperation,
          () => {
            if (!active) return;
            reorderBusy = false;
            updateDragEnabled();
          },
          () => { void resyncTabsAndGroups(); },
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
    const openerTabId = shortcutSettings.contentTreeEnabled
      ? tabStore.list().find((tab) => tab.active)?.id
      : undefined;
    runTabOperation(tabActions.create(openerTabId), () => {
      if (active) elements.newTabButton.disabled = false;
    });
  };

  const onTabScroll = (): void => {
    contextMenu.close();
    groupContextMenu?.close();
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
    smartGroupingGeneration += 1;
    roleRevision += 1;
    pendingGroupMoves.clear();
    groupMovesCompletedByEvent.clear();
    unsubscribeTabs();
    unsubscribeGroups();
    bufferingEvents = false;
    bufferedEvents.length = 0;
    discardPendingAsyncEvents();
    elements.list.removeEventListener("click", onListClick);
    elements.list.removeEventListener("keydown", onListKeyDown);
    elements.newTabButton.removeEventListener("click", onNewTabClick);
    elements.locateActiveTab.removeEventListener("click", onLocateActiveTabClick);
    elements.tabScroll.removeEventListener("scroll", onTabScroll);
    elements.settingsButton.removeEventListener("click", onSettingsClick);
    elements.chromeAppearanceSettings.removeEventListener(
      "click",
      onChromeAppearanceSettingsClick,
    );
    elements.settingsButton.removeEventListener("click", blockPendingSettings, true);
    contextMenu.destroy();
    groupContextMenu?.destroy();
    groupContextMenu = undefined;
    recentlyClosed.destroy();
    groupDialog.close();
    groupDialog.destroy();
    groupRenameDialog.close();
    groupRenameDialog.destroy();
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
      if (
        !group ||
        groupToggleBusy.has(group.id) ||
        groupCommandBusy.has(group.id) ||
        groupHasSmartGroupingConflict(group.id)
      ) return;
      groupToggleBusy.add(group.id);
      dragController?.cancelForGroup(group.id);
      runTabOperation(
        groupActions.setCollapsed(group.id, !group.collapsed),
        () => {
          groupToggleBusy.delete(group.id);
          dragController?.cancelForGroup(group.id);
        },
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
    if (action === "toggle-tree") {
      if (collapsedTabIds.has(tabId)) collapsedTabIds.delete(tabId);
      else collapsedTabIds.add(tabId);
      renderTabList();
      persistTreeSession();
      return;
    }
    const operation = action === "activate"
      ? tabActions.activate(tabId)
      : action === "close"
        ? tabActions.close(tabId)
        : undefined;
    if (operation) {
      runTabOperation(operation);
    }
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const main = target.closest<HTMLElement>("[data-action='activate']");
    const row = main?.closest<HTMLElement>("[data-tab-id][data-tree-parent='true']");
    if (!main || !row || !elements.list.contains(row)) return;
    const tabId = Number(row.dataset.tabId);
    if (!Number.isSafeInteger(tabId)) return;
    const shouldCollapse = event.key === "ArrowLeft";
    if (shouldCollapse === collapsedTabIds.has(tabId)) return;
    event.preventDefault();
    if (shouldCollapse) collapsedTabIds.add(tabId);
    else collapsedTabIds.delete(tabId);
    renderTabList();
    persistTreeSession();
    row.querySelector<HTMLButtonElement>(".tab-main")?.focus();
  };

  elements.list.addEventListener("click", onListClick);
  elements.list.addEventListener("keydown", onListKeyDown);
  elements.newTabButton.addEventListener("click", onNewTabClick);
  elements.locateActiveTab.addEventListener("click", onLocateActiveTabClick);
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
        collapsedTabIds.delete(tabId);
        let relationChanged = detachedTabIds.delete(tabId);
        relationChanged = attachedTabParentIds.delete(tabId) || relationChanged;
        for (const [childId, parentId] of attachedTabParentIds) {
          if (parentId === tabId) {
            relationChanged = attachedTabParentIds.delete(childId) || relationChanged;
          }
        }
        if (relationChanged) treeRelationRevision += 1;
        persistTreeSession();
      },
      renderTabList,
      true,
    );
  };

  const replaceTab = (tab: chrome.tabs.Tab, removedTabId: number): void => {
    contextMenu.closeForTab(removedTabId);
    tabStore.replaceId(removedTabId, tab);
    if (tab.id === undefined) return;
    replacementTabIds.set(removedTabId, tab.id);
    if (collapsedTabIds.delete(removedTabId)) collapsedTabIds.add(tab.id);
    let relationChanged = detachedTabIds.delete(removedTabId);
    if (relationChanged) detachedTabIds.add(tab.id);
    const replacementParentId = attachedTabParentIds.get(removedTabId);
    if (replacementParentId !== undefined) {
      attachedTabParentIds.delete(removedTabId);
      attachedTabParentIds.set(tab.id, replacementParentId);
      relationChanged = true;
    }
    for (const [childId, parentId] of attachedTabParentIds) {
      if (parentId === removedTabId) {
        attachedTabParentIds.set(childId, tab.id);
        relationChanged = true;
      }
    }
    if (relationChanged) treeRelationRevision += 1;
    persistTreeSession();
  };

  const tabEventHandlers = {
    created(tab: chrome.tabs.Tab) {
      applyEvent(
        () => {
          tabStore.add(tab);
          reconcileOtherGroupConfirmation(false);
          if (isTreeEnabled() && tab.active && tab.id !== undefined) {
            let expanded = false;
            for (const ancestorId of getTabTreeAncestorIds(
              tabStore.list(),
              tab.id,
              detachedTabIds,
              attachedTabParentIds,
            )) {
              expanded = collapsedTabIds.delete(ancestorId) || expanded;
            }
            if (expanded) persistTreeSession();
          }
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
      applyEvent(
        () => {
          replaceTab(tab, removedTabId);
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
          reconcileOtherGroupConfirmation(false);
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
          reconcileOtherGroupConfirmation(false);
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
          reconcileOtherGroupConfirmation(false);
        },
        () => {
          if (!model) return;
          if (
            !previous ||
            previous.collapsed !== model.collapsed ||
            previous.color !== model.color
          ) {
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
          const pending = pendingGroupMoves.get(group.id) ?? 0;
          if (pending > 0) {
            if (pending === 1) pendingGroupMoves.delete(group.id);
            else pendingGroupMoves.set(group.id, pending - 1);
            groupCommandBusy.delete(group.id);
            groupMovesCompletedByEvent.set(
              group.id,
              (groupMovesCompletedByEvent.get(group.id) ?? 0) + 1,
            );
            dragController?.cancelForGroup(group.id);
          }
        },
        renderTabList,
      );
    },
    removed(groupId: number) {
      groupContextMenu?.closeForGroup(groupId);
      groupRenameDialog.closeForGroup(groupId);
      dragController?.cancelForGroup(groupId);
      if (
        groupId === otherGroupId
        || groupId === pendingOtherGroup?.groupId
        || groupId === otherGroupConfirmation?.groupId
      ) {
        const windowId = currentWindowId;
        otherGroupId = undefined;
        if (otherGroupConfirmation?.groupId === groupId) otherGroupConfirmation = undefined;
        roleRevision += 1;
        if (windowId !== undefined) {
          const clear = smartGroupSessionStore.clearOtherGroup(windowId);
          if (groupId === pendingOtherGroup?.groupId) pendingOtherGroup.clear = clear;
          void clear.catch(() => undefined);
        }
      }
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
                  replaceTab(tab, slot.removedTabId);
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
    shortcutSettings = settings;
    shortcutSettingsReady = true;
    elements.settingsButton.disabled = false;
    updateNewTabEnabled();
    updateDragEnabled();
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
  }).catch(() => {
    setStatus("shortcuts", "无法读取快捷网站设置");
  });

  try {
    const currentWindow = await deps.windows.getCurrent({ populate: true });
    if (!active) return cleanup;
    const windowId = currentWindow.id;
    if (typeof windowId !== "number" || !Number.isSafeInteger(windowId)) {
      throw new Error("当前窗口缺少有效 ID");
    }
    const tabs = Array.isArray(currentWindow.tabs)
      ? currentWindow.tabs
      : await deps.tabs.query({ windowId });
    if (!active) return cleanup;

    currentWindowId = windowId;
    const roleLoadRevision = roleRevision;
    void smartGroupSessionStore.load(windowId).then((state) => {
      if (!active || currentWindowId !== windowId || roleRevision !== roleLoadRevision) return;
      otherGroupId = state.otherGroupId;
      smartGroupRoleReady = true;
      validateStoredOtherGroup();
    });
    void Promise.all([
      loadShortcuts,
      treeSessionStore.load(windowId).catch(() => ({
        collapsedTabIds: new Set<number>(),
        detachedTabIds: new Set<number>(),
        attachedTabParentIds: new Map<number, number>(),
      })),
    ]).then(([, treeState]) => {
      if (!active || currentWindowId !== windowId) return;
      collapsedTabIds.clear();
      detachedTabIds.clear();
      attachedTabParentIds.clear();
      if (shortcutSettings.contentTreeEnabled) {
        copyMigratedIds(treeState.collapsedTabIds, collapsedTabIds, replacementTabIds);
        copyMigratedIds(treeState.detachedTabIds, detachedTabIds, replacementTabIds);
        copyMigratedParentIds(
          treeState.attachedTabParentIds,
          attachedTabParentIds,
          replacementTabIds,
        );
      } else {
        void treeSessionStore.clear(windowId).catch(() => undefined);
      }
      treeSessionReady = true;
      renderTabList();
      updateDragEnabled();
    });
    tabStore.initialize(tabs);
    tabsReady = true;
    updateNewTabEnabled();
    groupStore.initialize([], windowId);
    syncShortcutFavicons();
    renderTabList();
    deps.document.documentElement.dataset.ready = "true";

    bufferingEvents = true;
    unsubscribeTabs = subscribeWithBufferedAsyncEvents(windowId);
    unsubscribeGroups = subscribeToTabGroupEvents(
      deps.tabGroups,
      windowId,
      groupEventHandlers,
    );
    void resyncTabsAndGroups(true);
  } catch {
    if (active) {
      setStatus("tabs", "无法读取当前窗口的标签页");
    }
  }

  return cleanup;
}

function copyMigratedIds(
  source: ReadonlySet<number>,
  target: Set<number>,
  replacements: ReadonlyMap<number, number>,
): void {
  for (const sourceId of source) {
    target.add(getMigratedId(sourceId, replacements));
  }
}

function copyMigratedParentIds(
  source: ReadonlyMap<number, number>,
  target: Map<number, number>,
  replacements: ReadonlyMap<number, number>,
): void {
  for (const [childId, parentId] of source) {
    target.set(
      getMigratedId(childId, replacements),
      getMigratedId(parentId, replacements),
    );
  }
}

function getMigratedId(
  sourceId: number,
  replacements: ReadonlyMap<number, number>,
): number {
  let id = sourceId;
  const visited = new Set<number>();
  while (!visited.has(id)) {
    visited.add(id);
    const replacement = replacements.get(id);
    if (replacement === undefined) break;
    id = replacement;
  }
  return id;
}

function getSidebarElements(document: Document): SidebarElements {
  return {
    shortcutStrip: requireElement(document, "shortcut-strip", HTMLElement),
    locateActiveTab: requireElement(document, "locate-active-tab", HTMLButtonElement),
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
    contentTreeEnabled: requireElement(document, "content-tree-enabled", HTMLInputElement),
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
    groupRenameDialog: requireElement(
      document,
      "tab-group-rename-dialog",
      HTMLDialogElement,
    ),
    groupRenameForm: requireElement(document, "tab-group-rename-form", HTMLFormElement),
    groupRenameName: requireElement(document, "tab-group-rename-name", HTMLInputElement),
    groupRenameError: requireElement(document, "tab-group-rename-error", HTMLElement),
    groupRenameCancel: requireElement(
      document,
      "tab-group-rename-cancel",
      HTMLButtonElement,
    ),
    groupRenameSave: requireElement(
      document,
      "tab-group-rename-save",
      HTMLButtonElement,
    ),
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
    sessionStorage: chrome.storage.session,
    document,
  }, window);
}
