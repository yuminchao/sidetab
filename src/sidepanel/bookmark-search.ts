import { createSearchResult, type SearchResult } from "./search-result-model";

export type BookmarkSearchApi = Pick<typeof chrome.bookmarks, "search">;

export async function searchBookmarks(
  api: BookmarkSearchApi,
  text: string,
): Promise<SearchResult[]> {
  let items: chrome.bookmarks.BookmarkTreeNode[];
  try {
    items = await api.search(text);
  } catch {
    throw new Error("无法读取收藏夹");
  }

  const results: SearchResult[] = [];
  const seenKeys = new Set<string>();
  for (const item of items) {
    if (results.length === 5) break;
    const normalized = item.url
      ? createSearchResult({
          id: item.id,
          title: item.title,
          url: item.url,
          source: "bookmark",
        })
      : undefined;
    if (!normalized || seenKeys.has(normalized.dedupeKey)) continue;
    seenKeys.add(normalized.dedupeKey);
    results.push(normalized.result);
  }
  return results;
}
