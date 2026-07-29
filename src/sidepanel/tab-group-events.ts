export type TabGroupEventHandlers = {
  created(group: chrome.tabGroups.TabGroup): void;
  updated(group: chrome.tabGroups.TabGroup): void;
  moved(group: chrome.tabGroups.TabGroup): void;
  removed(groupId: number): void;
};

export function subscribeToTabGroupEvents(
  tabGroupsApi: typeof chrome.tabGroups,
  currentWindowId: number,
  handlers: TabGroupEventHandlers,
): () => void {
  let active = true;

  const onCreated = (group: chrome.tabGroups.TabGroup): void => {
    if (group.windowId === currentWindowId) {
      handlers.created(group);
    }
  };
  const onUpdated = (group: chrome.tabGroups.TabGroup): void => {
    if (group.windowId === currentWindowId) {
      handlers.updated(group);
    }
  };
  const onMoved = (group: chrome.tabGroups.TabGroup): void => {
    if (group.windowId === currentWindowId) {
      handlers.moved(group);
    }
  };
  const onRemoved = (group: chrome.tabGroups.TabGroup): void => {
    if (group.windowId === currentWindowId) {
      handlers.removed(group.id);
    }
  };

  tabGroupsApi.onCreated.addListener(onCreated);
  tabGroupsApi.onUpdated.addListener(onUpdated);
  tabGroupsApi.onMoved.addListener(onMoved);
  tabGroupsApi.onRemoved.addListener(onRemoved);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    tabGroupsApi.onCreated.removeListener(onCreated);
    tabGroupsApi.onUpdated.removeListener(onUpdated);
    tabGroupsApi.onMoved.removeListener(onMoved);
    tabGroupsApi.onRemoved.removeListener(onRemoved);
  };
}
