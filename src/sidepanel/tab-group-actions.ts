import { isValidTabGroupId, type TabGroupColor } from "./tab-group-model";
import type { TabGroupReorderPlan } from "./tab-group-reorder-model";

type TabGroupActions = {
  move(plan: TabGroupReorderPlan): Promise<void>;
  create(input: {
    tabId: number;
    windowId: number;
    title: string;
    color: TabGroupColor;
  }): Promise<number>;
  createSameSite(input: {
    tabIds: [number, ...number[]];
    windowId: number;
    hostname: string;
    color: TabGroupColor;
  }): Promise<number>;
  createTabInGroup(input: {
    groupId: number;
    windowId: number;
    index: number;
  }): Promise<void>;
  updateCreated(groupId: number, title: string, color: TabGroupColor): Promise<void>;
  add(tabId: number, groupId: number): Promise<void>;
  remove(tabId: number): Promise<void>;
  setCollapsed(groupId: number, collapsed: boolean): Promise<void>;
  rename(groupId: number, title: string): Promise<void>;
  setColor(groupId: number, color: TabGroupColor): Promise<void>;
  dissolve(tabIds: number[]): Promise<void>;
};

export class PartialTabGroupCreationError extends Error {
  readonly partial = true;

  constructor(readonly groupId: number, options?: ErrorOptions) {
    super("分组已创建，但无法保存名称或颜色", options);
    this.name = "PartialTabGroupCreationError";
  }
}

export class PartialTabGroupAddError extends Error {
  readonly partial = true;

  constructor(readonly tabId: number, options?: ErrorOptions) {
    super("标签页已创建，但无法加入分组", options);
    this.name = "PartialTabGroupAddError";
  }
}

function assertValidTabGroupId(groupId: number): void {
  if (!isValidTabGroupId(groupId)) {
    throw new Error("标签组 ID 无效");
  }
}

export function createTabGroupActions(
  tabs: Pick<typeof chrome.tabs, "create" | "group" | "ungroup">,
  groups: Pick<typeof chrome.tabGroups, "move" | "update">,
): TabGroupActions {
  const updateCreated = async (
    groupId: number,
    title: string,
    color: TabGroupColor,
  ): Promise<void> => {
    assertValidTabGroupId(groupId);

    try {
      await groups.update(groupId, { title, color });
    } catch (cause) {
      throw new PartialTabGroupCreationError(groupId, { cause });
    }
  };

  return {
    async move(plan): Promise<void> {
      assertValidTabGroupId(plan.groupId);

      try {
        await groups.move(plan.groupId, {
          index: plan.targetIndex,
          windowId: plan.windowId,
        });
      } catch (cause) {
        throw new Error("无法移动标签组", { cause });
      }
    },

    async create(input): Promise<number> {
      let groupId: number;
      try {
        groupId = await tabs.group({
          tabIds: input.tabId,
          createProperties: { windowId: input.windowId },
        });
      } catch (cause) {
        throw new Error("无法创建标签组", { cause });
      }

      assertValidTabGroupId(groupId);
      await updateCreated(groupId, input.title, input.color);
      return groupId;
    },

    async createSameSite(input): Promise<number> {
      let groupId: number;
      try {
        groupId = await tabs.group({
          tabIds: input.tabIds,
          createProperties: { windowId: input.windowId },
        });
      } catch (cause) {
        throw new Error("无法快速分组", { cause });
      }

      assertValidTabGroupId(groupId);
      await updateCreated(groupId, input.hostname, input.color);
      return groupId;
    },

    async createTabInGroup(input): Promise<void> {
      assertValidTabGroupId(input.groupId);

      let tab: chrome.tabs.Tab;
      try {
        tab = await tabs.create({
          windowId: input.windowId,
          index: input.index,
          active: true,
        });
      } catch (cause) {
        throw new Error("无法在分组中新建标签页", { cause });
      }

      if (tab.id === undefined) {
        throw new Error("新标签页缺少 ID");
      }

      try {
        await tabs.group({ tabIds: tab.id, groupId: input.groupId });
      } catch (cause) {
        throw new PartialTabGroupAddError(tab.id, { cause });
      }
    },

    updateCreated,

    async add(tabId, groupId): Promise<void> {
      assertValidTabGroupId(groupId);

      try {
        await tabs.group({ tabIds: tabId, groupId });
      } catch (cause) {
        throw new Error("无法将标签页加入分组", { cause });
      }
    },

    async remove(tabId): Promise<void> {
      try {
        await tabs.ungroup(tabId);
      } catch (cause) {
        throw new Error("无法将标签页移出分组", { cause });
      }
    },

    async setCollapsed(groupId, collapsed): Promise<void> {
      assertValidTabGroupId(groupId);

      try {
        await groups.update(groupId, { collapsed });
      } catch (cause) {
        throw new Error("无法更新标签组折叠状态", { cause });
      }
    },

    async rename(groupId, title): Promise<void> {
      assertValidTabGroupId(groupId);

      try {
        await groups.update(groupId, { title });
      } catch (cause) {
        throw new Error("无法重命名标签组", { cause });
      }
    },

    async setColor(groupId, color): Promise<void> {
      assertValidTabGroupId(groupId);

      try {
        await groups.update(groupId, { color });
      } catch (cause) {
        throw new Error("无法修改标签组颜色", { cause });
      }
    },

    async dissolve(tabIds): Promise<void> {
      if (tabIds.length === 0) return;

      try {
        await tabs.ungroup(tabIds as [number, ...number[]]);
      } catch (cause) {
        throw new Error("无法解散标签组", { cause });
      }
    },
  };
}
