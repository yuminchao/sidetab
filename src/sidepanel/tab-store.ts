import { toTabViewModel, type TabViewModel } from "./tab-model";

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

    const updated: TabViewModel = { ...existing, ...patch, id };
    this.tabs.set(id, updated);
    return copyTab(updated);
  }

  replace(tab: chrome.tabs.Tab): TabViewModel | undefined {
    return this.put(tab);
  }

  remove(id: number): boolean {
    return this.tabs.delete(id);
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

    const tabs = this.sortedTabs();
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
      this.tabs.set(model.id, model);
      return copyTab(model);
    } catch {
      return undefined;
    }
  }

  private sortedTabs(): TabViewModel[] {
    return [...this.tabs.values()].sort((left, right) => left.index - right.index || left.id - right.id);
  }
}

function copyTab(tab: TabViewModel): TabViewModel {
  return { ...tab };
}
