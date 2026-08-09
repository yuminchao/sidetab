import type { TabBlockReorderPlan, TabReorderPlan } from "./tab-reorder-model";

export type TabsActionApi = Pick<
  typeof chrome.tabs,
  "create" | "duplicate" | "group" | "move" | "remove" | "ungroup" | "update"
>;

export function createTabActions(api: TabsActionApi) {
  const setPinned = async (tabId: number, pinned: boolean): Promise<void> => {
    try {
      await api.update(tabId, { pinned });
    } catch {
      throw new Error("无法更新标签固定状态");
    }
  };

  return {
    async create(openerTabId?: number): Promise<void> {
      try {
        await api.create({
          active: true,
          ...(openerTabId === undefined ? {} : { openerTabId }),
        });
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

    async closeAbove(tabIds: number[]): Promise<void> {
      if (tabIds.length === 0) return;
      try {
        await api.remove(tabIds);
      } catch {
        throw new Error("无法关闭上方标签页");
      }
    },

    async closeOtherSameSite(tabIds: number[]): Promise<void> {
      if (tabIds.length === 0) {
        return;
      }

      try {
        await api.remove(tabIds);
      } catch {
        throw new Error("无法关闭其他同类网站标签页");
      }
    },

    async duplicate(tabId: number): Promise<number | undefined> {
      try {
        return (await api.duplicate(tabId))?.id;
      } catch {
        throw new Error("无法复制该标签页");
      }
    },

    setPinned,

    async reorder(plan: TabReorderPlan): Promise<void> {
      try {
        if (plan.pinnedChanged && !plan.targetPinned) {
          await api.update(plan.tabId, { pinned: false });
        }

        if (plan.groupChanged) {
          if (plan.targetGroupId >= 0) {
            await api.group({ tabIds: plan.tabId, groupId: plan.targetGroupId });
          } else {
            await api.ungroup(plan.tabId);
          }
        }

        if (plan.pinnedChanged && plan.targetPinned) {
          await api.update(plan.tabId, { pinned: true });
        }

        await api.move(plan.tabId, { index: plan.targetIndex });
      } catch (cause) {
        throw new Error("无法移动该标签页", { cause });
      }
    },

    async reorderMany(plan: TabBlockReorderPlan): Promise<void> {
      try {
        if (plan.pinnedChanged && !plan.targetPinned) {
          await Promise.all(plan.tabIds.map((tabId) => api.update(tabId, { pinned: false })));
        }
        if (plan.groupChanged) {
          if (plan.targetGroupId >= 0) {
            await api.group({ tabIds: plan.tabIds, groupId: plan.targetGroupId });
          } else {
            await api.ungroup(plan.tabIds);
          }
        }
        if (plan.pinnedChanged && plan.targetPinned) {
          await Promise.all(plan.tabIds.map((tabId) => api.update(tabId, { pinned: true })));
        }
        await api.move(plan.tabIds, { index: plan.targetIndex });
      } catch (cause) {
        throw new Error("无法移动标签子树", { cause });
      }
    },
  };
}
