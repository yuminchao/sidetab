import { describe, expect, it, vi } from "vitest";
import {
  subscribeToTabGroupEvents,
  type TabGroupEventHandlers,
} from "../src/sidepanel/tab-group-events";
import { createFakeChrome, fakeGroup, fakeTab } from "./helpers/fake-chrome";

function setup() {
  const fake = createFakeChrome();
  const handlers: TabGroupEventHandlers = {
    created: vi.fn(),
    updated: vi.fn(),
    moved: vi.fn(),
    removed: vi.fn(),
  };
  return { fake, handlers };
}

describe("tab group event subscription", () => {
  it("registers one stable listener per event and unsubscribes idempotently", () => {
    const { fake, handlers } = setup();
    const unsubscribe = subscribeToTabGroupEvents(fake.tabGroups, 10, handlers);

    for (const event of Object.values(fake.groupEvents)) {
      expect(event.added).toHaveLength(1);
      expect(event.listenerCount).toBe(1);
    }

    unsubscribe();
    for (const event of Object.values(fake.groupEvents)) {
      expect(event.removed).toEqual(event.added);
      expect(event.listenerCount).toBe(0);
    }
    expect(() => unsubscribe()).not.toThrow();
    for (const event of Object.values(fake.groupEvents)) {
      expect(event.removed).toHaveLength(1);
    }
  });

  it("forwards created, updated, and moved groups only from the current window", () => {
    const { fake, handlers } = setup();
    subscribeToTabGroupEvents(fake.tabGroups, 10, handlers);
    const current = fakeGroup({ id: 7, windowId: 10 });
    const foreign = fakeGroup({ id: 8, windowId: 20 });

    fake.groupEvents.onCreated.emit(current);
    fake.groupEvents.onCreated.emit(foreign);
    fake.groupEvents.onUpdated.emit(current);
    fake.groupEvents.onUpdated.emit(foreign);
    fake.groupEvents.onMoved.emit(current);
    fake.groupEvents.onMoved.emit(foreign);

    expect(handlers.created).toHaveBeenCalledOnce();
    expect(handlers.created).toHaveBeenCalledWith(current);
    expect(handlers.updated).toHaveBeenCalledOnce();
    expect(handlers.updated).toHaveBeenCalledWith(current);
    expect(handlers.moved).toHaveBeenCalledOnce();
    expect(handlers.moved).toHaveBeenCalledWith(current);
  });

  it("extracts removed IDs only from current-window groups", () => {
    const { fake, handlers } = setup();
    subscribeToTabGroupEvents(fake.tabGroups, 10, handlers);

    fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7, windowId: 10 }));
    fake.groupEvents.onRemoved.emit(fakeGroup({ id: 8, windowId: 20 }));

    expect(handlers.removed).toHaveBeenCalledOnce();
    expect(handlers.removed).toHaveBeenCalledWith(7);
  });

  it("represents a cross-window move as removal from the old window and creation in the new one", () => {
    const oldWindow = setup();
    const newWindow = setup();
    subscribeToTabGroupEvents(oldWindow.fake.tabGroups, 10, oldWindow.handlers);
    subscribeToTabGroupEvents(newWindow.fake.tabGroups, 20, newWindow.handlers);

    oldWindow.fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7, windowId: 10 }));
    newWindow.fake.groupEvents.onCreated.emit(fakeGroup({ id: 7, windowId: 20 }));

    expect(oldWindow.handlers.removed).toHaveBeenCalledWith(7);
    expect(oldWindow.handlers.moved).not.toHaveBeenCalled();
    expect(newWindow.handlers.created).toHaveBeenCalledWith(
      fakeGroup({ id: 7, windowId: 20 }),
    );
    expect(newWindow.handlers.moved).not.toHaveBeenCalled();
  });

  it("does not forward any event after unsubscribe", () => {
    const { fake, handlers } = setup();
    const unsubscribe = subscribeToTabGroupEvents(fake.tabGroups, 10, handlers);
    unsubscribe();
    const current = fakeGroup({ windowId: 10 });

    fake.groupEvents.onCreated.emit(current);
    fake.groupEvents.onUpdated.emit(current);
    fake.groupEvents.onMoved.emit(current);
    fake.groupEvents.onRemoved.emit(current);

    for (const handler of Object.values(handlers)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });
});

describe("fake Chrome tab group API", () => {
  it("provides query, get, update, group, and ungroup methods", async () => {
    const current = fakeGroup({ id: 7, windowId: 10, title: "Work" });
    const foreign = fakeGroup({ id: 8, windowId: 20 });
    const fake = createFakeChrome({ groups: [current, foreign] });

    await expect(fake.tabGroups.query({ windowId: 10 })).resolves.toEqual([current]);
    await expect(fake.tabGroups.get(7)).resolves.toEqual(current);
    await expect(fake.tabGroups.get(99)).rejects.toThrow("group not found");
    await expect(fake.tabGroups.update(7, {
      title: "Updated",
      collapsed: true,
    })).resolves.toEqual({ ...current, title: "Updated", collapsed: true });
    await expect(fake.tabs.group({ tabIds: 3, groupId: 7 })).resolves.toBe(7);
    await expect(fake.tabs.group({
      tabIds: 3,
      createProperties: { windowId: 10 },
    })).resolves.toBe(777);
    await expect(fake.tabs.ungroup(3)).resolves.toBeUndefined();

    expect(fake.methods.groupQuery).toHaveBeenCalledWith({ windowId: 10 });
    expect(fake.methods.groupGet).toHaveBeenCalledWith(7);
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, {
      title: "Updated",
      collapsed: true,
    });
    expect(fake.methods.group).toHaveBeenCalledTimes(2);
    expect(fake.methods.ungroup).toHaveBeenCalledWith(3);
  });

  it("exposes existing-group membership changes through tab query and get", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 3, groupId: -1 })],
      groups: [fakeGroup({ id: 7 })],
    });

    await fake.tabs.group({ tabIds: 3, groupId: 7 });

    await expect(fake.tabs.query({ windowId: 10 })).resolves.toMatchObject([
      { id: 3, groupId: 7 },
    ]);
    await expect(fake.tabs.get(3)).resolves.toMatchObject({ id: 3, groupId: 7 });
  });

  it("creates queryable group state and updates every selected tab", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 3 }), fakeTab({ id: 4, index: 1 })],
    });

    await expect(fake.tabs.group({
      tabIds: [3, 4],
      createProperties: { windowId: 10 },
    })).resolves.toBe(777);

    await expect(fake.tabs.query({ windowId: 10 })).resolves.toMatchObject([
      { id: 3, groupId: 777 },
      { id: 4, groupId: 777 },
    ]);
    await expect(fake.tabGroups.get(777)).resolves.toMatchObject({
      id: 777,
      windowId: 10,
      color: "grey",
      collapsed: false,
    });
  });

  it("persists metadata updates for subsequent group reads", async () => {
    const fake = createFakeChrome({
      groups: [fakeGroup({ id: 7, title: "Before", collapsed: false })],
    });

    await fake.tabGroups.update(7, { title: "After", collapsed: true });

    await expect(fake.tabGroups.get(7)).resolves.toMatchObject({
      id: 7,
      title: "After",
      collapsed: true,
    });
    await expect(fake.tabGroups.query({ windowId: 10 })).resolves.toMatchObject([
      { id: 7, title: "After", collapsed: true },
    ]);
  });

  it("ungroups tabs and removes a group after its last member leaves", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 3, groupId: 7 })],
      groups: [fakeGroup({ id: 7 })],
    });

    await fake.tabs.ungroup(3);

    await expect(fake.tabs.get(3)).resolves.toMatchObject({ id: 3, groupId: -1 });
    await expect(fake.tabGroups.query({ windowId: 10 })).resolves.toEqual([]);
  });

  it("ungroups multiple tabs while retaining the group until its final member leaves", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, groupId: 7 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
        fakeTab({ id: 3, index: 2, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });

    await fake.tabs.ungroup([1, 2]);

    await expect(fake.tabs.get(1)).resolves.toMatchObject({ groupId: -1 });
    await expect(fake.tabs.get(2)).resolves.toMatchObject({ groupId: -1 });
    await expect(fake.tabs.get(3)).resolves.toMatchObject({ groupId: 7 });
    await expect(fake.tabGroups.query({ windowId: 10 })).resolves.toMatchObject([
      { id: 7 },
    ]);

    await fake.tabs.ungroup(3);

    await expect(fake.tabGroups.query({ windowId: 10 })).resolves.toEqual([]);
  });
});
