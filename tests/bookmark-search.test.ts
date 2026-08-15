import { describe, expect, it, vi } from "vitest";
import { searchBookmarks } from "../src/sidepanel/bookmark-search";

function bookmark(
  id: string,
  url: string | undefined,
  title = "",
): chrome.bookmarks.BookmarkTreeNode {
  return { id, url, title, syncing: false };
}

describe("bookmark search", () => {
  it("passes the query text directly to Chrome bookmarks search exactly once", async () => {
    const search = vi.fn(async () => [bookmark("one", "https://first.example/path", "First")]);

    await expect(searchBookmarks({ search }, "docs")).resolves.toEqual([
      { id: "one", source: "bookmark", title: "First", url: "https://first.example/path" },
    ]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("docs");
  });

  it("preserves Chrome order while filtering duplicate folders and non-web or invalid nodes", async () => {
    const search = vi.fn(async () => [
      bookmark("first", "https://first.example/path/", "  First  "),
      bookmark("folder", undefined, "Folder"),
      bookmark("chrome", "chrome://settings/", "Settings"),
      bookmark("file", "file:///C:/notes.txt", "Notes"),
      bookmark("data", "data:text/plain,hello", "Data"),
      bookmark("broken", "not a url", "Broken"),
      bookmark("duplicate", "http://first.example/path?source=duplicate", "Duplicate"),
      bookmark("second", "https://second.example/page", "Second"),
    ]);

    await expect(searchBookmarks({ search }, "")).resolves.toEqual([
      { id: "first", source: "bookmark", title: "First", url: "https://first.example/path/" },
      { id: "second", source: "bookmark", title: "Second", url: "https://second.example/page" },
    ]);
  });

  it("uses the hostname when a bookmark title is empty after trimming", async () => {
    const search = vi.fn(async () => [bookmark("one", "https://docs.example/guide", "   ")]);

    await expect(searchBookmarks({ search }, "guide")).resolves.toEqual([
      { id: "one", source: "bookmark", title: "docs.example", url: "https://docs.example/guide" },
    ]);
  });

  it("returns at most five unique bookmarks in stable Chrome order", async () => {
    const search = vi.fn(async () =>
      Array.from({ length: 7 }, (_, index) =>
        bookmark(String(index), `https://site-${index}.example/path`, `Site ${index}`),
      ),
    );

    const results = await searchBookmarks({ search }, "site");

    expect(results).toHaveLength(5);
    expect(results.map((item) => item.id)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("maps Chrome bookmark failures to a stable error without exposing the cause", async () => {
    const search = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
      throw new Error("browser failure");
    });

    await expect(searchBookmarks({ search }, "query")).rejects.toEqual(new Error("无法读取收藏夹"));
  });

  it("does not modify Chrome bookmark nodes", async () => {
    const item = bookmark("one", "HTTPS://EXAMPLE.COM:443/a/../guide", "  Guide  ");
    const before = structuredClone(item);
    const search = vi.fn(async () => [item]);

    await searchBookmarks({ search }, "guide");

    expect(item).toEqual(before);
  });
});
