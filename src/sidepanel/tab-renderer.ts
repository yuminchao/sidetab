import type { TabGroupViewModel } from "./tab-group-model";
import type {
  TabGroupDecoration,
  TabListItem,
  TabTreeDecoration,
} from "./tab-list-model";
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
  setTabDragEnabled(enabled: boolean): void;
  destroy(): void;
};

export function createTabRenderer({ list, empty }: TabRendererElements): TabRenderer {
  let dragEnabled = true;
  let tabDragEnabled = true;
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

    container.replaceChildren(createFaviconFallback());
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
          const row = tabRows.get(item.tab.id) ?? createTabRow(item.tab, tabDragEnabled);
          nextTabRows.set(item.tab.id, row);
          prepared.push({ node: row, item });
        } else {
          if (nextGroupRows.has(item.group.id)) {
            throw new Error(`重复分组 ID: ${item.group.id}`);
          }
          const row = groupRows.get(item.group.id)
            ?? createGroupRow(item.group, item.count, dragEnabled);
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
          updateTabRow(
            preparedRow.node,
            preparedRow.item.tab,
            tabDragEnabled,
            preparedRow.item.group,
            preparedRow.item.tree,
          );
        } else {
          updateGroupRow(
            preparedRow.node,
            preparedRow.item.group,
            dragEnabled,
            preparedRow.item.count,
          );
        }
      }
      tabRows = nextTabRows;
      groupRows = nextGroupRows;
      empty.hidden = items.length !== 0;
    },

    patchTab(tab) {
      const row = tabRows.get(tab.id);
      if (row) {
        patchTabRow(row, tab, tabDragEnabled);
      }
    },

    patchGroup(group) {
      const row = groupRows.get(group.id);
      if (row) {
        updateGroupRow(row, group, dragEnabled);
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
      tabDragEnabled = enabled;
      for (const row of tabRows.values()) {
        updateRowDragState(row, enabled);
      }
      for (const row of groupRows.values()) {
        updateRowDragState(row, enabled);
      }
    },

    setTabDragEnabled(enabled) {
      tabDragEnabled = enabled;
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

function createGroupRow(
  group: TabGroupViewModel,
  count: number,
  dragEnabled: boolean,
): HTMLElement {
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

  const title = document.createElement("span");
  title.className = "tab-group-title";

  const countElement = document.createElement("span");
  countElement.className = "tab-group-count";
  countElement.setAttribute("aria-hidden", "true");

  main.append(chevron, title, countElement);
  row.append(main);
  updateGroupRow(row, group, dragEnabled, count);
  return row;
}

function updateGroupRow(
  row: HTMLElement,
  group: TabGroupViewModel,
  dragEnabled: boolean,
  count?: number,
): void {
  const main = row.querySelector<HTMLButtonElement>(".tab-group-main");
  const title = row.querySelector<HTMLElement>(".tab-group-title");
  const countElement = row.querySelector<HTMLElement>(".tab-group-count");
  if (!main || !title || !countElement) return;

  if (count !== undefined) {
    countElement.textContent = String(count);
  }

  const displayTitle = group.title || "未命名分组";
  const displayCount = countElement.textContent ?? "0";
  row.dataset.groupId = String(group.id);
  row.dataset.groupColor = group.color;
  row.dataset.collapsed = String(group.collapsed);
  updateRowDragState(row, dragEnabled);
  main.setAttribute("aria-expanded", String(!group.collapsed));
  main.setAttribute(
    "aria-label",
    `${displayTitle}，包含 ${displayCount} 个标签页，${group.collapsed ? "已折叠" : "已展开"}`,
  );
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

  const treeToggle = document.createElement("button");
  treeToggle.className = "tab-tree-toggle";
  treeToggle.type = "button";
  treeToggle.dataset.action = "toggle-tree";
  treeToggle.textContent = ">";
  treeToggle.hidden = true;

  const treeLeaf = document.createElement("span");
  treeLeaf.className = "tab-tree-leaf";
  treeLeaf.setAttribute("aria-hidden", "true");
  treeLeaf.hidden = true;

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

  row.append(treeToggle, treeLeaf, main, close);
  patchTabRow(row, tab, dragEnabled);
  return row;
}

function updateTabRow(
  row: HTMLElement,
  tab: TabViewModel,
  dragEnabled: boolean,
  group: TabGroupDecoration | undefined,
  tree: TabTreeDecoration | undefined,
): void {
  patchTabRow(row, tab, dragEnabled);
  updateGroupDecoration(row, group);
  updateTreeDecoration(row, tree);
}

function updateTreeDecoration(
  row: HTMLElement,
  tree: TabTreeDecoration | undefined,
): void {
  const toggle = row.querySelector<HTMLButtonElement>(".tab-tree-toggle");
  const leaf = row.querySelector<HTMLElement>(".tab-tree-leaf");
  if (!tree) {
    delete row.dataset.treeDepth;
    delete row.dataset.treeParent;
    row.style.removeProperty("--tab-tree-indent");
    row.removeAttribute("aria-level");
    delete row.dataset.activeDescendant;
    if (toggle) toggle.hidden = true;
    if (leaf) leaf.hidden = true;
    return;
  }

  const visualDepth = Math.min(tree.depth, 4);
  row.dataset.treeDepth = String(tree.depth);
  row.dataset.treeParent = String(tree.hasChildren);
  row.dataset.activeDescendant = String(tree.containsActiveDescendant);
  row.style.setProperty("--tab-tree-indent", `${visualDepth * 12}px`);
  row.setAttribute("aria-level", String(tree.depth + 1));
  if (leaf) leaf.hidden = tree.hasChildren || tree.depth === 0;
  if (!toggle) return;
  toggle.hidden = !tree.hasChildren;
  toggle.setAttribute("aria-expanded", String(!tree.collapsed));
  toggle.setAttribute(
    "aria-label",
    tree.collapsed && tree.containsActiveDescendant
      ? "展开子标签，包含当前标签"
      : tree.collapsed
        ? "展开子标签"
        : "折叠子标签",
  );
}

function patchTabRow(row: HTMLElement, tab: TabViewModel, dragEnabled: boolean): void {
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

function updateGroupDecoration(
  row: HTMLElement,
  group: TabGroupDecoration | undefined,
): void {
  if (!group) {
    delete row.dataset.groupId;
    delete row.dataset.groupColor;
    delete row.dataset.groupPosition;
    return;
  }

  row.dataset.groupId = String(group.groupId);
  row.dataset.groupColor = group.color;
  row.dataset.groupPosition = group.position;
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
  const sourceChanged = container.dataset.candidatesKey !== candidatesKey;

  if (sourceChanged) {
    container.replaceChildren(createFavicon(candidates));
    container.dataset.candidatesKey = candidatesKey;
  }
}

function createFavicon(candidates: readonly string[]): HTMLElement {
  const [faviconUrl, nextUrl = ""] = candidates;
  if (!faviconUrl) {
    return createFaviconFallback();
  }

  const image = document.createElement("img");
  image.className = "tab-favicon-image";
  image.src = faviconUrl;
  image.loading = "lazy";
  image.width = 16;
  image.height = 16;
  image.alt = "";
  image.dataset.nextUrl = nextUrl;
  return image;
}

function createFaviconFallback(): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "site-favicon-fallback tab-favicon-fallback";
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
}
