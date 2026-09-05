import { describe, expect, it, vi } from "vitest";
import { createBookmarkActions } from "../src/sidepanel/bookmark-actions";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): Readonly<TabViewModel> {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Example",
    url: "https://example.com/",
    domain: "example.com",
    active: true,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

describe("bookmark actions", () => {
  it("queries Chrome exactly once with the normalized HTTP URL", async () => {
    const search = vi.fn(async () => [] as chrome.bookmarks.BookmarkTreeNode[]);
    const create = vi.fn();

    await expect(createBookmarkActions({ search, create }).canAdd(tab({
      url: "HTTPS://EXAMPLE.COM:443/a/../guide",
    }))).resolves.toBe(true);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ url: "https://example.com/guide" });
  });

  it.each(["chrome://settings/", "file:///C:/notes.txt", "not a url", ""])(
    "does not query Chrome for unsupported URL %s",
    async (url) => {
      const search = vi.fn();
      const create = vi.fn();

      await expect(createBookmarkActions({ search, create }).canAdd(tab({ url })))
        .resolves.toBe(false);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it("returns false when Chrome returns the same normalized bookmark URL", async () => {
    const search = vi.fn(async () => [{
      id: "existing",
      title: "Existing",
      url: "https://example.com/guide",
      syncing: false,
    }] as chrome.bookmarks.BookmarkTreeNode[]);
    const create = vi.fn();

    await expect(createBookmarkActions({ search, create }).canAdd(tab({
      url: "https://example.com/a/../guide",
    }))).resolves.toBe(false);
  });

  it("returns true when Chrome returns only a different URL", async () => {
    const search = vi.fn(async () => [{
      id: "other",
      title: "Other",
      url: "https://example.com/other",
      syncing: false,
    }] as chrome.bookmarks.BookmarkTreeNode[]);
    const create = vi.fn();

    await expect(createBookmarkActions({ search, create }).canAdd(tab({
      url: "https://example.com/guide",
    }))).resolves.toBe(true);
  });

  it("requires the returned node URL to exactly equal the normalized tab URL", async () => {
    const search = vi.fn(async () => [{
      id: "non-normalized",
      title: "Non-normalized",
      url: "HTTPS://EXAMPLE.COM:443/guide",
      syncing: false,
    }] as chrome.bookmarks.BookmarkTreeNode[]);
    const create = vi.fn();

    await expect(createBookmarkActions({ search, create }).canAdd(tab({
      url: "https://example.com/guide",
    }))).resolves.toBe(true);
  });

  it("propagates Chrome bookmark query failures", async () => {
    const failure = new Error("query failed");
    const search = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
      throw failure;
    });
    const create = vi.fn();

    await expect(createBookmarkActions({ search, create }).canAdd(tab())).rejects.toBe(failure);
  });

  it("creates the normalized bookmark with the tab title", async () => {
    const search = vi.fn();
    const create = vi.fn(async () => ({ id: "created" }) as chrome.bookmarks.BookmarkTreeNode);

    await expect(createBookmarkActions({ search, create }).add(tab({
      title: "Guide",
      url: "HTTPS://EXAMPLE.COM:443/a/../guide",
    }))).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      title: "Guide",
      url: "https://example.com/guide",
    });
  });

  it("uses the normalized URL when the tab title is empty", async () => {
    const search = vi.fn();
    const create = vi.fn(async () => ({ id: "created" }) as chrome.bookmarks.BookmarkTreeNode);

    await createBookmarkActions({ search, create }).add(tab({ title: "" }));

    expect(create).toHaveBeenCalledWith({
      title: "https://example.com/",
      url: "https://example.com/",
    });
  });

  it.each(["chrome://settings/", "file:///C:/notes.txt", "not a url", ""])(
    "rejects unsupported URL %s without creating a bookmark",
    async (url) => {
      const search = vi.fn();
      const create = vi.fn();

      await expect(createBookmarkActions({ search, create }).add(tab({ url })))
        .rejects.toEqual(new Error("当前标签无法添加到收藏夹"));
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("maps Chrome bookmark create failures to a stable Chinese error", async () => {
    const search = vi.fn();
    const create = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode> => {
      throw new Error("browser failure");
    });

    await expect(createBookmarkActions({ search, create }).add(tab()))
      .rejects.toEqual(new Error("添加收藏夹失败"));
  });
});
