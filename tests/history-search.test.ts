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

describe("history search model", () => {
  it("queries all time with a five-hundred-candidate limit", async () => {
    const search = vi.fn(async () => [
      historyItem("1", "https://first.example/path", "First"),
    ]);

    await expect(searchHistory({ search }, "docs")).resolves.toEqual([
      { id: "1", title: "First", url: "https://first.example/path" },
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
      { id: "first", title: "First", url: "https://first.example/" },
      { id: "second", title: "second.example", url: "http://second.example/path" },
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
        title: "Newest",
        url: "https://example.com/page/?utm=new#top",
      },
      { id: "subdomain", title: "Subdomain", url: "https://www.example.com/page" },
      { id: "port", title: "Port", url: "https://example.com:8443/page" },
      { id: "case", title: "Case", url: "https://example.com/Page" },
      { id: "other", title: "Other", url: "https://example.com/other" },
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

  it("shows recent history on focus and prefers the current-origin favicon", async () => {
    const search = vi.fn(async () => [
      historyItem("1", "https://docs.example/page", "Documentation"),
    ]);
    const controller = createHistorySearchController(
      { document, input, results },
      { history: { search }, onOpen: vi.fn(async () => undefined) },
    );
    controller.setFaviconsByOrigin(
      new Map([["https://docs.example", "data:image/png;base64,current"]]),
    );

    input.focus();
    await flush();

    expect(search).toHaveBeenCalledWith({ text: "", startTime: 0, maxResults: 500 });
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
      { history: { search }, onOpen: vi.fn(async () => undefined) },
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
      { history: { search }, onOpen: vi.fn(async () => undefined) },
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

  it("renders distinct empty and failure states", async () => {
    vi.useFakeTimers();
    const search = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("failed"));
    const controller = createHistorySearchController(
      { document, input, results },
      { history: { search }, onOpen: vi.fn(async () => undefined) },
    );

    input.focus();
    await flush();
    expect(results.textContent).toBe("暂无历史记录");

    input.value = "missing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(results.textContent).toBe("没有匹配的历史记录");

    input.value = "failed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(results.textContent).toBe("无法读取历史记录");
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
      { history: { search }, onOpen },
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
    const controller = createHistorySearchController(
      { document, input, results },
      { history: { search }, onOpen, onOpenError },
    );

    input.value = "keep";
    input.focus();
    await flush();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(onOpenError).toHaveBeenCalledWith("无法打开历史记录");
    expect(results.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("keep");
    expect(results.hidden).toBe(true);
    input.click();
    await flush();
    results.querySelector<HTMLElement>("[role='option']")!.click();
    await flush();
    expect(onOpen).toHaveBeenLastCalledWith("https://one.example/");
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
      { history: { search }, onOpen: vi.fn(async () => undefined) },
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
      { history: { search }, onOpen },
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
      { history: { search }, onOpen: vi.fn(async () => undefined) },
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

  it("drops stale responses and blocks late DOM changes after destroy", async () => {
    vi.useFakeTimers();
    const old = deferred<chrome.history.HistoryItem[]>();
    const latest = deferred<chrome.history.HistoryItem[]>();
    const search = vi.fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const controller = createHistorySearchController(
      { document, input, results },
      { history: { search }, onOpen: vi.fn(async () => undefined) },
    );

    input.value = "old";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    input.value = "latest";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    latest.resolve([historyItem("2", "https://latest.example/", "Latest")]);
    await flush();
    old.resolve([historyItem("1", "https://old.example/", "Old")]);
    await flush();
    expect(results.textContent).toContain("Latest");
    expect(results.textContent).not.toContain("Old");

    input.value = "destroyed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    controller.destroy();
    const before = results.innerHTML;
    await vi.advanceTimersByTimeAsync(100);
    expect(results.innerHTML).toBe(before);
  });
});
