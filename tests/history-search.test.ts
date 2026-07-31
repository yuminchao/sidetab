import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHistorySearchController,
  searchHistory,
} from "../src/sidepanel/history-search";

function historyItem(
  id: string,
  url: string | undefined,
  title = "",
): chrome.history.HistoryItem {
  return { id, url, title };
}

function bookmark(
  id: string,
  url: string | undefined,
  title = "",
): chrome.bookmarks.BookmarkTreeNode {
  return { id, url, title, syncing: false };
}

function emptyBookmarks() {
  return {
    search: vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => []),
  };
}

describe("history search model", () => {
  it("queries all time with a five-hundred-candidate limit", async () => {
    const search = vi.fn(async () => [
      historyItem("1", "https://first.example/path", "First"),
    ]);

    await expect(searchHistory({ search }, "docs")).resolves.toEqual([
      { id: "1", source: "history", title: "First", url: "https://first.example/path" },
    ]);
    expect(search).toHaveBeenCalledWith({ text: "docs", startTime: 0, maxResults: 500 });
  });

  it("preserves order while filtering invalid and non-web results", async () => {
    const search = vi.fn(async () => [
      historyItem("first", "https://first.example/", "  First  "),
      historyItem("missing", undefined, "Missing"),
      historyItem("chrome", "chrome://settings/", "Settings"),
      historyItem("broken", "not a url", "Broken"),
      historyItem("second", "http://second.example/path", ""),
    ]);

    await expect(searchHistory({ search }, "")).resolves.toEqual([
      { id: "first", source: "history", title: "First", url: "https://first.example/" },
      { id: "second", source: "history", title: "second.example", url: "http://second.example/path" },
    ]);
  });

  it("uses the normalized URL as the fallback ID", async () => {
    const search = vi.fn(async () => [
      historyItem("", "HTTPS://EXAMPLE.COM:443/a/../b", "Normalized"),
    ]);

    await expect(searchHistory({ search }, "")).resolves.toEqual([
      {
        id: "https://example.com/b",
        source: "history",
        title: "Normalized",
        url: "https://example.com/b",
      },
    ]);
  });

  it("returns at most twenty normalized results", async () => {
    const search = vi.fn(async () =>
      Array.from({ length: 24 }, (_, index) =>
        historyItem(String(index), `https://site-${index}.example/`, `Site ${index}`),
      ),
    );

    const result = await searchHistory({ search }, "site");

    expect(result).toHaveLength(20);
    expect(result[0]?.id).toBe("0");
    expect(result.at(-1)?.id).toBe("19");
  });

  it("deduplicates complete URLs before taking twenty results", async () => {
    const duplicates = Array.from({ length: 20 }, (_, index) =>
      historyItem(
        String(index),
        `https://site-${index % 10}.example/path`,
        `Recent ${index}`,
      ),
    );
    const tail = Array.from({ length: 10 }, (_, index) =>
      historyItem(
        `tail-${index}`,
        `https://tail-${index}.example/path`,
        `Tail ${index}`,
      ),
    );
    const search = vi.fn(async () => [...duplicates, ...tail]);

    const result = await searchHistory({ search }, "docs");

    expect(result).toHaveLength(20);
    expect(result.filter((item) => item.url === "https://site-0.example/path")).toHaveLength(1);
    expect(result.find((item) => item.url === "https://site-0.example/path")?.title).toBe(
      "Recent 0",
    );
    expect(result.at(-1)?.url).toBe("https://tail-9.example/path");
  });

  it("deduplicates by host and normalized path while preserving the newest full URL", async () => {
    const search = vi.fn(async () => [
      historyItem("newest", "https://example.com/page/?utm=new#top", "Newest"),
      historyItem("scheme", "http://example.com/page", "Scheme"),
      historyItem("query", "https://example.com/page?utm=old", "Query"),
      historyItem("credentials", "https://user:pass@example.com/page", "Credentials"),
      historyItem("subdomain", "https://www.example.com/page", "Subdomain"),
      historyItem("port", "https://example.com:8443/page", "Port"),
      historyItem("case", "https://example.com/Page", "Case"),
      historyItem("other", "https://example.com/other", "Other"),
    ]);

    await expect(searchHistory({ search }, "docs")).resolves.toEqual([
      {
        id: "newest",
        source: "history",
        title: "Newest",
        url: "https://example.com/page/?utm=new#top",
      },
      { id: "subdomain", source: "history", title: "Subdomain", url: "https://www.example.com/page" },
      { id: "port", source: "history", title: "Port", url: "https://example.com:8443/page" },
      { id: "case", source: "history", title: "Case", url: "https://example.com/Page" },
      { id: "other", source: "history", title: "Other", url: "https://example.com/other" },
    ]);
    expect(search).toHaveBeenCalledWith({ text: "docs", startTime: 0, maxResults: 500 });
  });

  it("maps Chrome history failures to a stable message", async () => {
    const search = vi.fn(async (): Promise<chrome.history.HistoryItem[]> => {
      throw new Error("browser failure");
    });

    await expect(searchHistory({ search }, "query")).rejects.toThrow("无法读取历史记录");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("history search controller", () => {
  let input: HTMLInputElement;
  let results: HTMLElement;

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = `
      <div id="toolbar">
        <input id="search" />
        <div id="results" role="listbox" hidden></div>
        <button id="outside">Outside</button>
      </div>`;
    input = document.querySelector("#search")!;
    results = document.querySelector("#results")!;
  });

  it("shows recent history on focus without querying bookmarks for a blank input", async () => {
    const historySearch = vi.fn(async () => [
      historyItem("1", "https://docs.example/page", "Documentation"),
    ]);
    const bookmarkSearch = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => []);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );
    controller.setFaviconsByOrigin(
      new Map([["https://docs.example", "data:image/png;base64,current"]]),
    );

    input.value = "   ";
    input.focus();
    await flush();

    expect(bookmarkSearch).not.toHaveBeenCalled();
    expect(historySearch).toHaveBeenCalledWith({ text: "", startTime: 0, maxResults: 500 });
    expect(results.hidden).toBe(false);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const option = results.querySelector<HTMLElement>("[role='option']")!;
    expect(option.textContent).toContain("Documentation");
    expect(option.textContent).not.toContain("https://docs.example/page");
    const image = option.querySelector<HTMLImageElement>("img")!;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,current");
    expect(image.dataset.nextUrl).toBe("https://docs.example/favicon.ico");
    controller.destroy();
  });

  it("uses a text-free network fallback after history favicon candidates fail", async () => {
    const search = vi.fn(async () => [
      historyItem("1", "https://docs.example/page", "Documentation"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: emptyBookmarks(),
        history: { search },
        onOpen: vi.fn(async () => undefined),
      },
    );
    input.focus();
    await flush();
    const image = results.querySelector<HTMLImageElement>("img")!;

    image.dispatchEvent(new Event("error"));

    const fallback = results.querySelector<HTMLElement>(
      ".site-favicon-fallback.history-favicon-fallback",
    );
    expect(fallback?.textContent).toBe("");
    expect(fallback?.getAttribute("aria-hidden")).toBe("true");
    expect(results.querySelector("img")).toBeNull();
    controller.destroy();
  });

  it("debounces input by 100ms and uses only the latest value", async () => {
    vi.useFakeTimers();
    const pending = deferred<chrome.history.HistoryItem[]>();
    const search = vi.fn(() => pending.promise);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: emptyBookmarks(),
        history: { search },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = "first";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "latest";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(results.textContent).toBe("正在搜索…");
    await vi.advanceTimersByTimeAsync(99);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({ text: "latest", startTime: 0, maxResults: 500 });

    pending.resolve([historyItem("1", "https://latest.example/", "Latest")]);
    await flush();
    expect(results.textContent).toContain("Latest");
    controller.destroy();
  });

  it("starts trimmed bookmark and history searches in parallel", async () => {
    vi.useFakeTimers();
    const bookmarkPending = deferred<chrome.bookmarks.BookmarkTreeNode[]>();
    const historyPending = deferred<chrome.history.HistoryItem[]>();
    const bookmarkSearch = vi.fn(() => bookmarkPending.promise);
    const historySearch = vi.fn(() => historyPending.promise);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = "  docs  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);

    expect(bookmarkSearch).toHaveBeenCalledOnce();
    expect(bookmarkSearch).toHaveBeenCalledWith("docs");
    expect(historySearch).toHaveBeenCalledOnce();
    expect(historySearch).toHaveBeenCalledWith({
      text: "docs",
      startTime: 0,
      maxResults: 500,
    });

    bookmarkPending.resolve([]);
    historyPending.resolve([]);
    await flush();
    controller.destroy();
  });

  it("pins five bookmarks, removes cross-source duplicates, and fills with history", async () => {
    const bookmarkSearch = vi.fn(async () => [
      bookmark("b-shared", "https://shared.example/docs/", "Bookmark Shared"),
      ...Array.from({ length: 4 }, (_, index) =>
        bookmark(`b-${index}`, `https://bookmark-${index}.example/`, `Bookmark ${index}`),
      ),
    ]);
    const historySearch = vi.fn(async () => [
      historyItem("h-shared", "http://shared.example/docs?from=history", "History Duplicate"),
      ...Array.from({ length: 20 }, (_, index) =>
        historyItem(`h-${index}`, `https://history-${index}.example/`, `History ${index}`),
      ),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = " records ";
    input.focus();
    await flush();

    const titles = Array.from(
      results.querySelectorAll<HTMLElement>(".history-search-title"),
      (element) => element.textContent,
    );
    expect(titles).toHaveLength(20);
    expect(titles.slice(0, 5)).toEqual([
      "Bookmark Shared",
      "Bookmark 0",
      "Bookmark 1",
      "Bookmark 2",
      "Bookmark 3",
    ]);
    expect(titles).not.toContain("History Duplicate");
    expect(titles.at(-1)).toBe("History 14");
    controller.destroy();
  });

  it("renders distinct empty and failure states", async () => {
    vi.useFakeTimers();
    const historySearch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("failed"));
    const bookmarkSearch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("failed"));
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.focus();
    await flush();
    expect(results.textContent).toBe("暂无历史记录");

    input.value = "missing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(results.textContent).toBe("没有匹配的记录");

    input.value = "failed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(results.textContent).toBe("无法读取搜索记录");
    controller.destroy();
  });

  it("shows history results when bookmark search fails", async () => {
    const bookmarkSearch = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
      throw new Error("bookmark failed");
    });
    const historySearch = vi.fn(async () => [
      historyItem("history", "https://history.example/", "History Result"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = "query";
    input.focus();
    await flush();

    expect(bookmarkSearch).toHaveBeenCalledOnce();
    expect(results.textContent).toContain("History Result");
    controller.destroy();
  });

  it("shows bookmark results when history search fails", async () => {
    const bookmarkSearch = vi.fn(async () => [
      bookmark("bookmark", "https://bookmark.example/", "Bookmark Result"),
    ]);
    const historySearch = vi.fn(async (): Promise<chrome.history.HistoryItem[]> => {
      throw new Error("history failed");
    });
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = "query";
    input.focus();
    await flush();

    expect(historySearch).toHaveBeenCalledOnce();
    expect(results.textContent).toContain("Bookmark Result");
    controller.destroy();
  });

  it("wraps keyboard selection and opens the selected result", async () => {
    const onOpen = vi.fn(async () => undefined);
    const search = vi.fn(async () => [
      historyItem("1", "https://one.example/", "One"),
      historyItem("2", "https://two.example/", "Two"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      { bookmarks: emptyBookmarks(), history: { search }, onOpen },
    );

    input.focus();
    await flush();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toContain("2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toContain("1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    expect(onOpen).toHaveBeenCalledWith("https://one.example/");
    expect(input.value).toBe("");
    expect(results.hidden).toBe(true);
    controller.destroy();
  });

  it("reports failed opens and supports click, Escape, Tab, outside, and explicit close", async () => {
    const onOpen = vi
      .fn()
      .mockRejectedValueOnce(new Error("无法打开历史记录"))
      .mockResolvedValueOnce(undefined);
    const onOpenError = vi.fn();
    const search = vi.fn(async () => [
      historyItem("1", "https://one.example/", "One"),
    ]);
    const bookmarkSearch = vi.fn(async () => [
      bookmark("bookmark", "https://bookmark.example/", "Bookmark"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      { bookmarks: { search: bookmarkSearch }, history: { search }, onOpen, onOpenError },
    );

    input.value = "keep";
    input.focus();
    await flush();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(onOpen).toHaveBeenCalledWith("https://bookmark.example/");
    expect(onOpenError).toHaveBeenCalledWith("无法打开搜索结果");
    expect(results.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("keep");
    expect(results.hidden).toBe(true);
    input.click();
    await flush();
    results.querySelector<HTMLElement>("[role='option']")!.click();
    await flush();
    expect(onOpen).toHaveBeenLastCalledWith("https://bookmark.example/");
    expect(results.hidden).toBe(true);

    input.click();
    await flush();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(results.hidden).toBe(true);
    input.click();
    await flush();
    document.querySelector<HTMLElement>("#outside")!.dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(results.hidden).toBe(true);
    input.click();
    await flush();
    controller.close();
    expect(results.hidden).toBe(true);
    controller.destroy();
  });

  it("closes after blur and cancels the pending close when focus returns", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [
      historyItem("1", "https://one.example/", "One"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: emptyBookmarks(),
        history: { search },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.focus();
    await flush();
    input.blur();
    expect(results.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(results.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");

    input.focus();
    await flush();
    input.blur();
    input.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(results.hidden).toBe(false);
    controller.destroy();
  });

  it("lets a result click finish before the deferred blur close", async () => {
    vi.useFakeTimers();
    const onOpen = vi.fn(async () => undefined);
    const search = vi.fn(async () => [
      historyItem("1", "https://one.example/", "One"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      { bookmarks: emptyBookmarks(), history: { search }, onOpen },
    );

    input.focus();
    await flush();
    const option = results.querySelector<HTMLButtonElement>("[role='option']")!;
    input.blur();
    option.click();
    await flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("https://one.example/");
    expect(results.hidden).toBe(true);
    controller.destroy();
  });

  it("clears a pending blur close when destroyed", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [
      historyItem("1", "https://one.example/", "One"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: emptyBookmarks(),
        history: { search },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.focus();
    await flush();
    input.blur();
    controller.destroy();
    const before = results.innerHTML;
    await vi.runAllTimersAsync();

    expect(results.innerHTML).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops stale combined responses and blocks both late sources after destroy", async () => {
    vi.useFakeTimers();
    const oldBookmarks = deferred<chrome.bookmarks.BookmarkTreeNode[]>();
    const oldHistory = deferred<chrome.history.HistoryItem[]>();
    const latestBookmarks = deferred<chrome.bookmarks.BookmarkTreeNode[]>();
    const latestHistory = deferred<chrome.history.HistoryItem[]>();
    const destroyedBookmarks = deferred<chrome.bookmarks.BookmarkTreeNode[]>();
    const destroyedHistory = deferred<chrome.history.HistoryItem[]>();
    const bookmarkSearch = vi.fn()
      .mockReturnValueOnce(oldBookmarks.promise)
      .mockReturnValueOnce(latestBookmarks.promise)
      .mockReturnValueOnce(destroyedBookmarks.promise);
    const historySearch = vi.fn()
      .mockReturnValueOnce(oldHistory.promise)
      .mockReturnValueOnce(latestHistory.promise)
      .mockReturnValueOnce(destroyedHistory.promise);
    const controller = createHistorySearchController(
      { document, input, results },
      {
        bookmarks: { search: bookmarkSearch },
        history: { search: historySearch },
        onOpen: vi.fn(async () => undefined),
      },
    );

    input.value = "old";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    input.value = "latest";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    latestBookmarks.resolve([
      bookmark("latest-bookmark", "https://latest-bookmark.example/", "Latest Bookmark"),
    ]);
    latestHistory.resolve([
      historyItem("latest-history", "https://latest-history.example/", "Latest History"),
    ]);
    await flush();
    oldBookmarks.resolve([
      bookmark("old-bookmark", "https://old-bookmark.example/", "Old Bookmark"),
    ]);
    oldHistory.resolve([
      historyItem("old-history", "https://old-history.example/", "Old History"),
    ]);
    await flush();
    expect(results.textContent).toContain("Latest Bookmark");
    expect(results.textContent).toContain("Latest History");
    expect(results.textContent).not.toContain("Old Bookmark");
    expect(results.textContent).not.toContain("Old History");

    input.value = "destroyed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(bookmarkSearch).toHaveBeenCalledTimes(3);
    expect(historySearch).toHaveBeenCalledTimes(3);
    controller.destroy();
    const before = results.innerHTML;
    destroyedBookmarks.resolve([
      bookmark("destroyed-bookmark", "https://destroyed-bookmark.example/", "Destroyed Bookmark"),
    ]);
    destroyedHistory.resolve([
      historyItem("destroyed-history", "https://destroyed-history.example/", "Destroyed History"),
    ]);
    await flush();
    expect(results.innerHTML).toBe(before);
  });
});
