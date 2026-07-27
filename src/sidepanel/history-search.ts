export type HistorySearchApi = Pick<typeof chrome.history, "search">;

export type HistorySearchResult = {
  id: string;
  title: string;
  url: string;
};

export async function searchHistory(
  api: HistorySearchApi,
  text: string,
): Promise<HistorySearchResult[]> {
  let items: chrome.history.HistoryItem[];
  try {
    items = await api.search({ text, startTime: 0, maxResults: 20 });
  } catch {
    throw new Error("无法读取历史记录");
  }

  const results: HistorySearchResult[] = [];
  for (const item of items) {
    if (results.length === 20) break;
    const result = normalizeHistoryItem(item);
    if (result) results.push(result);
  }
  return results;
}

function normalizeHistoryItem(
  item: chrome.history.HistoryItem,
): HistorySearchResult | undefined {
  if (!item.url) return undefined;
  try {
    const url = new URL(item.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return {
      id: item.id || url.href,
      title: item.title?.trim() || url.hostname,
      url: url.href,
    };
  } catch {
    return undefined;
  }
}
