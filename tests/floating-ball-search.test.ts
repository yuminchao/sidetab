import { describe, expect, it, vi } from "vitest";
import { searchBookmarksAndHistory } from "../src/floating-ball/search";

function result(source: "bookmark" | "history", id: string) {
  return { id, title: `${source}-${id}`, url: `https://${id}.example.com/`, source } as const;
}

describe("floating ball shared search", () => {
  it("returns recent history for an empty query", async () => {
    const recent = [result("history", "recent")];
    const bookmarks = { search: vi.fn() };
    const history = { search: vi.fn().mockResolvedValue([{ id: "recent", title: "Recent", url: "https://recent.example.com/" }]) };

    await expect(searchBookmarksAndHistory({ bookmarks, history }, " ")).resolves.toEqual([
      expect.objectContaining({ id: "recent", source: "history" }),
    ]);
    expect(bookmarks.search).not.toHaveBeenCalled();
  });

  it("keeps five bookmarks first and fills the remainder with history", async () => {
    const bookmarks = {
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 8 }, (_, index) => ({ id: `b${index}`, title: `B${index}`, url: `https://b${index}.example.com/` })),
      ),
    };
    const history = {
      search: vi.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, index) => ({ id: `h${index}`, title: `H${index}`, url: `https://h${index}.example.com/` })),
      ),
    };

    const results = await searchBookmarksAndHistory({ bookmarks, history }, "query");

    expect(results).toHaveLength(20);
    expect(results.slice(0, 5).every((item) => item.source === "bookmark")).toBe(true);
    expect(results[5]!.source).toBe("history");
  });

  it("fails only when both backing searches fail", async () => {
    const deps = {
      bookmarks: { search: vi.fn().mockRejectedValue(new Error("bookmarks")) },
      history: { search: vi.fn().mockRejectedValue(new Error("history")) },
    };

    await expect(searchBookmarksAndHistory(deps, "query")).rejects.toThrow("无法读取搜索记录");
  });
});
