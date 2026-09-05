export const DEFAULT_REPLACEMENT_LIMIT = 256;

export type TabIdReplacementMap = {
  get(removedId: number): number | undefined;
  set(removedId: number, replacementId: number): void;
  delete(removedId: number): void;
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
