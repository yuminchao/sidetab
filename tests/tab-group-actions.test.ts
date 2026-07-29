import { describe, expect, it, vi } from "vitest";
import {
  PartialTabGroupCreationError,
  createTabGroupActions,
} from "../src/sidepanel/tab-group-actions";

function createApis() {
  const group = vi.fn().mockResolvedValue(7);
  const ungroup = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);

  return {
    group,
    ungroup,
    update,
    actions: createTabGroupActions(
      { group, ungroup } as unknown as Pick<typeof chrome.tabs, "group" | "ungroup">,
      { update } as unknown as Pick<typeof chrome.tabGroups, "update">,
    ),
  };
}

describe("tab group actions", () => {
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
