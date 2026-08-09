import type { StorageArea } from "./shortcut-store";

export type TabTreeSessionState = {
  collapsedTabIds: Set<number>;
  detachedTabIds: Set<number>;
  attachedTabParentIds: Map<number, number>;
};

const keyForWindow = (windowId: number): string => `tabTreeSessionState:${windowId}`;

export function createTabTreeSessionStore(area: StorageArea | undefined) {
  let writeQueue = Promise.resolve();
  const enqueueWrite = (items: Record<string, unknown>): Promise<void> => {
    const operation = writeQueue
      .catch(() => undefined)
      .then(() => area?.set(items));
    writeQueue = operation;
    return operation;
  };

  return {
    async load(windowId: number): Promise<TabTreeSessionState> {
      if (!area) return emptyState();
      const key = keyForWindow(windowId);
      try {
        const stored = await area.get(key);
        const value = stored[key];
        if (!isRecord(value)) return emptyState();
        return {
          collapsedTabIds: toIdSet(value.collapsedTabIds),
          detachedTabIds: toIdSet(value.detachedTabIds),
          attachedTabParentIds: toParentMap(value.attachedTabParentIds),
        };
      } catch {
        return emptyState();
      }
    },

    async save(windowId: number, state: TabTreeSessionState): Promise<void> {
      if (!area) return;
      const key = keyForWindow(windowId);
      await enqueueWrite({
        [key]: {
          collapsedTabIds: [...state.collapsedTabIds],
          detachedTabIds: [...state.detachedTabIds],
          attachedTabParentIds: [...state.attachedTabParentIds],
        },
      });
    },

    async clear(windowId: number): Promise<void> {
      if (!area) return;
      const key = keyForWindow(windowId);
      await enqueueWrite({
        [key]: {
          collapsedTabIds: [],
          detachedTabIds: [],
          attachedTabParentIds: [],
        },
      });
    },
  };
}

function emptyState(): TabTreeSessionState {
  return {
    collapsedTabIds: new Set(),
    detachedTabIds: new Set(),
    attachedTabParentIds: new Map(),
  };
}

function toParentMap(value: unknown): Map<number, number> {
  if (!Array.isArray(value)) return new Map();
  const entries: Array<[number, number]> = [];
  for (const entry of value) {
    if (
      Array.isArray(entry)
      && entry.length === 2
      && isTabId(entry[0])
      && isTabId(entry[1])
    ) entries.push([entry[0], entry[1]]);
  }
  return new Map(entries);
}

function toIdSet(value: unknown): Set<number> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter(isTabId));
}

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
