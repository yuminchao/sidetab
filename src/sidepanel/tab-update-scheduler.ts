export type TabUpdateFlush = (
  tabs: readonly chrome.tabs.Tab[],
) => void | Promise<void>;

export type TabUpdateScheduler = {
  schedule(tabId: number, tab: chrome.tabs.Tab): void;
  readonly pendingCount: number;
  destroy(): void;
};

/**
 * 把同一微任务窗口内的多次 `tabs.onUpdated` 合并为一次 flush。
 *
 * Chrome 在标签属性（标题、URL、favicon、加载状态等）变化时会高频触发
 * `onUpdated`。逐事件处理会对每个事件执行全量 store 读取与可能的全量渲染。
 * 本调度器以 `queueMicrotask` 合并窗口：窗口内同一标签只保留最后一次快照，
 * 窗口结束时把全部待处理标签一次性交给 flush。中间态可安全跳过，因为
 * store 最终以最后一次快照为准。
 */
export function createTabUpdateScheduler(
  flush: TabUpdateFlush,
): TabUpdateScheduler {
  let active = true;
  let flushScheduled = false;
  const pending = new Map<number, chrome.tabs.Tab>();

  const runFlush = (): void => {
    flushScheduled = false;
    if (!active || pending.size === 0) return;
    const tabs = Array.from(pending.values());
    pending.clear();
    void Promise.resolve(flush(tabs));
  };

  return {
    schedule(tabId: number, tab: chrome.tabs.Tab): void {
      if (!active) return;
      pending.set(tabId, tab);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(runFlush);
      }
    },

    get pendingCount(): number {
      return pending.size;
    },

    destroy(): void {
      active = false;
      pending.clear();
    },
  };
}
