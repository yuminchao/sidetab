import type { TabViewModel } from "./tab-model";

export function getClosableTabsBelow(tabs: readonly TabViewModel[], tabId: number): number[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === tabId);

  if (targetIndex === -1) {
    return [];
  }

  return tabs.slice(targetIndex + 1).filter((tab) => !tab.pinned).map((tab) => tab.id);
}

export function getClosableTabsAbove(tabs: readonly TabViewModel[], tabId: number): number[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === tabId);

  if (targetIndex === -1) {
    return [];
  }

  return tabs.slice(0, targetIndex).filter((tab) => !tab.pinned).map((tab) => tab.id);
}
