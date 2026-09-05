import type { TabViewModel } from "./tab-model";

type BookmarksApi = Pick<typeof chrome.bookmarks, "search" | "create">;

export interface BookmarkActions {
  /**
   * 判断标签是否可新增到 Chrome 收藏夹。
   *
   * Args:
   *   tab: 待检查的标签快照。
   * Returns:
   *   URL 受支持且尚未收藏时返回 true，否则返回 false。
   * Raises:
   *   Chrome 收藏夹查询失败时透传原始异常。
   */
  canAdd(tab: Readonly<TabViewModel>): Promise<boolean>;

  /**
   * 将标签新增到 Chrome 收藏夹。
   *
   * Args:
   *   tab: 待收藏的标签快照。
   * Returns:
   *   无。
   * Raises:
   *   标签 URL 不受支持或 Chrome 创建收藏失败时抛出稳定中文错误。
   */
  add(tab: Readonly<TabViewModel>): Promise<void>;
}

/**
 * 创建标签收藏操作对象。
 *
 * Args:
 *   api: Chrome 收藏夹查询与创建接口。
 * Returns:
 *   标签收藏操作对象。
 * Raises:
 *   无。
 */
export function createBookmarkActions(api: BookmarksApi): BookmarkActions {
  return {
    /**
     * 查询 Chrome 收藏夹并判断当前规范化 URL 是否尚未存在。
     *
     * Args:
     *   tab: 待检查的标签快照。
     * Returns:
     *   URL 受支持且查询结果中无精确 URL 时返回 true，否则返回 false。
     * Raises:
     *   Chrome 收藏夹查询失败时透传原始异常。
     */
    async canAdd(tab) {
      const url = normalizeBookmarkUrl(tab.url);
      if (!url) return false;
      const nodes = await api.search({ url });
      return !nodes.some((node) => node.url === url);
    },

    /**
     * 调用 Chrome 创建接口保存当前标签，并隐藏底层失败细节。
     *
     * Args:
     *   tab: 待收藏的标签快照。
     * Returns:
     *   无。
     * Raises:
     *   标签 URL 不受支持或 Chrome 创建收藏失败时抛出稳定中文错误。
     */
    async add(tab) {
      const url = normalizeBookmarkUrl(tab.url);
      if (!url) throw new Error("当前标签无法添加到收藏夹");
      try {
        await api.create({ title: tab.title || url, url });
      } catch {
        throw new Error("添加收藏夹失败");
      }
    },
  };
}

function normalizeBookmarkUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
