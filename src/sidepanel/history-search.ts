import { searchBookmarks, type BookmarkSearchApi } from "./bookmark-search";
import {
  createSearchResult,
  mergeSearchResults,
  type SearchResult,
} from "./search-result-model";

export type HistorySearchApi = Pick<typeof chrome.history, "search">;

export type HistorySearchResult = SearchResult;

export async function searchHistory(
  api: HistorySearchApi,
  text: string,
): Promise<HistorySearchResult[]> {
  let items: chrome.history.HistoryItem[];
  try {
    items = await api.search({ text, startTime: 0, maxResults: 500 });
  } catch {
    throw new Error("无法读取历史记录");
  }

  const results: HistorySearchResult[] = [];
  const seenKeys = new Set<string>();
  for (const item of items) {
    if (results.length === 20) break;
    const normalized = item.url
      ? createSearchResult({
          id: item.id || item.url,
          title: item.title || "",
          url: item.url,
          source: "history",
        })
      : undefined;
    if (!normalized || seenKeys.has(normalized.dedupeKey)) continue;
    seenKeys.add(normalized.dedupeKey);
    results.push(
      item.id ? normalized.result : { ...normalized.result, id: normalized.result.url },
    );
  }
  return results;
}

export type HistorySearchController = {
  close(): void;
  setFaviconsByOrigin(favicons: ReadonlyMap<string, string>): void;
  destroy(): void;
};

export function createHistorySearchController(
  elements: { document: Document; input: HTMLInputElement; results: HTMLElement },
  callbacks: {
    bookmarks: BookmarkSearchApi;
    history: HistorySearchApi;
    onOpen(url: string): void | Promise<void>;
    onOpenError?(message: string): void;
  },
): HistorySearchController {
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let currentResults: SearchResult[] = [];
  let selectedIndex = -1;
  let openGeneration: number | undefined;
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

  const clearBlurTimer = (): void => {
    if (blurTimer !== undefined) {
      clearTimeout(blurTimer);
      blurTimer = undefined;
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

  const createOption = (item: SearchResult, index: number): HTMLButtonElement => {
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

    const source = elements.document.createElement("span");
    source.className = "history-search-source";
    source.dataset.source = item.source;
    source.textContent = item.source === "bookmark" ? "收藏夹" : "历史记录";
    option.append(source);
    return option;
  };

  const renderResults = (items: SearchResult[], query: string): void => {
    currentResults = items;
    if (items.length === 0) {
      renderMessage(query ? "没有匹配的记录" : "暂无历史记录");
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
    const trimmedQuery = query.trim();
    renderMessage("正在搜索…");

    if (!trimmedQuery) {
      try {
        const items = await searchHistory(callbacks.history, "");
        if (!active || queryGeneration !== generation) return;
        renderResults(items, "");
      } catch {
        if (!active || queryGeneration !== generation) return;
        renderMessage("无法读取历史记录");
      }
      return;
    }

    const [bookmarkResult, historyResult] = await Promise.allSettled([
      searchBookmarks(callbacks.bookmarks, trimmedQuery),
      searchHistory(callbacks.history, trimmedQuery),
    ]);
    if (!active || queryGeneration !== generation) return;
    if (bookmarkResult.status === "rejected" && historyResult.status === "rejected") {
      renderMessage("无法读取搜索记录");
      return;
    }

    const bookmarks = bookmarkResult.status === "fulfilled" ? bookmarkResult.value : [];
    const history = historyResult.status === "fulfilled" ? historyResult.value : [];
    renderResults(mergeSearchResults(bookmarks, history), trimmedQuery);
  };

  const close = (): void => {
    generation += 1;
    clearTimer();
    clearBlurTimer();
    currentResults = [];
    selectedIndex = -1;
    elements.results.hidden = true;
    elements.input.setAttribute("aria-expanded", "false");
    elements.input.removeAttribute("aria-activedescendant");
  };

  const openResult = async (index: number): Promise<void> => {
    const item = currentResults[index];
    const resultGeneration = generation;
    if (!item || openGeneration === resultGeneration) return;
    openGeneration = resultGeneration;
    try {
      await callbacks.onOpen(item.url);
      if (!active || resultGeneration !== generation) return;
      elements.input.value = "";
      close();
    } catch {
      if (active && resultGeneration === generation) {
        callbacks.onOpenError?.("无法打开搜索结果");
      }
    } finally {
      if (openGeneration === resultGeneration) openGeneration = undefined;
    }
  };

  const reopen = (): void => {
    clearBlurTimer();
    if (elements.results.hidden) void runQuery(elements.input.value);
  };

  const onBlur = (): void => {
    clearBlurTimer();
    blurTimer = setTimeout(() => {
      blurTimer = undefined;
      if (active) close();
    }, 0);
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
  elements.input.addEventListener("blur", onBlur);
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
      elements.input.removeEventListener("blur", onBlur);
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
