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
type TabGroupListener = (group: chrome.tabGroups.TabGroup) => void;

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
  historyItems?: chrome.history.HistoryItem[];
  stored?: Record<string, unknown>;
} = {}) {
  let tabState = (options.tabs ?? []).map((tab) => ({ ...tab }));
  let groupState = (options.groups ?? []).map((group) => ({ ...group }));
  const events = {
    onCreated: new FakeEvent<CreatedListener>(),
    onRemoved: new FakeEvent<RemovedListener>(),
    onUpdated: new FakeEvent<UpdatedListener>(),
    onActivated: new FakeEvent<ActivatedListener>(),
    onMoved: new FakeEvent<MovedListener>(),
    onAttached: new FakeEvent<AttachedListener>(),
    onDetached: new FakeEvent<DetachedListener>(),
  };
  const groupEvents = {
    onCreated: new FakeEvent<TabGroupListener>(),
    onUpdated: new FakeEvent<TabGroupListener>(),
    onMoved: new FakeEvent<TabGroupListener>(),
    onRemoved: new FakeEvent<TabGroupListener>(),
  };
  const query = vi.fn(async () => tabState);
  const get = vi.fn(async (tabId: number) => {
    const tab = tabState.find((candidate) => candidate.id === tabId);
    if (!tab) throw new Error("tab not found");
    return tab;
  });
  const update = vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) =>
    fakeTab({ id: tabId, ...properties }),
  );
  const remove = vi.fn(async () => undefined);
  const duplicate = vi.fn(async (tabId: number) => fakeTab({ id: tabId + 1000 }));
  const move = vi.fn(async (tabId: number, moveProperties: chrome.tabs.MoveProperties) =>
    fakeTab({ id: tabId, index: moveProperties.index as number }),
  );
  const create = vi.fn(async (properties: chrome.tabs.CreateProperties) =>
    fakeTab({ id: 999, url: properties.url, active: properties.active ?? true }),
  );
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
  const getCurrent = vi.fn(async () => options.currentWindow ?? ({ id: 10 } as chrome.windows.Window));
  const storageGet = vi.fn(async () => options.stored ?? {});
  const storageSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>(
    async () => undefined,
  );
  const historySearch = vi.fn(async () => options.historyItems ?? []);

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
    } as unknown as typeof chrome.tabGroups,
    windows: { getCurrent } as Pick<typeof chrome.windows, "getCurrent">,
    history: { search: historySearch } as Pick<typeof chrome.history, "search">,
    storage: { get: storageGet, set: storageSet },
    document,
    events,
    groupEvents,
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
      getCurrent,
      historySearch,
      storageGet,
      storageSet,
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
