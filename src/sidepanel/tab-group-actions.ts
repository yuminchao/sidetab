import { isValidTabGroupId, type TabGroupColor } from "./tab-group-model";

type TabGroupActions = {
  create(input: {
    tabId: number;
    windowId: number;
    title: string;
    color: TabGroupColor;
  }): Promise<number>;
  updateCreated(groupId: number, title: string, color: TabGroupColor): Promise<void>;
  add(tabId: number, groupId: number): Promise<void>;
  remove(tabId: number): Promise<void>;
  setCollapsed(groupId: number, collapsed: boolean): Promise<void>;
};

export class PartialTabGroupCreationError extends Error {
  readonly partial = true;

  constructor(readonly groupId: number, options?: ErrorOptions) {
    super("分组已创建，但无法保存名称或颜色", options);
    this.name = "PartialTabGroupCreationError";
  }
}

function assertValidTabGroupId(groupId: number): void {
  if (!isValidTabGroupId(groupId)) {
    throw new Error("标签组 ID 无效");
  }
}

export function createTabGroupActions(
  tabs: Pick<typeof chrome.tabs, "group" | "ungroup">,
  groups: Pick<typeof chrome.tabGroups, "update">,
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
  };
}
