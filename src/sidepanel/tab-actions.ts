import type { TabReorderPlan } from "./tab-reorder-model";

export type TabsActionApi = Pick<typeof chrome.tabs, "create" | "duplicate" | "move" | "remove" | "update">;

export function createTabActions(api: TabsActionApi) {
  const setPinned = async (tabId: number, pinned: boolean): Promise<void> => {
    try {
      await api.update(tabId, { pinned });
    } catch {
      throw new Error("无法更新标签固定状态");
    }
  };

  return {
    async create(): Promise<void> {
      try {
        await api.create({ active: true });
      } catch {
        throw new Error("无法新建标签页");
      }
    },

    async activate(tabId: number): Promise<void> {
      try {
        await api.update(tabId, { active: true });
      } catch {
        throw new Error("无法切换到该标签页");
      }
    },

    async close(tabId: number): Promise<void> {
      try {
        await api.remove(tabId);
      } catch {
        throw new Error("无法关闭该标签页");
      }
    },

    async closeMany(tabIds: number[]): Promise<void> {
      if (tabIds.length === 0) {
        return;
      }

      try {
        await api.remove(tabIds);
      } catch {
        throw new Error("无法关闭下方标签页");
      }
    },

    async duplicate(tabId: number): Promise<void> {
      try {
        await api.duplicate(tabId);
      } catch {
        throw new Error("无法复制该标签页");
      }
    },

    setPinned,

    async reorder(plan: TabReorderPlan): Promise<void> {
      if (plan.pinnedChanged) {
        await setPinned(plan.tabId, plan.targetPinned);
      }

      try {
        await api.move(plan.tabId, { index: plan.targetIndex });
      } catch {
        throw new Error("无法移动该标签页");
      }
    },
  };
}
