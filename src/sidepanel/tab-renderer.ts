import type { TabGroupViewModel } from "./tab-group-model";
import type { TabListItem } from "./tab-list-model";
import type { TabViewModel } from "./tab-model";
import { createFaviconCandidates } from "./favicon-model";

export type TabRendererElements = {
  list: HTMLElement;
  empty: HTMLElement;
};

export type TabRenderer = {
  render(items: readonly TabListItem[]): void;
  patchTab(tab: TabViewModel): void;
  patchGroup(group: TabGroupViewModel): void;
  removeTab(id: number): void;
  setDragEnabled(enabled: boolean): void;
  destroy(): void;
};

export function createTabRenderer({ list, empty }: TabRendererElements): TabRenderer {
  let dragEnabled = true;
  let tabRows = new Map<number, HTMLElement>();
  let groupRows = new Map<number, HTMLElement>();
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
    render(items) {
      type PreparedRow = {
        node: HTMLElement;
        item: TabListItem;
      };

      const prepared: PreparedRow[] = [];
      const nextTabRows = new Map<number, HTMLElement>();
      const nextGroupRows = new Map<number, HTMLElement>();
      for (const item of items) {
        if (item.kind === "tab") {
          if (nextTabRows.has(item.tab.id)) {
            throw new Error(`重复标签 ID: ${item.tab.id}`);
          }
          const row = tabRows.get(item.tab.id) ?? createTabRow(item.tab, dragEnabled);
          nextTabRows.set(item.tab.id, row);
          prepared.push({ node: row, item });
        } else {
          if (nextGroupRows.has(item.group.id)) {
            throw new Error(`重复分组 ID: ${item.group.id}`);
          }
          const row = groupRows.get(item.group.id) ?? createGroupRow(item.group);
          nextGroupRows.set(item.group.id, row);
          prepared.push({ node: row, item });
        }
      }

      for (const [index, preparedRow] of prepared.entries()) {
        const current = list.children[index] ?? null;
        if (current !== preparedRow.node) {
          list.insertBefore(preparedRow.node, current);
        }
      }
      for (const [id, row] of tabRows) {
        if (!nextTabRows.has(id)) row.remove();
      }
      for (const [id, row] of groupRows) {
        if (!nextGroupRows.has(id)) row.remove();
      }
      for (const preparedRow of prepared) {
        if (preparedRow.item.kind === "tab") {
          updateTabRow(preparedRow.node, preparedRow.item.tab, dragEnabled);
        } else {
          updateGroupRow(preparedRow.node, preparedRow.item.group);
        }
      }
      tabRows = nextTabRows;
      groupRows = nextGroupRows;
      empty.hidden = items.length !== 0;
    },

    patchTab(tab) {
      const row = tabRows.get(tab.id);
      if (row) {
        updateTabRow(row, tab, dragEnabled);
      }
    },

    patchGroup(group) {
      const row = groupRows.get(group.id);
      if (row) {
        updateGroupRow(row, group);
      }
    },

    removeTab(id) {
      const row = tabRows.get(id);
      tabRows.delete(id);
      row?.remove();
      empty.hidden = list.childElementCount !== 0;
    },

    setDragEnabled(enabled) {
      dragEnabled = enabled;
      for (const row of tabRows.values()) {
        updateRowDragState(row, enabled);
      }
    },

    destroy() {
      list.removeEventListener("error", onFaviconError, true);
      tabRows.clear();
      groupRows.clear();
    },
  };
}

function createGroupRow(group: TabGroupViewModel): HTMLElement {
  const row = document.createElement("div");
  row.className = "tab-group-row";
  row.setAttribute("role", "listitem");

  const main = document.createElement("button");
  main.className = "tab-group-main";
  main.type = "button";
  main.dataset.action = "toggle-group";

  const chevron = document.createElement("span");
  chevron.className = "tab-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";

  const color = document.createElement("span");
  color.className = "tab-group-color";
  color.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "tab-group-title";

  main.append(chevron, color, title);
  row.append(main);
  updateGroupRow(row, group);
  return row;
}

function updateGroupRow(row: HTMLElement, group: TabGroupViewModel): void {
  const main = row.querySelector<HTMLButtonElement>(".tab-group-main");
  const color = row.querySelector<HTMLElement>(".tab-group-color");
  const title = row.querySelector<HTMLElement>(".tab-group-title");
  if (!main || !color || !title) return;

  const displayTitle = group.title || "未命名分组";
  row.dataset.groupId = String(group.id);
  row.dataset.collapsed = String(group.collapsed);
  main.setAttribute("aria-expanded", String(!group.collapsed));
  main.setAttribute("aria-label", `${displayTitle}，${group.collapsed ? "已折叠" : "已展开"}`);
  color.dataset.color = group.color;
  title.textContent = displayTitle;
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
