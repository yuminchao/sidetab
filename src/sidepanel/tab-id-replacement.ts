export const DEFAULT_REPLACEMENT_LIMIT = 256;

export type TabIdReplacementMap = {
  /**
   * 查询旧标签 ID 对应的新标签 ID。
   *
   * Args:
   *   removedId: 被替换的旧标签 ID。
   * Returns:
   *   已记录的新标签 ID；不存在时返回 undefined。
   * Raises:
   *   无。
   */
  get(removedId: number): number | undefined;
  /**
   * 记录一次标签 ID 替换。
   *
   * Args:
   *   removedId: 被替换的旧标签 ID。
   *   replacementId: Chrome 分配的新标签 ID。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  set(removedId: number, replacementId: number): void;
  /**
   * 删除已消费的替换记录。
   *
   * Args:
   *   removedId: 被替换的旧标签 ID。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  delete(removedId: number): void;
  /**
   * 清空全部替换记录。
   *
   * Args:
   *   无。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  clear(): void;
  readonly size: number;
};

/** 迁移辅助函数只读取映射，不依赖完整 Map 接口。 */
export type ReadonlyTabIdReplacementMap = Pick<TabIdReplacementMap, "get">;

/**
 * 有界的标签 ID 替换映射（FIFO）。
 *
 * Chrome 在标签被替换（`onReplaced`，如页面崩溃恢复）时为新标签分配新 ID。
 * 侧边栏需要把旧 ID 迁移到新 ID，但该映射只对"迁移窗口"内的事件有意义：
 * 迁移完成后旧键不再需要。为避免长期运行（尤其侧边栏常驻）时无界增长，
 * 本映射在超过上限时按插入顺序淘汰最旧条目。
 */
export function createTabIdReplacementMap(
  limit: number = DEFAULT_REPLACEMENT_LIMIT,
): TabIdReplacementMap {
  const entries = new Map<number, number>();

  return {
    get(removedId: number): number | undefined {
      return entries.get(removedId);
    },

    set(removedId: number, replacementId: number): void {
      if (entries.has(removedId)) {
        entries.delete(removedId);
      }
      entries.set(removedId, replacementId);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },

    delete(removedId: number): void {
      entries.delete(removedId);
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
