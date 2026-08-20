import { searchBookmarks, type BookmarkSearchApi } from "../sidepanel/bookmark-search";
import { searchHistory, type HistorySearchApi } from "../sidepanel/history-search";
import { mergeSearchResults, type SearchResult } from "../sidepanel/search-result-model";

export type FloatingBallSearchDependencies = Readonly<{
  bookmarks: BookmarkSearchApi;
  history: HistorySearchApi;
}>;

/**
 * 使用侧边栏相同规则查询书签与历史记录。
 *
 * @param deps Chrome 书签和历史记录查询适配器。
 * @param rawQuery 用户输入的关键词。
 * @returns 统一的搜索结果；书签最多 5 条，总数最多 20 条。
 * @throws 两种数据源都失败时抛出搜索领域错误。
 */
export async function searchBookmarksAndHistory(
  deps: FloatingBallSearchDependencies,
  rawQuery: string,
): Promise<SearchResult[]> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) {
    return searchHistory(deps.history, "");
  }

  const [bookmarkResult, historyResult] = await Promise.allSettled([
    searchBookmarks(deps.bookmarks, query),
    searchHistory(deps.history, query),
  ]);
  if (bookmarkResult.status === "rejected" && historyResult.status === "rejected") {
    throw new Error("无法读取搜索记录");
  }

  return mergeSearchResults(
    bookmarkResult.status === "fulfilled" ? bookmarkResult.value.slice(0, 5) : [],
    historyResult.status === "fulfilled" ? historyResult.value : [],
  );
}
