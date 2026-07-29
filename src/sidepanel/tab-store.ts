import { isValidTabGroupMembershipId } from "./tab-group-model";
import { getTabDomain, toTabViewModel, type TabViewModel } from "./tab-model";

export class TabStore {
  private readonly tabs = new Map<number, TabViewModel>();

  initialize(tabs: chrome.tabs.Tab[]): void {
    this.tabs.clear();
    for (const tab of tabs) {
      try {
        const model = toTabViewModel(tab);
        this.tabs.set(model.id, model);
      } catch {
        // A malformed Chrome tab should not prevent the remaining tabs loading.
      }
    }
  }

  list(): TabViewModel[] {
    return this.sortedTabs().map(copyTab);
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

    this.tabs.set(id, updated);
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

  remove(id: number): boolean {
    const tab = this.tabs.get(id);
    if (!tab) {
      return false;
    }

    this.tabs.delete(id);
    for (const [tabId, current] of this.tabs) {
      if (current.index > tab.index) {
        this.tabs.set(tabId, { ...current, index: current.index - 1 });
      }
    }
    return true;
  }

  activate(id: number): void {
    if (!this.tabs.has(id)) {
      return;
    }

    for (const [tabId, tab] of this.tabs) {
      this.tabs.set(tabId, { ...tab, active: tabId === id });
    }
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

    for (const [newIndex, tab] of tabs.entries()) {
      this.tabs.set(tab.id, { ...tab, index: newIndex });
    }
  }

  private put(tab: chrome.tabs.Tab): TabViewModel | undefined {
    try {
      const model = toTabViewModel(tab);
      const existing = this.tabs.get(model.id);
      if (existing && existing.index === model.index) {
        this.tabs.set(model.id, model);
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

  private sortedTabs(): TabViewModel[] {
    return [...this.tabs.values()].sort(compareTabs);
  }

  private tabsInChromeOrder(): TabViewModel[] {
    return [...this.tabs.values()].sort((left, right) => left.index - right.index || left.id - right.id);
  }

  private insert(tab: TabViewModel): void {
    for (const [id, current] of this.tabs) {
      if (current.index >= tab.index) {
        this.tabs.set(id, { ...current, index: current.index + 1 });
      }
    }
    this.tabs.set(tab.id, tab);
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
