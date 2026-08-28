import { describe, expect, it } from "vitest";
import { createFakeChrome } from "./fake-chrome";

function bookmark(
  id: string,
  title: string,
  url?: string,
): chrome.bookmarks.BookmarkTreeNode {
  return { id, title, url, syncing: false };
}

describe("fake Chrome bookmarks", () => {
  it("filters string queries case-insensitively by title or URL in source order", async () => {
    const fake = createFakeChrome({
      bookmarkItems: [
        bookmark("title", "Alpha Guide", "https://docs.example/one"),
        bookmark("miss", "Unrelated", "https://other.example/"),
        bookmark("url", "Reference", "https://ALPHA.example/two"),
      ],
    });

    const results = await fake.bookmarks.search("alpha");

    expect(results.map((item) => item.id)).toEqual(["title", "url"]);
  });

  it("applies object query text with the same case-insensitive matching", async () => {
    const fake = createFakeChrome({
      bookmarkItems: [
        bookmark("title", "Release Notes", "https://docs.example/"),
        bookmark("url", "Docs", "https://example.com/RELEASES"),
        bookmark("miss", "Roadmap", "https://example.com/plan"),
      ],
    });

    const results = await fake.bookmarks.search({ query: "release" });

    expect(results.map((item) => item.id)).toEqual(["title", "url"]);
  });

  it("matches object title and URL filters exactly", async () => {
    const fake = createFakeChrome({
      bookmarkItems: [
        bookmark("exact", "Exact title", "https://example.com/path"),
        bookmark("title-case", "exact title", "https://example.com/path"),
        bookmark("url-case", "Exact title", "https://EXAMPLE.com/path"),
      ],
    });

    await expect(fake.bookmarks.search({ title: "Exact title" }))
      .resolves.toEqual([
        bookmark("exact", "Exact title", "https://example.com/path"),
        bookmark("url-case", "Exact title", "https://EXAMPLE.com/path"),
      ]);
    await expect(fake.bookmarks.search({ url: "https://example.com/path" }))
      .resolves.toEqual([
        bookmark("exact", "Exact title", "https://example.com/path"),
        bookmark("title-case", "exact title", "https://example.com/path"),
      ]);
  });

  it("requires every supplied object filter to match", async () => {
    const fake = createFakeChrome({
      bookmarkItems: [
        bookmark("all", "Alpha exact", "https://example.com/alpha"),
        bookmark("wrong-title", "Alpha other", "https://example.com/alpha"),
        bookmark("wrong-query", "Exact", "https://example.com/alpha"),
        bookmark("wrong-url", "Alpha exact", "https://example.com/other"),
      ],
    });

    const results = await fake.bookmarks.search({
      query: "alpha",
      title: "Alpha exact",
      url: "https://example.com/alpha",
    });

    expect(results.map((item) => item.id)).toEqual(["all"]);
  });

  it("includes mutable created bookmarks in later filtered searches", async () => {
    const fake = createFakeChrome({
      bookmarkItems: [bookmark("existing", "Existing", "https://existing.example/")],
    });
    const created = await fake.bookmarks.create({
      title: "Created Guide",
      url: "https://created.example/guide",
    });

    await expect(fake.bookmarks.search("CREATED")).resolves.toEqual([created]);
    await expect(fake.bookmarks.search({ query: "guide" })).resolves.toEqual([created]);
    await expect(fake.bookmarks.search({ title: "Created Guide" })).resolves.toEqual([created]);
    await expect(fake.bookmarks.search({ url: "https://created.example/guide" }))
      .resolves.toEqual([created]);
  });
});
