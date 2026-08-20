/**
 * 同步提交一个微任务窗口内合并后的标签快照。
 *
 * Args:
 *   tabs: 每个标签保留最新状态后的只读快照集合。
 * Returns:
 *   无。
 * Raises:
 *   无；调用方应自行处理同步异常。
 */
export type TabUpdateFlush = (tabs: readonly chrome.tabs.Tab[]) => void;

/**
 * 管理标签更新的合并、失效与同步提交。
 *
 * Args:
 *   无。
 * Returns:
 *   无。
 * Raises:
 *   无。
 */
export type TabUpdateScheduler = {
  /**
   * 在当前微任务窗口内记录标签的最新快照。
   *
   * Args:
   *   tabId: 要更新的标签 ID。
   *   tab: 该标签的最新 Chrome 快照。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  schedule(tabId: number, tab: chrome.tabs.Tab): void;

  /**
   * 使指定标签已排队的更新快照失效。
   *
   * Args:
   *   tabId: 要失效的标签 ID。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  invalidate(tabId: number): void;

  /**
   * 立即同步提交当前仍有效的待处理更新。
   *
   * Args:
   *   无。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  flushNow(): void;
  readonly pendingCount: number;

  /**
   * 停止调度并清空尚未提交的标签更新。
   *
   * Args:
   *   无。
   * Returns:
   *   无。
   * Raises:
   *   无。
   */
  destroy(): void;
};

/**
 * 把同一微任务窗口内的多次 `tabs.onUpdated` 合并为一次 flush。
 *
 * Chrome 在标签属性（标题、URL、favicon、加载状态等）变化时会高频触发
 * `onUpdated`。逐事件处理会对每个事件执行全量 store 读取与可能的全量渲染。
 * 本调度器以 `queueMicrotask` 合并窗口：窗口内同一标签只保留最后一次快照，
 * 窗口结束时把全部待处理标签一次性交给 flush。失效操作会推进当前窗口内
 * 的标签代际，flush 只消费仍匹配该代际的快照；窗口结束后立即回收代际状态。
 */
export function createTabUpdateScheduler(
  flush: TabUpdateFlush,
): TabUpdateScheduler {
  let active = true;
  let flushScheduled = false;
  const pending = new Map<number, {
    tabId: number;
    tab: chrome.tabs.Tab;
    generation: number;
  }>();
  const generations = new Map<number, number>();

  const runFlush = (): void => {
    flushScheduled = false;
    if (!active || pending.size === 0) {
      generations.clear();
      return;
    }
    const entries = Array.from(pending.values());
    pending.clear();
    const tabs = entries
      .filter((entry) => entry.generation === (generations.get(entry.tabId) ?? 0))
      .map((entry) => entry.tab);
    generations.clear();
    if (tabs.length > 0) flush(tabs);
  };

  return {
    schedule(tabId: number, tab: chrome.tabs.Tab): void {
      if (!active) return;
      const generation = generations.get(tabId) ?? 0;
      pending.set(tabId, { tabId, tab: { ...tab }, generation });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(runFlush);
      }
    },

    invalidate(tabId: number): void {
      if (!active) return;
      if (!pending.has(tabId)) return;
      generations.set(tabId, (generations.get(tabId) ?? 0) + 1);
      pending.delete(tabId);
    },

    flushNow(): void {
      if (!active) return;
      runFlush();
    },

    get pendingCount(): number {
      return pending.size;
    },

    destroy(): void {
      active = false;
      pending.clear();
      generations.clear();
    },
  };
}
