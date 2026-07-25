export type TabViewModel = {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
};

export function toTabViewModel(tab: chrome.tabs.Tab): TabViewModel {
  if (tab.id === undefined) {
    throw new Error("标签页缺少 ID");
  }

  const url = tab.url ?? tab.pendingUrl ?? "";
  const title = (tab.title ?? "").trim() || "新标签页";
  const model: TabViewModel = {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title,
    url,
    domain: getTabDomain(url),
    active: tab.active,
    pinned: tab.pinned,
  };

  if (tab.favIconUrl) {
    model.favIconUrl = tab.favIconUrl;
  }

  return model;
}

export function getTabDomain(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome:") {
      return "chrome";
    }
    return parsed.hostname || parsed.protocol.slice(0, -1);
  } catch {
    return url;
  }
}
