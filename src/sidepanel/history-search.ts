export type HistorySearchApi = Pick<typeof chrome.history, "search">;

export type HistorySearchResult = {
  id: string;
  title: string;
  url: string;
};

export async function searchHistory(
  api: HistorySearchApi,
  text: string,
): Promise<HistorySearchResult[]> {
  let items: chrome.history.HistoryItem[];
  try {
    items = await api.search({ text, startTime: 0, maxResults: 200 });
  } catch {
    throw new Error("无法读取历史记录");
  }

  const results: HistorySearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const item of items) {
    if (results.length === 20) break;
    const result = normalizeHistoryItem(item);
    if (!result || seenUrls.has(result.url)) continue;
    seenUrls.add(result.url);
    results.push(result);
  }
  return results;
}

function normalizeHistoryItem(
  item: chrome.history.HistoryItem,
): HistorySearchResult | undefined {
  if (!item.url) return undefined;
  try {
    const url = new URL(item.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return {
      id: item.id || url.href,
      title: item.title?.trim() || url.hostname,
      url: url.href,
    };
  } catch {
    return undefined;
  }
}

export type HistorySearchController = {
  close(): void;
  setFaviconsByOrigin(favicons: ReadonlyMap<string, string>): void;
  destroy(): void;
};

export function createHistorySearchController(
  elements: { document: Document; input: HTMLInputElement; results: HTMLElement },
  callbacks: {
    history: HistorySearchApi;
    onOpen(url: string): void | Promise<void>;
    onOpenError?(message: string): void;
  },
): HistorySearchController {
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentResults: HistorySearchResult[] = [];
  let selectedIndex = -1;
  let openBusy = false;
  let faviconsByOrigin = new Map<string, string>();

  if (!elements.results.id) elements.results.id = "history-search-results";
  elements.input.setAttribute("role", "combobox");
  elements.input.setAttribute("aria-autocomplete", "list");
  elements.input.setAttribute("aria-controls", elements.results.id);
  elements.input.setAttribute("aria-expanded", "false");

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const showPanel = (): void => {
    elements.results.hidden = false;
    elements.input.setAttribute("aria-expanded", "true");
  };

  const renderMessage = (message: string): void => {
    currentResults = [];
    selectedIndex = -1;
    elements.input.removeAttribute("aria-activedescendant");
    const status = elements.document.createElement("div");
    status.className = "history-search-message";
    status.textContent = message;
    elements.results.replaceChildren(status);
    showPanel();
  };

  const syncSelection = (): void => {
    const options = Array.from(
      elements.results.querySelectorAll<HTMLElement>("[role='option']"),
    );
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === selectedIndex));
    });
    const selected = options[selectedIndex];
    if (selected) {
      elements.input.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView?.({ block: "nearest" });
    } else {
      elements.input.removeAttribute("aria-activedescendant");
    }
  };

  const createFallback = (): HTMLElement => {
    const fallback = elements.document.createElement("span");
    fallback.className = "site-favicon-fallback history-favicon-fallback";
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  };

  const createOption = (item: HistorySearchResult, index: number): HTMLButtonElement => {
    const option = elements.document.createElement("button");
    option.className = "history-search-option";
    option.type = "button";
    option.id = `history-option-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`;
    option.dataset.historyIndex = String(index);
    option.setAttribute("role", "option");

    const origin = getHttpOrigin(item.url);
    const candidates = createFaviconCandidates(faviconsByOrigin.get(origin), item.url);
    if (candidates.length > 0) {
      const image = elements.document.createElement("img");
      image.className = "history-favicon-image";
      image.src = candidates[0] as string;
      image.alt = "";
      image.width = 16;
      image.height = 16;
      image.dataset.nextUrl = candidates[1] ?? "";
      option.append(image);
    } else {
      option.append(createFallback());
    }

    const title = elements.document.createElement("span");
    title.className = "history-search-title";
    title.textContent = item.title;
    option.append(title);
    return option;
  };

  const renderResults = (items: HistorySearchResult[], query: string): void => {
    currentResults = items;
    if (items.length === 0) {
      renderMessage(query ? "没有匹配的历史记录" : "暂无历史记录");
      return;
    }
    selectedIndex = 0;
    const fragment = elements.document.createDocumentFragment();
    items.forEach((item, index) => fragment.append(createOption(item, index)));
    elements.results.replaceChildren(fragment);
    showPanel();
    syncSelection();
  };

  const runQuery = async (query: string): Promise<void> => {
    const queryGeneration = ++generation;
    renderMessage("正在搜索…");
    try {
      const items = await searchHistory(callbacks.history, query);
      if (!active || queryGeneration !== generation) return;
      renderResults(items, query);
    } catch {
      if (!active || queryGeneration !== generation) return;
      renderMessage("无法读取历史记录");
    }
  };

  const close = (): void => {
    generation += 1;
    clearTimer();
    currentResults = [];
    selectedIndex = -1;
    elements.results.hidden = true;
    elements.input.setAttribute("aria-expanded", "false");
    elements.input.removeAttribute("aria-activedescendant");
  };

  const openResult = async (index: number): Promise<void> => {
    const item = currentResults[index];
    if (!item || openBusy) return;
    openBusy = true;
    try {
      await callbacks.onOpen(item.url);
      if (!active) return;
      elements.input.value = "";
      close();
    } catch {
      if (active) callbacks.onOpenError?.("无法打开历史记录");
    } finally {
      openBusy = false;
    }
  };

  const reopen = (): void => {
    if (elements.results.hidden) void runQuery(elements.input.value);
  };

  const onInput = (): void => {
    generation += 1;
    clearTimer();
    renderMessage("正在搜索…");
    timer = setTimeout(() => {
      timer = undefined;
      if (active) void runQuery(elements.input.value);
    }, 100);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (elements.results.hidden || currentResults.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      selectedIndex = (selectedIndex + delta + currentResults.length) % currentResults.length;
      syncSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void openResult(selectedIndex);
    }
  };

  const onResultsClick = (event: MouseEvent): void => {
    const option = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-history-index]")
      : null;
    if (!option || !elements.results.contains(option)) return;
    void openResult(Number(option.dataset.historyIndex));
  };

  const onImageError = (event: Event): void => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !elements.results.contains(image)) return;
    const nextUrl = image.dataset.nextUrl;
    if (nextUrl) {
      image.dataset.nextUrl = "";
      image.src = nextUrl;
    } else {
      image.replaceWith(createFallback());
    }
  };

  const onDocumentPointerDown = (event: Event): void => {
    const target = event.target;
    if (
      !elements.results.hidden &&
      target instanceof Node &&
      target !== elements.input &&
      !elements.results.contains(target)
    ) {
      close();
    }
  };

  elements.input.addEventListener("focus", reopen);
  elements.input.addEventListener("click", reopen);
  elements.input.addEventListener("input", onInput);
  elements.input.addEventListener("keydown", onKeyDown);
  elements.results.addEventListener("click", onResultsClick);
  elements.results.addEventListener("error", onImageError, true);
  elements.document.addEventListener("pointerdown", onDocumentPointerDown);

  return {
    close,
    setFaviconsByOrigin(favicons) {
      if (!active) return;
      faviconsByOrigin = new Map(favicons);
      if (!elements.results.hidden && currentResults.length > 0) {
        const currentSelection = selectedIndex;
        renderResults(currentResults, elements.input.value);
        selectedIndex = currentSelection;
        syncSelection();
      }
    },
    destroy() {
      if (!active) return;
      close();
      active = false;
      elements.input.removeEventListener("focus", reopen);
      elements.input.removeEventListener("click", reopen);
      elements.input.removeEventListener("input", onInput);
      elements.input.removeEventListener("keydown", onKeyDown);
      elements.results.removeEventListener("click", onResultsClick);
      elements.results.removeEventListener("error", onImageError, true);
      elements.document.removeEventListener("pointerdown", onDocumentPointerDown);
    },
  };
}
import { createFaviconCandidates, getHttpOrigin } from "./favicon-model";
