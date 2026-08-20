import { isValidTabGroupMembershipId } from "./tab-group-model";
import { getTabDomain, toTabViewModel, type TabViewModel } from "./tab-model";

export class TabStore {
  private readonly tabs = new Map<number, TabViewModel>();
  private sortedCache: readonly TabViewModel[] | undefined;
  private activeTabId: number | undefined;

  private invalidateCache(): void {
    this.sortedCache = undefined;
  }

  initialize(tabs: chrome.tabs.Tab[]): void {
    this.tabs.clear();
    this.activeTabId = undefined;
    this.invalidateCache();
    for (const tab of tabs) {
      try {
        const model = toTabViewModel(tab);
        this.setTab(model.id, model);
        if (model.active) this.activeTabId = model.id;
      } catch {
        // A malformed Chrome tab should not prevent the remaining tabs loading.
      }
    }
  }

  list(): TabViewModel[] {
    return this.sortedTabs().map(copyTab);
  }

  /** 零拷贝只读快照：调用方不得修改返回的标签对象。 */
  snapshot(): readonly Readonly<TabViewModel>[] {
    return this.sortedTabs();
  }

  get(id: number): TabViewModel | undefined {
    const tab = this.tabs.get(id);
    return tab ? copyTab(tab) : undefined;
  }

  filter(query: string): TabViewModel[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return this.list();
    }

    return this.sortedTabs()
      .filter((tab) => [tab.title, tab.url, tab.domain].some((value) => value.toLocaleLowerCase().includes(normalized)))
      .map(copyTab);
  }

  add(tab: chrome.tabs.Tab): TabViewModel | undefined {
    return this.put(tab);
  }

  update(id: number, patch: Partial<TabViewModel>): TabViewModel | undefined {
    const existing = this.tabs.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: TabViewModel = { ...existing };
    if (typeof patch.windowId === "number" && Number.isFinite(patch.windowId) && Number.isInteger(patch.windowId)) {
      updated.windowId = patch.windowId;
    }
    if (typeof patch.title === "string") {
      updated.title = patch.title.trim() || "新标签页";
    }
    const url = patch.url;
    const urlChanged = typeof url === "string";
    if (urlChanged) {
      updated.url = url;
      updated.domain = getTabDomain(url);
    } else if (typeof patch.domain === "string") {
      updated.domain = patch.domain;
    }
    if (typeof patch.active === "boolean") {
      updated.active = patch.active;
    }
    if (typeof patch.pinned === "boolean") {
      updated.pinned = patch.pinned;
    }
    if (isValidTabGroupMembershipId(patch.groupId)) {
      updated.groupId = patch.groupId;
    }
    if (Object.hasOwn(patch, "favIconUrl")) {
      if (typeof patch.favIconUrl === "string") {
        updated.favIconUrl = patch.favIconUrl;
      } else if (patch.favIconUrl === undefined) {
        delete updated.favIconUrl;
      }
    }

    this.setTab(id, updated);
    this.invalidateCache();
    if (updated.active) {
      this.activate(id);
    }
    if (typeof patch.index === "number" && Number.isFinite(patch.index) && Number.isInteger(patch.index) && patch.index >= 0) {
      this.move(id, patch.index);
    }
    return copyTab(this.tabs.get(id)!);
  }

  replace(tab: chrome.tabs.Tab): TabViewModel | undefined {
    return this.put(tab);
  }

  replaceId(removedId: number, replacement: chrome.tabs.Tab): TabViewModel | undefined {
    let model: TabViewModel;
    try {
      model = toTabViewModel(replacement);
    } catch {
      return undefined;
    }
    const removed = this.tabs.get(removedId);
    if (model.openerTabId === undefined && removed?.openerTabId !== undefined) {
      model.openerTabId = removed.openerTabId;
    }

    const ordered = this.tabsInChromeOrder()
      .filter((tab) => tab.id !== removedId && tab.id !== model.id);
    const destination = Math.max(0, Math.min(model.index, ordered.length));
    ordered.splice(destination, 0, model);

    const next = new Map<number, TabViewModel>();
    for (const [index, tab] of ordered.entries()) {
      next.set(tab.id, {
        ...tab,
        ...(tab.openerTabId === removedId ? { openerTabId: model.id } : {}),
        index,
        active: model.active ? tab.id === model.id : tab.active,
      });
    }
    this.tabs.clear();
    for (const [id, tab] of next) {
      this.setTab(id, tab);
    }
    this.activeTabId = model.active
      ? model.id
      : Array.from(next.values()).find((tab) => tab.active)?.id;
    this.invalidateCache();
    return copyTab(this.tabs.get(model.id)!);
  }

  remove(id: number): boolean {
    const tab = this.tabs.get(id);
    if (!tab) {
      return false;
    }

    this.tabs.delete(id);
    if (this.activeTabId === id) this.activeTabId = undefined;
    this.invalidateCache();
    for (const [tabId, current] of this.tabs) {
      if (current.index > tab.index) {
        this.setTab(tabId, { ...current, index: current.index - 1 });
      }
    }
    return true;
  }

  activate(id: number): void {
    const nextActive = this.tabs.get(id);
    if (!nextActive || this.activeTabId === id) {
      return;
    }

    this.invalidateCache();
    if (this.activeTabId !== undefined) {
      const previousActive = this.tabs.get(this.activeTabId);
      if (previousActive) {
        this.setTab(this.activeTabId, { ...previousActive, active: false });
      }
    }
    if (!nextActive.active) this.setTab(id, { ...nextActive, active: true });
    this.activeTabId = id;
  }

  move(id: number, index: number): void {
    if (!Number.isFinite(index) || !Number.isInteger(index)) {
      return;
    }

    const tabs = this.tabsInChromeOrder();
    const currentIndex = tabs.findIndex((tab) => tab.id === id);
    if (currentIndex < 0) {
      return;
    }

    const [moved] = tabs.splice(currentIndex, 1);
    if (!moved) {
      return;
    }
    const destination = Math.max(0, Math.min(index, tabs.length));
    tabs.splice(destination, 0, moved);

    this.invalidateCache();
    for (const [newIndex, tab] of tabs.entries()) {
      this.setTab(tab.id, { ...tab, index: newIndex });
    }
  }

  private put(tab: chrome.tabs.Tab): TabViewModel | undefined {
    try {
      const model = toTabViewModel(tab);
      const existing = this.tabs.get(model.id);
      if (existing && existing.index === model.index) {
        this.setTab(model.id, model);
        this.invalidateCache();
      } else {
        if (existing) {
          this.remove(model.id);
        }
        this.insert(model);
      }
      if (model.active) {
        this.activate(model.id);
      }
      return copyTab(this.tabs.get(model.id)!);
    } catch {
      return undefined;
    }
  }

  private setTab(id: number, tab: TabViewModel): void {
    this.tabs.set(id, Object.freeze(tab) as TabViewModel);
  }

  private sortedTabs(): readonly TabViewModel[] {
    if (this.sortedCache === undefined) {
      this.sortedCache = Object.freeze([...this.tabs.values()].sort(compareTabs));
    }
    return this.sortedCache;
  }

  private tabsInChromeOrder(): TabViewModel[] {
    return [...this.tabs.values()].sort((left, right) => left.index - right.index || left.id - right.id);
  }

  private insert(tab: TabViewModel): void {
    this.invalidateCache();
    for (const [id, current] of this.tabs) {
      if (current.index >= tab.index) {
        this.setTab(id, { ...current, index: current.index + 1 });
      }
    }
    this.setTab(tab.id, tab);
  }
}

function copyTab(tab: TabViewModel): TabViewModel {
  return { ...tab };
}

function compareTabs(left: TabViewModel, right: TabViewModel): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return left.index - right.index || left.id - right.id;
}
