import type { TabViewModel } from "./tab-model";
import { createFaviconCandidates } from "./favicon-model";

export type TabRendererElements = {
  list: HTMLElement;
  empty: HTMLElement;
};

export type TabRenderer = {
  render(tabs: readonly TabViewModel[]): void;
  patch(tab: TabViewModel): void;
  remove(id: number): void;
  setDragEnabled(enabled: boolean): void;
  destroy(): void;
};

export function createTabRenderer({ list, empty }: TabRendererElements): TabRenderer {
  let dragEnabled = true;
  const onFaviconError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !list.contains(target)) {
      return;
    }

    const container = target.parentElement;
    if (
      !container?.classList.contains("tab-favicon") ||
      container.querySelector(":scope > .tab-favicon-image") !== target
    ) {
      return;
    }

    const nextUrl = target.dataset.nextUrl;
    if (nextUrl) {
      target.dataset.nextUrl = "";
      target.src = nextUrl;
      return;
    }

    container.replaceChildren(createFaviconFallback(target.dataset.fallback ?? ""));
  };

  list.addEventListener("error", onFaviconError, true);

  return {
    render(tabs) {
      const fragment = document.createDocumentFragment();
      for (const tab of tabs) {
        fragment.append(createTabRow(tab, dragEnabled));
      }
      list.replaceChildren(fragment);
      empty.hidden = tabs.length !== 0;
    },

    patch(tab) {
      const row = findTabRow(list, tab.id);
      if (row) {
        updateTabRow(row, tab, dragEnabled);
      }
    },

    remove(id) {
      findTabRow(list, id)?.remove();
      empty.hidden = list.childElementCount !== 0;
    },

    setDragEnabled(enabled) {
      dragEnabled = enabled;
      for (const child of Array.from(list.children)) {
        if (child instanceof HTMLElement) updateRowDragState(child, enabled);
      }
    },

    destroy() {
      list.removeEventListener("error", onFaviconError, true);
    },
  };
}

function createTabRow(tab: TabViewModel, dragEnabled: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "tab-row";
  row.setAttribute("role", "listitem");

  const main = document.createElement("button");
  main.className = "tab-main";
  main.type = "button";
  main.dataset.action = "activate";

  const pin = document.createElement("span");
  pin.className = "pin-indicator";
  pin.setAttribute("aria-hidden", "true");

  const favicon = document.createElement("span");
  favicon.className = "tab-favicon";
  favicon.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "tab-title";

  main.append(pin, favicon, title);

  const close = document.createElement("button");
  close.className = "tab-close";
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "×";

  row.append(main, close);
  updateTabRow(row, tab, dragEnabled);
  return row;
}

function updateTabRow(row: HTMLElement, tab: TabViewModel, dragEnabled: boolean): void {
  row.dataset.tabId = String(tab.id);
  row.dataset.active = String(tab.active);
  row.dataset.pinned = String(tab.pinned);
  row.dataset.hasPin = String(tab.pinned);
  updateRowDragState(row, dragEnabled);
  if (tab.active) {
    row.setAttribute("aria-current", "page");
  } else {
    row.removeAttribute("aria-current");
  }

  const main = row.querySelector<HTMLButtonElement>(".tab-main");
  const close = row.querySelector<HTMLButtonElement>(".tab-close");
  const title = row.querySelector<HTMLElement>(".tab-title");
  const favicon = row.querySelector<HTMLElement>(".tab-favicon");

  if (!main || !close || !title || !favicon) {
    return;
  }

  updatePin(main, tab.pinned);
  main.setAttribute("aria-label", tab.pinned ? `${tab.title}，已固定` : tab.title);
  close.setAttribute("aria-label", `关闭 ${tab.title}`);
  close.title = `关闭 ${tab.title}`;
  title.textContent = tab.title;
  updateFavicon(favicon, tab);
}

function updateRowDragState(row: HTMLElement, enabled: boolean): void {
  row.draggable = enabled;
  row.title = enabled ? "" : "清空搜索后可排序";
}

function updatePin(main: HTMLElement, pinned: boolean): void {
  const pin = main.querySelector<HTMLElement>(":scope > .pin-indicator");
  if (pin) {
    pin.dataset.visible = String(pinned);
  }
}

function updateFavicon(container: HTMLElement, tab: TabViewModel): void {
  const candidates = createFaviconCandidates(tab.favIconUrl, tab.url);
  const candidatesKey = JSON.stringify(candidates);
  const fallbackText = getFallbackText(tab.title);
  const sourceChanged = container.dataset.candidatesKey !== candidatesKey;

  if (sourceChanged) {
    container.replaceChildren(createFavicon(candidates, fallbackText));
    container.dataset.candidatesKey = candidatesKey;
    return;
  }

  const image = container.querySelector<HTMLImageElement>(".tab-favicon-image");
  if (image) {
    image.dataset.fallback = fallbackText;
    return;
  }

  const fallback = container.querySelector<HTMLElement>(".tab-favicon-fallback");
  if (fallback) {
    fallback.textContent = fallbackText || "·";
  }
}

function createFavicon(candidates: readonly string[], fallback: string): HTMLElement {
  const [faviconUrl, nextUrl = ""] = candidates;
  if (!faviconUrl) {
    return createFaviconFallback(fallback);
  }

  const image = document.createElement("img");
  image.className = "tab-favicon-image";
  image.src = faviconUrl;
  image.loading = "lazy";
  image.width = 16;
  image.height = 16;
  image.alt = "";
  image.dataset.fallback = fallback;
  image.dataset.nextUrl = nextUrl;
  return image;
}

function createFaviconFallback(text: string): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "tab-favicon-fallback";
  fallback.textContent = text || "·";
  return fallback;
}

function getFallbackText(title: string): string {
  return Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "";
}

function findTabRow(list: HTMLElement, id: number): HTMLElement | undefined {
  const expectedId = String(id);
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset.tabId === expectedId) {
      return child;
    }
  }
  return undefined;
}
