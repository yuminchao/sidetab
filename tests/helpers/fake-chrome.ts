import { vi } from "vitest";
import { FakeEvent } from "./fake-event";

type CreatedListener = (tab: chrome.tabs.Tab) => void;
type RemovedListener = (tabId: number, info: chrome.tabs.OnRemovedInfo) => void;
type UpdatedListener = (
  tabId: number,
  info: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
) => void;
type ActivatedListener = (info: chrome.tabs.OnActivatedInfo) => void;
type MovedListener = (tabId: number, info: chrome.tabs.OnMovedInfo) => void;
type AttachedListener = (tabId: number, info: chrome.tabs.OnAttachedInfo) => void;
type DetachedListener = (tabId: number, info: chrome.tabs.OnDetachedInfo) => void;
type ReplacedListener = (addedTabId: number, removedTabId: number) => void;
type TabGroupListener = (group: chrome.tabGroups.TabGroup) => void;
type SessionChangedListener = () => void;

export function fakeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "First tab",
    url: "https://first.example/",
    active: false,
    pinned: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

export function fakeGroup(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    id: 7,
    windowId: 10,
    title: "Work",
    color: "blue",
    collapsed: false,
    ...overrides,
  } as chrome.tabGroups.TabGroup;
}

export function createFakeChrome(options: {
  currentWindow?: chrome.windows.Window;
  tabs?: chrome.tabs.Tab[];
  groups?: chrome.tabGroups.TabGroup[];
  bookmarkItems?: chrome.bookmarks.BookmarkTreeNode[];
  historyItems?: chrome.history.HistoryItem[];
  recentlyClosedSessions?: chrome.sessions.Session[];
  stored?: Record<string, unknown>;
} = {}) {
  let tabState = (options.tabs ?? []).map((tab) => ({ ...tab }));
  let groupState = (options.groups ?? []).map((group) => ({ ...group }));
  let recentlyClosedState = (options.recentlyClosedSessions ?? []).map((session) => ({
    ...session,
  }));
  const events = {
    onCreated: new FakeEvent<CreatedListener>(),
    onRemoved: new FakeEvent<RemovedListener>(),
    onUpdated: new FakeEvent<UpdatedListener>(),
    onActivated: new FakeEvent<ActivatedListener>(),
    onMoved: new FakeEvent<MovedListener>(),
    onAttached: new FakeEvent<AttachedListener>(),
    onDetached: new FakeEvent<DetachedListener>(),
    onReplaced: new FakeEvent<ReplacedListener>(),
  };
  const groupEvents = {
    onCreated: new FakeEvent<TabGroupListener>(),
    onUpdated: new FakeEvent<TabGroupListener>(),
    onMoved: new FakeEvent<TabGroupListener>(),
    onRemoved: new FakeEvent<TabGroupListener>(),
  };
  const sessionEvents = {
    onChanged: new FakeEvent<SessionChangedListener>(),
  };
  const query = vi.fn(async () => tabState);
  const get = vi.fn(async (tabId: number) => {
    const tab = tabState.find((candidate) => candidate.id === tabId);
    if (!tab) throw new Error("tab not found");
    return tab;
  });
  const update = vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
    const index = tabState.findIndex((candidate) => candidate.id === tabId);
    const current = tabState[index];
    if (!current) throw new Error("tab not found");
    if (properties.active) {
      tabState = tabState.map((tab) =>
        tab.windowId === current.windowId ? { ...tab, active: false } : tab,
      );
    }
    const updated = { ...tabState[index], ...properties } as chrome.tabs.Tab;
    tabState[index] = updated;
    return updated;
  });
  const remove = vi.fn(async () => undefined);
  const duplicate = vi.fn(async (tabId: number) => fakeTab({ id: tabId + 1000 }));
  const move = vi.fn(async (tabId: number, moveProperties: chrome.tabs.MoveProperties) =>
    fakeTab({ id: tabId, index: moveProperties.index as number }),
  );
  let nextTabId = Math.max(998, ...tabState.map((tab) => tab.id ?? 0)) + 1;
  const create = vi.fn(async (properties: chrome.tabs.CreateProperties) => {
    const windowId = properties.windowId ?? options.currentWindow?.id ?? 10;
    const windowTabs = tabState.filter((tab) => tab.windowId === windowId);
    const requestedIndex = properties.index ?? windowTabs.length;
    const index = Math.max(0, Math.min(requestedIndex, windowTabs.length));
    const active = properties.active ?? true;
    if (active) {
      tabState = tabState.map((tab) =>
        tab.windowId === windowId ? { ...tab, active: false } : tab,
      );
    }
    tabState = tabState.map((tab) =>
      tab.windowId === windowId && tab.index >= index
        ? { ...tab, index: tab.index + 1 }
        : tab,
    );
    const created = fakeTab({
      id: nextTabId++,
      windowId,
      index,
      url: properties.url,
      active,
      pinned: properties.pinned ?? false,
      groupId: -1,
    });
    tabState.push(created);
    return created;
  });
  const removeEmptyGroups = (groupIds: ReadonlySet<number>): void => {
    groupState = groupState.filter((group) =>
      !groupIds.has(group.id) || tabState.some((tab) => tab.groupId === group.id),
    );
  };
  const groupTabs = vi.fn(async (properties: chrome.tabs.GroupOptions) => {
    const tabIds = Array.isArray(properties.tabIds)
      ? properties.tabIds
      : typeof properties.tabIds === "number"
        ? [properties.tabIds]
        : [];
    const oldGroupIds = new Set(tabState
      .filter((tab) => tab.id !== undefined && tabIds.includes(tab.id))
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is number => typeof groupId === "number" && groupId >= 0));
    let groupId = properties.groupId;
    if (groupId === undefined) {
      groupId = 777;
      while (groupState.some((group) => group.id === groupId)) {
        groupId += 1;
      }
      const firstTab = tabState.find((tab) => tab.id !== undefined && tabIds.includes(tab.id));
      groupState.push(fakeGroup({
        id: groupId,
        windowId: properties.createProperties?.windowId ?? firstTab?.windowId ?? 10,
        title: undefined,
        color: "grey",
        collapsed: false,
      }));
    }
    tabState = tabState.map((tab) =>
      tab.id !== undefined && tabIds.includes(tab.id) ? { ...tab, groupId } : tab,
    );
    removeEmptyGroups(oldGroupIds);
    return groupId;
  });
  const ungroup = vi.fn(async (tabIdsInput: number | [number, ...number[]]) => {
    const tabIds = Array.isArray(tabIdsInput) ? tabIdsInput : [tabIdsInput];
    const oldGroupIds = new Set(tabState
      .filter((tab) => tab.id !== undefined && tabIds.includes(tab.id))
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is number => typeof groupId === "number" && groupId >= 0));
    tabState = tabState.map((tab) =>
      tab.id !== undefined && tabIds.includes(tab.id) ? { ...tab, groupId: -1 } : tab,
    );
    removeEmptyGroups(oldGroupIds);
  });
  const groupQuery = vi.fn(async (queryInfo: chrome.tabGroups.QueryInfo) =>
    typeof queryInfo.windowId === "number"
      ? groupState.filter((group) => group.windowId === queryInfo.windowId)
      : groupState,
  );
  const groupGet = vi.fn(async (groupId: number) => {
    const group = groupState.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error("group not found");
    return group;
  });
  const groupUpdate = vi.fn(async (
    groupId: number,
    properties: chrome.tabGroups.UpdateProperties,
  ) => {
    const index = groupState.findIndex((candidate) => candidate.id === groupId);
    const group = groupState[index];
    if (!group) return undefined;
    const updated = { ...group, ...properties };
    groupState[index] = updated;
    return updated;
  });
  const groupMove = vi.fn(async (
    groupId: number,
    properties: chrome.tabGroups.MoveProperties,
  ) => {
    const groupIndex = groupState.findIndex((group) => group.id === groupId);
    const group = groupState[groupIndex];
    if (!group) throw new Error("group not found");
    const members = tabState
      .filter((tab) => tab.groupId === groupId)
      .sort((left, right) => left.index - right.index);
    if (members.length === 0) return group;
    const destinationWindowId = properties.windowId ?? group.windowId;
    const destinationTabs = tabState
      .filter((tab) => tab.windowId === destinationWindowId && tab.groupId !== groupId)
      .sort((left, right) => left.index - right.index);
    const insertionIndex = Math.max(0, Math.min(properties.index, destinationTabs.length));
    const ordered = [
      ...destinationTabs.slice(0, insertionIndex),
      ...members.map((tab) => ({ ...tab, windowId: destinationWindowId })),
      ...destinationTabs.slice(insertionIndex),
    ];
    const otherTabs = tabState.filter(
      (tab) => tab.groupId !== groupId && tab.windowId !== destinationWindowId,
    );
    tabState = [...otherTabs, ...ordered].map((tab, index, all) => {
      const windowTabs = all.filter((candidate) => candidate.windowId === tab.windowId);
      const windowIndex = windowTabs.indexOf(tab);
      return { ...tab, index: windowIndex };
    });
    const updated = { ...group, windowId: destinationWindowId };
    groupState[groupIndex] = updated;
    return updated;
  });
  const getCurrent = vi.fn(async () => options.currentWindow ?? ({ id: 10 } as chrome.windows.Window));
  const storageGet = vi.fn(async (_key: string) => options.stored ?? {});
  const storageSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>(
    async () => undefined,
  );
  const bookmarkSearch = vi.fn(async () => options.bookmarkItems ?? []);
  const historySearch = vi.fn(async () => options.historyItems ?? []);
  const sessionsGetRecentlyClosed = vi.fn(async () => recentlyClosedState);
  const sessionsRestore = vi.fn(async (sessionId: string) => {
    const index = recentlyClosedState.findIndex(
      (session) => session.tab?.sessionId === sessionId,
    );
    const session = recentlyClosedState[index];
    if (!session) throw new Error("session not found");
    recentlyClosedState.splice(index, 1);
    return session;
  });

  return {
    tabs: {
      ...events,
      query,
      get,
      update,
      remove,
      duplicate,
      move,
      create,
      group: groupTabs,
      ungroup,
    } as unknown as typeof chrome.tabs,
    tabGroups: {
      ...groupEvents,
      query: groupQuery,
      get: groupGet,
      update: groupUpdate,
      move: groupMove,
    } as unknown as typeof chrome.tabGroups,
    windows: { getCurrent } as Pick<typeof chrome.windows, "getCurrent">,
    bookmarks: { search: bookmarkSearch } as Pick<typeof chrome.bookmarks, "search">,
    history: { search: historySearch } as Pick<typeof chrome.history, "search">,
    sessions: {
      getRecentlyClosed: sessionsGetRecentlyClosed,
      restore: sessionsRestore,
      onChanged: sessionEvents.onChanged,
    },
    storage: { get: storageGet, set: storageSet },
    document,
    events,
    groupEvents,
    sessionEvents,
    methods: {
      query,
      get,
      update,
      remove,
      duplicate,
      move,
      create,
      group: groupTabs,
      ungroup,
      groupQuery,
      groupGet,
      groupUpdate,
      groupMove,
      getCurrent,
      bookmarkSearch,
      historySearch,
      sessionsGetRecentlyClosed,
      sessionsRestore,
      storageGet,
      storageSet,
    },
    setTabs(next: chrome.tabs.Tab[]) {
      tabState = next.map((tab) => ({ ...tab }));
    },
    setRecentlyClosedSessions(next: chrome.sessions.Session[]) {
      recentlyClosedState = next.map((session) => ({ ...session }));
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
