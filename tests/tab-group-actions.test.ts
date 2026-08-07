import { describe, expect, it, vi } from "vitest";
import {
  PartialTabGroupAddError,
  PartialTabGroupCreationError,
  createTabGroupActions,
} from "../src/sidepanel/tab-group-actions";
import type { TabGroupReorderPlan } from "../src/sidepanel/tab-group-reorder-model";

function createApis() {
  const create = vi.fn().mockResolvedValue({ id: 999 });
  const group = vi.fn().mockResolvedValue(7);
  const ungroup = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const groupMove = vi.fn().mockResolvedValue(undefined);

  return {
    create,
    group,
    ungroup,
    update,
    groupMove,
    actions: createTabGroupActions(
      { create, group, ungroup } as unknown as Pick<
        typeof chrome.tabs,
        "create" | "group" | "ungroup"
      >,
      { move: groupMove, update } as unknown as Pick<
        typeof chrome.tabGroups,
        "move" | "update"
      >,
    ),
  };
}

describe("tab group actions", () => {
  it("moves a whole group with exactly one tabGroups.move call", async () => {
    const { actions, groupMove } = createApis();
    const reorderPlan: TabGroupReorderPlan = {
      groupId: 7,
      targetIndex: 12,
      windowId: 10,
    };

    await actions.move(reorderPlan);

    expect(groupMove).toHaveBeenCalledOnce();
    expect(groupMove).toHaveBeenCalledWith(7, { index: 12, windowId: 10 });
  });

  it("maps a group move rejection and preserves its cause", async () => {
    const { actions, groupMove } = createApis();
    const cause = new Error("chrome failed");
    groupMove.mockRejectedValueOnce(cause);

    await expect(actions.move({ groupId: 7, targetIndex: 12, windowId: 10 }))
      .rejects.toMatchObject({ message: "无法移动标签组", cause });
    expect(groupMove).toHaveBeenCalledOnce();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID before moving: %s",
    async (invalidGroupId) => {
      const { actions, groupMove } = createApis();

      await expect(actions.move({
        groupId: invalidGroupId,
        targetIndex: 12,
        windowId: 10,
      })).rejects.toThrow();
      expect(groupMove).not.toHaveBeenCalled();
    },
  );

  it("creates a group and saves its title and color", async () => {
    const { actions, group, update } = createApis();

    await expect(actions.create({
      tabId: 3,
      windowId: 10,
      title: "Work",
      color: "blue",
    })).resolves.toBe(7);

    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({
      tabIds: 3,
      createProperties: { windowId: 10 },
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { title: "Work", color: "blue" });
  });

  it("creates one same-site group and saves its hostname with the supplied color", async () => {
    const { actions, group, update } = createApis();

    await expect(actions.createSameSite({
      tabIds: [3, 4, 5],
      windowId: 10,
      hostname: "example.com",
      color: "purple",
    })).resolves.toBe(7);

    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({
      tabIds: [3, 4, 5],
      createProperties: { windowId: 10 },
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { title: "example.com", color: "purple" });
  });

  it("creates a same-site group from a single tab", async () => {
    const { actions, group, update } = createApis();

    await expect(actions.createSameSite({
      tabIds: [3],
      windowId: 10,
      hostname: "example.com",
      color: "cyan",
    })).resolves.toBe(7);

    expect(group).toHaveBeenCalledWith({
      tabIds: [3],
      createProperties: { windowId: 10 },
    });
    expect(update).toHaveBeenCalledWith(7, { title: "example.com", color: "cyan" });
  });

  it("maps same-site group creation failures without updating metadata", async () => {
    const { actions, group, update } = createApis();
    const cause = new Error("chrome failed");
    group.mockRejectedValueOnce(cause);

    await expect(actions.createSameSite({
      tabIds: [3, 4],
      windowId: 10,
      hostname: "example.com",
      color: "grey",
    })).rejects.toMatchObject({ message: "无法快速分组", cause });
    expect(update).not.toHaveBeenCalled();
  });

  it("uses the quick-group failure message", async () => {
    const { actions, group } = createApis();
    group.mockRejectedValueOnce(new Error("chrome failed"));

    await expect(actions.createSameSite({
      tabIds: [3],
      windowId: 10,
      hostname: "example.com",
      color: "grey",
    })).rejects.toThrow("无法快速分组");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID from same-site creation before updating metadata: %s",
    async (invalidGroupId) => {
      const { actions, group, update } = createApis();
      group.mockResolvedValueOnce(invalidGroupId);

      await expect(actions.createSameSite({
        tabIds: [3, 4],
        windowId: 10,
        hostname: "example.com",
        color: "grey",
      })).rejects.toThrow("标签组 ID 无效");
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("creates an active tab after the group's last tab and adds it to the group", async () => {
    const { actions, create, group } = createApis();

    await actions.createTabInGroup({ groupId: 7, windowId: 10, index: 6 });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ windowId: 10, index: 6, active: true });
    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({ tabIds: 999, groupId: 7 });
  });

  it("does not add a tab to the group when tab creation rejects", async () => {
    const { actions, create, group } = createApis();
    const cause = new Error("chrome failed");
    create.mockRejectedValueOnce(cause);

    await expect(
      actions.createTabInGroup({ groupId: 7, windowId: 10, index: 6 }),
    ).rejects.toMatchObject({ message: "无法在分组中新建标签页", cause });
    expect(group).not.toHaveBeenCalled();
  });

  it("rejects a created tab without an ID before adding it to the group", async () => {
    const { actions, create, group } = createApis();
    create.mockResolvedValueOnce({});

    await expect(
      actions.createTabInGroup({ groupId: 7, windowId: 10, index: 6 }),
    ).rejects.toThrow("新标签页缺少 ID");
    expect(group).not.toHaveBeenCalled();
  });

  it("reports a partial add when a created tab cannot be added to the group", async () => {
    const { actions, group } = createApis();
    const cause = new Error("chrome failed");
    group.mockRejectedValueOnce(cause);

    const operation = actions.createTabInGroup({ groupId: 7, windowId: 10, index: 6 });

    await expect(operation).rejects.toMatchObject({
      message: "标签页已创建，但无法加入分组",
      tabId: 999,
      partial: true,
      cause,
    });
    await expect(operation).rejects.toBeInstanceOf(PartialTabGroupAddError);
  });

  it("renames a group", async () => {
    const { actions, update } = createApis();

    await actions.rename(7, "Renamed");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { title: "Renamed" });
  });

  it("maps a rename rejection", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    await expect(actions.rename(7, "Renamed")).rejects.toMatchObject({
      message: "无法重命名标签组",
      cause,
    });
  });

  it("updates a group's color", async () => {
    const { actions, update } = createApis();

    await actions.setColor(7, "red");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { color: "red" });
  });

  it("maps a color update rejection", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    await expect(actions.setColor(7, "red")).rejects.toMatchObject({
      message: "无法修改标签组颜色",
      cause,
    });
  });

  it("dissolves a group with one batch call", async () => {
    const { actions, ungroup } = createApis();

    await actions.dissolve([1, 2, 3]);

    expect(ungroup).toHaveBeenCalledOnce();
    expect(ungroup).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("silently skips dissolving an empty group", async () => {
    const { actions, ungroup } = createApis();

    await expect(actions.dissolve([])).resolves.toBeUndefined();
    expect(ungroup).not.toHaveBeenCalled();
  });

  it("maps a dissolve rejection", async () => {
    const { actions, ungroup } = createApis();
    const cause = new Error("chrome failed");
    ungroup.mockRejectedValueOnce(cause);

    await expect(actions.dissolve([1, 2, 3])).rejects.toMatchObject({
      message: "无法解散标签组",
      cause,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID before running management APIs: %s",
    async (invalidGroupId) => {
      const { actions, create, group, update } = createApis();

      await expect(
        actions.createTabInGroup({ groupId: invalidGroupId, windowId: 10, index: 6 }),
      ).rejects.toThrow("标签组 ID 无效");
      await expect(actions.rename(invalidGroupId, "Renamed")).rejects.toThrow(
        "标签组 ID 无效",
      );
      await expect(actions.setColor(invalidGroupId, "red")).rejects.toThrow(
        "标签组 ID 无效",
      );

      expect(create).not.toHaveBeenCalled();
      expect(group).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("reports a partial same-site creation when metadata update rejects", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    await expect(actions.createSameSite({
      tabIds: [3, 4],
      windowId: 10,
      hostname: "example.com",
      color: "grey",
    })).rejects.toMatchObject({
      message: "分组已创建，但无法保存名称或颜色",
      groupId: 7,
      partial: true,
      cause,
    });
  });

  it("maps a group creation rejection without updating metadata", async () => {
    const { actions, group, update } = createApis();
    const cause = new Error("chrome failed");
    group.mockRejectedValueOnce(cause);

    await expect(actions.create({
      tabId: 3,
      windowId: 10,
      title: "Work",
      color: "blue",
    })).rejects.toMatchObject({ message: "无法创建标签组", cause });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID returned during creation: %s",
    async (invalidGroupId) => {
      const { actions, group, update } = createApis();
      group.mockResolvedValueOnce(invalidGroupId);

      await expect(actions.create({
        tabId: 3,
        windowId: 10,
        title: "Work",
        color: "blue",
      })).rejects.toThrow("标签组 ID 无效");
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("reports a partial creation when metadata update rejects", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    const operation = actions.create({
      tabId: 3,
      windowId: 10,
      title: "Work",
      color: "blue",
    });

    await expect(operation).rejects.toMatchObject({
      message: "分组已创建，但无法保存名称或颜色",
      groupId: 7,
      partial: true,
      cause,
    });
    await expect(operation).rejects.toBeInstanceOf(PartialTabGroupCreationError);
  });

  it("retries metadata updates for an already-created group", async () => {
    const { actions, update } = createApis();

    await actions.updateCreated(8, "Later", "green");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(8, { title: "Later", color: "green" });
  });

  it("preserves the group ID when a retried metadata update rejects", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    await expect(actions.updateCreated(8, "Later", "green")).rejects.toMatchObject({
      message: "分组已创建，但无法保存名称或颜色",
      groupId: 8,
      partial: true,
      cause,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID before updating created metadata: %s",
    async (invalidGroupId) => {
      const { actions, update } = createApis();

      await expect(actions.updateCreated(invalidGroupId, "Later", "green")).rejects.toThrow(
        "标签组 ID 无效",
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("adds a tab to an existing group", async () => {
    const { actions, group } = createApis();

    await actions.add(3, 8);

    expect(group).toHaveBeenCalledOnce();
    expect(group).toHaveBeenCalledWith({ tabIds: 3, groupId: 8 });
  });

  it("maps an add-to-group rejection", async () => {
    const { actions, group } = createApis();
    const cause = new Error("chrome failed");
    group.mockRejectedValueOnce(cause);

    await expect(actions.add(3, 8)).rejects.toMatchObject({
      message: "无法将标签页加入分组",
      cause,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID before adding a tab: %s",
    async (invalidGroupId) => {
      const { actions, group } = createApis();

      await expect(actions.add(3, invalidGroupId)).rejects.toThrow("标签组 ID 无效");
      expect(group).not.toHaveBeenCalled();
    },
  );

  it("removes a tab from its group", async () => {
    const { actions, ungroup } = createApis();

    await actions.remove(3);

    expect(ungroup).toHaveBeenCalledOnce();
    expect(ungroup).toHaveBeenCalledWith(3);
  });

  it("maps a remove-from-group rejection", async () => {
    const { actions, ungroup } = createApis();
    const cause = new Error("chrome failed");
    ungroup.mockRejectedValueOnce(cause);

    await expect(actions.remove(3)).rejects.toMatchObject({
      message: "无法将标签页移出分组",
      cause,
    });
  });

  it("updates a group's collapsed state", async () => {
    const { actions, update } = createApis();

    await actions.setCollapsed(8, true);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(8, { collapsed: true });
  });

  it("maps a collapsed-state update rejection", async () => {
    const { actions, update } = createApis();
    const cause = new Error("chrome failed");
    update.mockRejectedValueOnce(cause);

    await expect(actions.setCollapsed(8, false)).rejects.toMatchObject({
      message: "无法更新标签组折叠状态",
      cause,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid group ID before updating collapsed state: %s",
    async (invalidGroupId) => {
      const { actions, update } = createApis();

      await expect(actions.setCollapsed(invalidGroupId, false)).rejects.toThrow(
        "标签组 ID 无效",
      );
      expect(update).not.toHaveBeenCalled();
    },
  );
});
