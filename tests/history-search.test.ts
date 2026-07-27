import { describe, expect, it, vi } from "vitest";
import { searchHistory } from "../src/sidepanel/history-search";

function historyItem(
  id: string,
  url: string | undefined,
  title = "",
): chrome.history.HistoryItem {
  return { id, url, title };
}

describe("history search model", () => {
  it("queries all time with a twenty-result limit", async () => {
    const search = vi.fn(async () => [
      historyItem("1", "https://first.example/path", "First"),
    ]);

    await expect(searchHistory({ search }, "docs")).resolves.toEqual([
      { id: "1", title: "First", url: "https://first.example/path" },
    ]);
    expect(search).toHaveBeenCalledWith({ text: "docs", startTime: 0, maxResults: 20 });
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

  it("maps Chrome history failures to a stable message", async () => {
    const search = vi.fn(async (): Promise<chrome.history.HistoryItem[]> => {
      throw new Error("browser failure");
    });

    await expect(searchHistory({ search }, "query")).rejects.toThrow("无法读取历史记录");
  });
});
