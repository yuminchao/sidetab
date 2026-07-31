export type SearchResult = {
  id: string;
  title: string;
  url: string;
  source: "bookmark" | "history";
};

export function createSearchResult(
  input: SearchResult,
): { result: SearchResult; dedupeKey: string } | undefined {
  try {
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return {
      result: {
        ...input,
        title: input.title.trim() || url.hostname,
        url: url.href,
      },
      dedupeKey: `${url.host}${pathname}`,
    };
  } catch {
    return undefined;
  }
}

export function mergeSearchResults(
  bookmarks: readonly SearchResult[],
  history: readonly SearchResult[],
): SearchResult[] {
  const results: SearchResult[] = [];
  const seenKeys = new Set<string>();
  const append = (items: readonly SearchResult[], limit: number): void => {
    for (const item of items) {
      if (results.length === limit) break;
      const normalized = createSearchResult(item);
      if (!normalized || seenKeys.has(normalized.dedupeKey)) continue;
      seenKeys.add(normalized.dedupeKey);
      results.push(normalized.result);
    }
  };

  append(bookmarks, 5);
  append(history, 20);
  return results;
}
