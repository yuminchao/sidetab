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

export function createFakeChrome(options: {
  currentWindow?: chrome.windows.Window;
  tabs?: chrome.tabs.Tab[];
  historyItems?: chrome.history.HistoryItem[];
  stored?: Record<string, unknown>;
} = {}) {
  const initialTabs = options.tabs ?? [];
  const events = {
    onCreated: new FakeEvent<CreatedListener>(),
    onRemoved: new FakeEvent<RemovedListener>(),
    onUpdated: new FakeEvent<UpdatedListener>(),
    onActivated: new FakeEvent<ActivatedListener>(),
    onMoved: new FakeEvent<MovedListener>(),
    onAttached: new FakeEvent<AttachedListener>(),
    onDetached: new FakeEvent<DetachedListener>(),
  };
  const query = vi.fn(async () => initialTabs);
  const get = vi.fn(async (tabId: number) => {
    const tab = initialTabs.find((candidate) => candidate.id === tabId);
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
    } as unknown as typeof chrome.tabs,
    windows: { getCurrent } as Pick<typeof chrome.windows, "getCurrent">,
    history: { search: historySearch } as Pick<typeof chrome.history, "search">,
    storage: { get: storageGet, set: storageSet },
    document,
    events,
    methods: {
      query,
      get,
      update,
      remove,
      duplicate,
      move,
      create,
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
