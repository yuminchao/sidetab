import { describe, expect, it, vi } from "vitest";
import { subscribeToTabEvents, type TabEventHandlers } from "../src/sidepanel/tab-events";
import { FakeEvent } from "./helpers/fake-event";

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

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return { id: 1, windowId: 10, index: 0, active: false, pinned: false, ...overrides } as chrome.tabs.Tab;
}

function setup(get: (tabId: number) => Promise<chrome.tabs.Tab> = async (id) => tab({ id })) {
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
  const handlers: TabEventHandlers = {
    created: vi.fn(),
    removed: vi.fn(),
    updated: vi.fn(),
    activated: vi.fn(),
    moved: vi.fn(),
    detached: vi.fn(),
    attached: vi.fn(),
    replaced: vi.fn(),
    replacementLookupFailed: vi.fn(),
  };
  const api = { ...events, get } as unknown as typeof chrome.tabs;
  return { events, handlers, api };
}

async function flushAttached(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("tab event subscription", () => {
  it("registers one stable listener for each supported event", () => {
    const { api, events, handlers } = setup();
    const unsubscribe = subscribeToTabEvents(api, 10, handlers);

    for (const event of Object.values(events)) {
      expect(event.added).toHaveLength(1);
      expect(event.listenerCount).toBe(1);
    }

    unsubscribe();
    for (const event of Object.values(events)) {
      expect(event.removed).toEqual(event.added);
      expect(event.listenerCount).toBe(0);
    }
    expect(() => unsubscribe()).not.toThrow();
  });

  it("forwards created tabs only from the current window", () => {
    const { api, events, handlers } = setup();
    subscribeToTabEvents(api, 10, handlers);
    const current = tab({ id: 11 });

    events.onCreated.emit(current);
    events.onCreated.emit(tab({ id: 12, windowId: 20 }));

    expect(handlers.created).toHaveBeenCalledOnce();
    expect(handlers.created).toHaveBeenCalledWith(current);
  });

  it("forwards removals from the current window including window closing", () => {
    const { api, events, handlers } = setup();
    subscribeToTabEvents(api, 10, handlers);

    events.onRemoved.emit(11, { windowId: 10, isWindowClosing: true });
    events.onRemoved.emit(12, { windowId: 20, isWindowClosing: false });

    expect(handlers.removed).toHaveBeenCalledOnce();
    expect(handlers.removed).toHaveBeenCalledWith(11);
  });

  it("forwards the complete updated tab based on its window, not change info", () => {
    const { api, events, handlers } = setup();
    subscribeToTabEvents(api, 10, handlers);
    const current = tab({ id: 11, title: "Complete tab" });

    events.onUpdated.emit(999, { title: "ignored" }, current);
    events.onUpdated.emit(11, {}, tab({ id: 12, windowId: 20 }));

    expect(handlers.updated).toHaveBeenCalledOnce();
    expect(handlers.updated).toHaveBeenCalledWith(current);
  });

  it("forwards activations and moves only from the current window with exact arguments", () => {
    const { api, events, handlers } = setup();
    subscribeToTabEvents(api, 10, handlers);

    events.onActivated.emit({ tabId: 11, windowId: 10 });
    events.onActivated.emit({ tabId: 12, windowId: 20 });
    events.onMoved.emit(13, { windowId: 10, fromIndex: 1, toIndex: 4 });
    events.onMoved.emit(14, { windowId: 20, fromIndex: 2, toIndex: 3 });

    expect(handlers.activated).toHaveBeenCalledOnce();
    expect(handlers.activated).toHaveBeenCalledWith(11);
    expect(handlers.moved).toHaveBeenCalledOnce();
    expect(handlers.moved).toHaveBeenCalledWith(13, 4);
  });

  it("forwards detaches only from the current old window", () => {
    const { api, events, handlers } = setup();
    subscribeToTabEvents(api, 10, handlers);

    events.onDetached.emit(11, { oldWindowId: 10, oldPosition: 2 });
    events.onDetached.emit(12, { oldWindowId: 20, oldPosition: 3 });

    expect(handlers.detached).toHaveBeenCalledOnce();
    expect(handlers.detached).toHaveBeenCalledWith(11);
  });

  it("loads and rechecks an attached tab before forwarding it", async () => {
    const get = vi.fn(async (id: number) => tab({ id, windowId: id === 11 ? 10 : 20 }));
    const { api, events, handlers } = setup(get);
    subscribeToTabEvents(api, 10, handlers);

    events.onAttached.emit(99, { newWindowId: 20, newPosition: 0 });
    events.onAttached.emit(11, { newWindowId: 10, newPosition: 1 });
    events.onAttached.emit(12, { newWindowId: 10, newPosition: 2 });
    await flushAttached();

    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, 11);
    expect(get).toHaveBeenNthCalledWith(2, 12);
    expect(handlers.attached).toHaveBeenCalledOnce();
    expect(handlers.attached).toHaveBeenCalledWith(tab({ id: 11 }));
  });

  it.each([
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("gone"))],
    ["synchronous throw", () => vi.fn(() => { throw new Error("gone"); })],
  ])("safely ignores an attached get %s", async (_case, makeGet) => {
    const { api, events, handlers } = setup(makeGet());
    subscribeToTabEvents(api, 10, handlers);

    expect(() => events.onAttached.emit(11, { newWindowId: 10, newPosition: 1 })).not.toThrow();
    await flushAttached();

    expect(handlers.attached).not.toHaveBeenCalled();
  });

  it("stops all eight event types after unsubscribe", async () => {
    const { api, events, handlers } = setup();
    const unsubscribe = subscribeToTabEvents(api, 10, handlers);
    unsubscribe();

    events.onCreated.emit(tab());
    events.onRemoved.emit(1, { windowId: 10, isWindowClosing: false });
    events.onUpdated.emit(1, {}, tab());
    events.onActivated.emit({ tabId: 1, windowId: 10 });
    events.onMoved.emit(1, { windowId: 10, fromIndex: 0, toIndex: 1 });
    events.onDetached.emit(1, { oldWindowId: 10, oldPosition: 0 });
    events.onAttached.emit(1, { newWindowId: 10, newPosition: 0 });
    events.onReplaced.emit(2, 1);
    await flushAttached();

    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("invalidates an in-flight attached tab when unsubscribed", async () => {
    const request = deferred<chrome.tabs.Tab>();
    const get = vi.fn(() => request.promise);
    const { api, events, handlers } = setup(get);
    const unsubscribe = subscribeToTabEvents(api, 10, handlers);

    events.onAttached.emit(11, { newWindowId: 10, newPosition: 1 });
    expect(get).toHaveBeenCalledWith(11);
    unsubscribe();
    request.resolve(tab({ id: 11, windowId: 10 }));
    await flushAttached();

    expect(handlers.attached).not.toHaveBeenCalled();
  });

  it("loads and forwards a replacement only when its added tab is in the current window", async () => {
    const get = vi.fn(async (id: number) => tab({ id, windowId: id === 11 ? 10 : 20 }));
    const { api, events, handlers } = setup(get);
    subscribeToTabEvents(api, 10, handlers);

    events.onReplaced.emit(11, 1);
    events.onReplaced.emit(12, 2);
    await flushAttached();

    expect(get).toHaveBeenNthCalledWith(1, 11);
    expect(get).toHaveBeenNthCalledWith(2, 12);
    expect(handlers.replaced).toHaveBeenCalledOnce();
    expect(handlers.replaced).toHaveBeenCalledWith(tab({ id: 11 }), 1);
    expect(handlers.replacementLookupFailed).not.toHaveBeenCalled();
  });

  it.each([
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("gone"))],
    ["synchronous throw", () => vi.fn(() => { throw new Error("gone"); })],
  ])("reports a replacement get %s", async (_case, makeGet) => {
    const { api, events, handlers } = setup(makeGet());
    subscribeToTabEvents(api, 10, handlers);

    expect(() => events.onReplaced.emit(11, 1)).not.toThrow();
    await flushAttached();

    expect(handlers.replaced).not.toHaveBeenCalled();
    expect(handlers.replacementLookupFailed).toHaveBeenCalledOnce();
  });

  it("invalidates an in-flight replacement success and failure after unsubscribe", async () => {
    const first = deferred<chrome.tabs.Tab>();
    const second = deferred<chrome.tabs.Tab>();
    const get = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { api, events, handlers } = setup(get);
    const unsubscribe = subscribeToTabEvents(api, 10, handlers);

    events.onReplaced.emit(11, 1);
    events.onReplaced.emit(12, 2);
    unsubscribe();
    first.resolve(tab({ id: 11 }));
    second.reject(new Error("gone"));
    await flushAttached();

    expect(handlers.replaced).not.toHaveBeenCalled();
    expect(handlers.replacementLookupFailed).not.toHaveBeenCalled();
  });

  it("safely ignores an in-flight attached rejection after unsubscribe", async () => {
    const request = deferred<chrome.tabs.Tab>();
    const { api, events, handlers } = setup(() => request.promise);
    const unsubscribe = subscribeToTabEvents(api, 10, handlers);

    events.onAttached.emit(11, { newWindowId: 10, newPosition: 1 });
    unsubscribe();
    request.reject(new Error("gone"));
    await flushAttached();

    expect(handlers.attached).not.toHaveBeenCalled();
  });
});
