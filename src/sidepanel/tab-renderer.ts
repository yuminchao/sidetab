import type { TabViewModel } from "./tab-model";

export type TabRendererElements = {
  list: HTMLElement;
  empty: HTMLElement;
};

export type TabRenderer = {
  render(tabs: readonly TabViewModel[]): void;
  patch(tab: TabViewModel): void;
  remove(id: number): void;
  destroy(): void;
};

export function createTabRenderer({ list, empty }: TabRendererElements): TabRenderer {
  const onFaviconError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !list.contains(target)) {
      return;
    }

    const container = target.parentElement;
    if (!container?.classList.contains("tab-favicon")) {
      return;
    }

    container.replaceChildren(createFaviconFallback(target.dataset.fallback ?? ""));
  };

  list.addEventListener("error", onFaviconError, true);

  return {
    render(tabs) {
      const fragment = document.createDocumentFragment();
      for (const tab of tabs) {
        fragment.append(createTabRow(tab));
      }
      list.replaceChildren(fragment);
      empty.hidden = tabs.length !== 0;
    },

    patch(tab) {
      const row = findTabRow(list, tab.id);
      if (row) {
        updateTabRow(row, tab);
      }
    },

    remove(id) {
      findTabRow(list, id)?.remove();
      empty.hidden = list.childElementCount !== 0;
    },

    destroy() {
      list.removeEventListener("error", onFaviconError, true);
    },
  };
}

function createTabRow(tab: TabViewModel): HTMLElement {
  const row = document.createElement("div");
  row.className = "tab-row";
  row.setAttribute("role", "listitem");

  const main = document.createElement("button");
  main.className = "tab-main";
  main.type = "button";
  main.dataset.action = "activate";

  const favicon = document.createElement("span");
  favicon.className = "tab-favicon";
  favicon.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.className = "tab-copy";

  const title = document.createElement("span");
  title.className = "tab-title";

  const domain = document.createElement("span");
  domain.className = "tab-domain";

  copy.append(title, domain);
  main.append(favicon, copy);

  const close = document.createElement("button");
  close.className = "tab-close";
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "×";

  row.append(main, close);
  updateTabRow(row, tab);
  return row;
}

function updateTabRow(row: HTMLElement, tab: TabViewModel): void {
  row.dataset.tabId = String(tab.id);
  row.dataset.active = String(tab.active);
  row.dataset.pinned = String(tab.pinned);
  if (tab.active) {
    row.setAttribute("aria-current", "page");
  } else {
    row.removeAttribute("aria-current");
  }

  const main = row.querySelector<HTMLButtonElement>(".tab-main");
  const close = row.querySelector<HTMLButtonElement>(".tab-close");
  const title = row.querySelector<HTMLElement>(".tab-title");
  const domain = row.querySelector<HTMLElement>(".tab-domain");
  const favicon = row.querySelector<HTMLElement>(".tab-favicon");

  if (!main || !close || !title || !domain || !favicon) {
    return;
  }

  main.setAttribute("aria-label", `切换到 ${tab.title}`);
  close.setAttribute("aria-label", `关闭 ${tab.title}`);
  close.title = `关闭 ${tab.title}`;
  title.textContent = tab.title;
  domain.textContent = tab.domain;
  favicon.replaceChildren(createFavicon(tab));
}

function createFavicon(tab: TabViewModel): HTMLElement {
  const fallback = getFallbackText(tab.title);
  if (!tab.favIconUrl) {
    return createFaviconFallback(fallback);
  }

  const image = document.createElement("img");
  image.className = "tab-favicon-image";
  image.src = tab.favIconUrl;
  image.loading = "lazy";
  image.width = 16;
  image.height = 16;
  image.alt = "";
  image.dataset.fallback = fallback;
  return image;
}

function createFaviconFallback(text: string): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "tab-favicon-fallback";
  fallback.textContent = text || "·";
  return fallback;
}

function getFallbackText(title: string): string {
  return title.trim().charAt(0).toLocaleUpperCase();
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
