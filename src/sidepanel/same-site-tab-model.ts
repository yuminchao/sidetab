import type { TabViewModel } from "./tab-model";

export type SameSiteGroupPlan = {
  hostname: string;
  windowId: number;
  tabIds: [number, number, ...number[]];
};

export function getHttpHostname(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname
      : undefined;
  } catch {
    return undefined;
  }
}

export function getOtherSameSiteTabIds(tabs: readonly TabViewModel[], tabId: number): number[] {
  const target = tabs.find((tab) => tab.id === tabId);
  const hostname = target && getHttpHostname(target.url);

  if (!target || !hostname) {
    return [];
  }

  return tabs.flatMap((tab) => (
    tab.id !== target.id
    && tab.windowId === target.windowId
    && !tab.pinned
    && getHttpHostname(tab.url) === hostname
      ? [tab.id]
      : []
  ));
}

export function createSameSiteGroupPlan(
  tabs: readonly TabViewModel[],
  tabId: number,
): SameSiteGroupPlan | undefined {
  const target = tabs.find((tab) => tab.id === tabId);
  const hostname = target && getHttpHostname(target.url);

  if (!target || !hostname || target.pinned || target.groupId >= 0) {
    return undefined;
  }

  const eligible = tabs.filter((tab) => (
    tab.windowId === target.windowId
    && !tab.pinned
    && tab.groupId < 0
    && getHttpHostname(tab.url) === hostname
  ));

  if (eligible.length < 2) {
    return undefined;
  }

  const [first, second, ...remaining] = eligible;
  return {
    hostname,
    windowId: target.windowId,
    tabIds: [first!.id, second!.id, ...remaining.map((tab) => tab.id)],
  };
}
