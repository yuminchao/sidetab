import {
  toTabGroupViewModel,
  type TabGroupViewModel,
} from "./tab-group-model";

export class TabGroupStore {
  private readonly groups = new Map<number, TabGroupViewModel>();

  initialize(
    groups: readonly chrome.tabGroups.TabGroup[],
    windowId: number,
  ): void {
    this.groups.clear();
    for (const group of groups) {
      this.put(group, windowId);
    }
  }

  list(): TabGroupViewModel[] {
    return [...this.groups.values()]
      .sort((left, right) => left.id - right.id)
      .map(copyGroup);
  }

  get(id: number): TabGroupViewModel | undefined {
    const group = this.groups.get(id);
    return group ? copyGroup(group) : undefined;
  }

  put(
    group: chrome.tabGroups.TabGroup,
    windowId: number,
  ): TabGroupViewModel | undefined {
    if (group.windowId !== windowId) {
      return undefined;
    }

    try {
      const model = toTabGroupViewModel(group);
      this.groups.set(model.id, model);
      return copyGroup(model);
    } catch {
      return undefined;
    }
  }

  remove(id: number): boolean {
    return this.groups.delete(id);
  }
}

function copyGroup(group: TabGroupViewModel): TabGroupViewModel {
  return { ...group };
}
