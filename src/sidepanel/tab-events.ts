export type TabEventHandlers = {
  created(tab: chrome.tabs.Tab): void;
  removed(tabId: number): void;
  updated(tab: chrome.tabs.Tab): void;
  activated(tabId: number): void;
  moved(tabId: number, index: number): void;
  detached(tabId: number): void;
  attached(tab: chrome.tabs.Tab): void;
  replaced(tab: chrome.tabs.Tab, removedTabId: number): void;
  replacementLookupFailed(): void;
};

export function subscribeToTabEvents(
  tabsApi: typeof chrome.tabs,
  currentWindowId: number,
  handlers: TabEventHandlers,
): () => void {
  let active = true;

  const onCreated = (tab: chrome.tabs.Tab): void => {
    if (tab.windowId === currentWindowId) {
      handlers.created(tab);
    }
  };
  const onRemoved = (tabId: number, removeInfo: chrome.tabs.OnRemovedInfo): void => {
    if (removeInfo.windowId === currentWindowId) {
      handlers.removed(tabId);
    }
  };
  const onUpdated = (
    _tabId: number,
    _changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ): void => {
    if (tab.windowId === currentWindowId) {
      handlers.updated(tab);
    }
  };
  const onActivated = (activeInfo: chrome.tabs.OnActivatedInfo): void => {
    if (activeInfo.windowId === currentWindowId) {
      handlers.activated(activeInfo.tabId);
    }
  };
  const onMoved = (tabId: number, moveInfo: chrome.tabs.OnMovedInfo): void => {
    if (moveInfo.windowId === currentWindowId) {
      handlers.moved(tabId, moveInfo.toIndex);
    }
  };
  const onAttached = (tabId: number, attachInfo: chrome.tabs.OnAttachedInfo): void => {
    if (attachInfo.newWindowId !== currentWindowId) {
      return;
    }
    void forwardAttachedTab(tabId);
  };
  const onDetached = (tabId: number, detachInfo: chrome.tabs.OnDetachedInfo): void => {
    if (detachInfo.oldWindowId === currentWindowId) {
      handlers.detached(tabId);
    }
  };
  const onReplaced = (addedTabId: number, removedTabId: number): void => {
    void forwardReplacedTab(addedTabId, removedTabId);
  };

  async function forwardAttachedTab(tabId: number): Promise<void> {
    try {
      const tab = await tabsApi.get(tabId);
      if (active && tab.windowId === currentWindowId) {
        handlers.attached(tab);
      }
    } catch {
      // The tab can disappear or move again before Chrome resolves get().
    }
  }

  async function forwardReplacedTab(addedTabId: number, removedTabId: number): Promise<void> {
    try {
      const tab = await tabsApi.get(addedTabId);
      if (active && tab.windowId === currentWindowId) {
        handlers.replaced(tab, removedTabId);
      }
    } catch {
      if (active) {
        handlers.replacementLookupFailed();
      }
    }
  }

  tabsApi.onCreated.addListener(onCreated);
  tabsApi.onRemoved.addListener(onRemoved);
  tabsApi.onUpdated.addListener(onUpdated);
  tabsApi.onActivated.addListener(onActivated);
  tabsApi.onMoved.addListener(onMoved);
  tabsApi.onAttached.addListener(onAttached);
  tabsApi.onDetached.addListener(onDetached);
  tabsApi.onReplaced.addListener(onReplaced);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    tabsApi.onCreated.removeListener(onCreated);
    tabsApi.onRemoved.removeListener(onRemoved);
    tabsApi.onUpdated.removeListener(onUpdated);
    tabsApi.onActivated.removeListener(onActivated);
    tabsApi.onMoved.removeListener(onMoved);
    tabsApi.onAttached.removeListener(onAttached);
    tabsApi.onDetached.removeListener(onDetached);
    tabsApi.onReplaced.removeListener(onReplaced);
  };
}
