import type { StorageArea } from "./shortcut-store";

export type TabTreeSessionState = {
  collapsedTabIds: Set<number>;
  detachedTabIds: Set<number>;
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
        },
      });
    },

    async clear(windowId: number): Promise<void> {
      if (!area) return;
      const key = keyForWindow(windowId);
      await enqueueWrite({ [key]: { collapsedTabIds: [], detachedTabIds: [] } });
    },
  };
}

function emptyState(): TabTreeSessionState {
  return { collapsedTabIds: new Set(), detachedTabIds: new Set() };
}

function toIdSet(value: unknown): Set<number> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter(
    (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
