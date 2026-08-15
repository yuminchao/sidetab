import { describe, expect, it } from "vitest";
import {
  createSearchResult,
  mergeSearchResults,
  type SearchResult,
} from "../src/sidepanel/search-result-model";

function result(
  id: string,
  source: SearchResult["source"],
  url: string,
  title = "Title",
): SearchResult {
  return { id, source, url, title };
}

describe("search result model", () => {
  it("normalizes web URLs and rejects non-web protocols", () => {
    expect(
      createSearchResult(result("one", "bookmark", "https://user:pass@example.com/path///?q=1#top", "  ")),
    ).toEqual({
      result: {
        id: "one",
        source: "bookmark",
        title: "example.com",
        url: "https://user:pass@example.com/path///?q=1#top",
      },
      dedupeKey: "example.com/path",
    });
    expect(createSearchResult(result("two", "history", "chrome://settings/"))).toBeUndefined();
    expect(createSearchResult(result("three", "history", "not a url"))).toBeUndefined();
    expect(createSearchResult(result("root", "history", "https://example.com///"))?.dedupeKey).toBe(
      "example.com/",
    );
  });

  it("keeps at most five bookmarks first and fills the remaining slots with history", () => {
    const bookmarks = Array.from({ length: 7 }, (_, index) =>
      result(`b${index}`, "bookmark", `https://bookmark-${index}.example/`),
    );
    const history = Array.from({ length: 20 }, (_, index) =>
      result(`h${index}`, "history", `https://history-${index}.example/`),
    );

    const merged = mergeSearchResults(bookmarks, history);

    expect(merged).toHaveLength(20);
    expect(merged.slice(0, 5).map((item) => item.id)).toEqual(["b0", "b1", "b2", "b3", "b4"]);
    expect(merged.at(-1)?.id).toBe("h14");
  });

  it("keeps the bookmark when both sources have the same normalized address", () => {
    const merged = mergeSearchResults(
      [result("bookmark", "bookmark", "https://example.com/page/")],
      [result("history", "history", "http://example.com/page?source=history")],
    );

    expect(merged).toEqual([
      {
        id: "bookmark",
        source: "bookmark",
        title: "Title",
        url: "https://example.com/page/",
      },
    ]);
  });

  it("deduplicates bookmarks before filling remaining results with history", () => {
    const merged = mergeSearchResults(
      [
        result("first-bookmark", "bookmark", "https://example.com/docs/"),
        result("duplicate-bookmark", "bookmark", "http://example.com/docs?q=1"),
        result("second-bookmark", "bookmark", "https://bookmarks.example/second"),
      ],
      [
        result("duplicate-history", "history", "https://example.com/docs#history"),
        result("first-history", "history", "https://history.example/one"),
        result("second-history", "history", "https://history.example/two"),
      ],
    );

    expect(merged.map((item) => item.id)).toEqual([
      "first-bookmark",
      "second-bookmark",
      "first-history",
      "second-history",
    ]);
  });
});
