import type { TabViewModel } from "./tab-model";

export type SameSiteGroupPlan = {
  hostname: string;
  windowId: number;
  tabIds: [number, number, ...number[]];
};

export type SameSiteMenuAvailability = {
  canGroupSameSite: boolean;
  canCloseOtherSameSite: boolean;
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

export function getSameSiteMenuAvailability(
  tabs: readonly TabViewModel[],
  tabId: number,
  isGroupBusy: (tabId: number) => boolean = () => false,
): SameSiteMenuAvailability {
  type SiteStats = {
    unpinnedCount: number;
    groupCandidateCount: number;
    hasBusyGroupCandidate: boolean;
  };

  const statsBySite = new Map<string, SiteStats>();
  let target: TabViewModel | undefined;
  let targetHostname: string | undefined;

  for (const tab of tabs) {
    const hostname = getHttpHostname(tab.url);
    if (tab.id === tabId) {
      target = tab;
      targetHostname = hostname;
    }
    if (!hostname) continue;

    const key = `${tab.windowId}:${hostname}`;
    const stats = statsBySite.get(key) ?? {
      unpinnedCount: 0,
      groupCandidateCount: 0,
      hasBusyGroupCandidate: false,
    };
    if (!tab.pinned) stats.unpinnedCount += 1;
    if (!tab.pinned && tab.groupId < 0) {
      stats.groupCandidateCount += 1;
      stats.hasBusyGroupCandidate ||= isGroupBusy(tab.id);
    }
    statsBySite.set(key, stats);
  }
  const stats = target && targetHostname
    ? statsBySite.get(`${target.windowId}:${targetHostname}`)
    : undefined;

  return {
    canCloseOtherSameSite: Boolean(
      target
      && stats
      && stats.unpinnedCount > (target.pinned ? 0 : 1)
    ),
    canGroupSameSite: Boolean(
      targetHostname
      && target
      && !target.pinned
      && target.groupId < 0
      && stats
      && stats.groupCandidateCount >= 2
      && !stats.hasBusyGroupCandidate
    ),
  };
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
