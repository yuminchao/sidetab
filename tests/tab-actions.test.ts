import { describe, expect, it, vi } from "vitest";
import { createShortcutActions } from "../src/sidepanel/shortcut-actions";
import { createTabActions } from "../src/sidepanel/tab-actions";
import type { TabReorderPlan } from "../src/sidepanel/tab-reorder-model";

const tab = { id: 7, windowId: 3, index: 0 } as chrome.tabs.Tab;
const sameGroupPlan: TabReorderPlan = {
  tabId: 7,
  targetIndex: 2,
  targetPinned: false,
  pinnedChanged: false,
  sourceGroupId: 4,
  targetGroupId: 4,
  groupChanged: false,
};
const crossGroupPlan: TabReorderPlan = {
  tabId: 7,
  targetIndex: 0,
  targetPinned: false,
  pinnedChanged: false,
  sourceGroupId: 4,
  targetGroupId: 9,
  groupChanged: true,
};

const pinnedToGroupPlan: TabReorderPlan = {
  ...crossGroupPlan,
  sourceGroupId: -1,
  pinnedChanged: true,
};

const groupToPinnedPlan: TabReorderPlan = {
  ...crossGroupPlan,
  targetPinned: true,
  pinnedChanged: true,
  sourceGroupId: 4,
  targetGroupId: -1,
};

const removeFromGroupPlan: TabReorderPlan = {
  ...crossGroupPlan,
  sourceGroupId: 4,
  targetGroupId: -1,
};

function tabApi(overrides: Partial<Parameters<typeof createTabActions>[0]> = {}) {
  return {
    create: vi.fn().mockResolvedValue(tab),
    update: vi.fn().mockResolvedValue(tab),
    remove: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockResolvedValue(tab),
    move: vi.fn().mockResolvedValue(tab),
    group: vi.fn().mockResolvedValue(9),
    ungroup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

type Assert<Condition extends true> = Condition;
type ChromeTabsSupportsTabActions = Assert<
  typeof chrome.tabs extends Parameters<typeof createTabActions>[0] ? true : false
>;
type ChromeTabsSupportsShortcutActions = Assert<
  typeof chrome.tabs extends Parameters<typeof createShortcutActions>[0] ? true : false
>;

const compileTimeCompatibility: [ChromeTabsSupportsTabActions, ChromeTabsSupportsShortcutActions] = [
  true,
  true,
];
void compileTimeCompatibility;

describe("tab actions", () => {
  it("creates exactly one active tab", async () => {
    const create = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ create })).create();

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ active: true });
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a create %s to the user-facing error", async (_case, makeCreate) => {
    const actions = createTabActions(tabApi({ create: makeCreate() }));

    await expect(actions.create()).rejects.toThrow("无法新建标签页");
  });

  it("activates exactly the requested tab", async () => {
    const update = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ update })).activate(7);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { active: true });
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps an activate %s to the user-facing error", async (_case, makeUpdate) => {
    const actions = createTabActions(tabApi({ update: makeUpdate() }));

    await expect(actions.activate(7)).rejects.toThrow("无法切换到该标签页");
  });

  it("closes exactly the requested tab", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ remove })).close(7);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(7);
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a close %s to the user-facing error", async (_case, makeRemove) => {
    const actions = createTabActions(tabApi({ remove: makeRemove() }));

    await expect(actions.close(7)).rejects.toThrow("无法关闭该标签页");
  });

  it("closes the requested tabs with one remove call", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ remove })).closeMany([3, 4, 5]);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([3, 4, 5]);
  });

  it("does not remove tabs when closeMany receives no tab IDs", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ remove })).closeMany([]);

    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a closeMany %s to the user-facing error", async (_case, makeRemove) => {
    const actions = createTabActions(tabApi({ remove: makeRemove() }));

    await expect(actions.closeMany([3, 4, 5])).rejects.toThrow("无法关闭下方标签页");
  });

  it("closes same-site tabs with one remove call", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ remove })).closeOtherSameSite([3, 4, 5]);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([3, 4, 5]);
  });

  it("does not remove tabs when closeOtherSameSite receives no tab IDs", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ remove })).closeOtherSameSite([]);

    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a closeOtherSameSite %s to its specific user-facing error", async (_case, makeRemove) => {
    const actions = createTabActions(tabApi({ remove: makeRemove() }));

    await expect(actions.closeOtherSameSite([3, 4, 5])).rejects.toThrow("无法关闭其他同类网站标签页");
  });

  it("duplicates exactly the requested tab", async () => {
    const duplicate = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ duplicate })).duplicate(7);

    expect(duplicate).toHaveBeenCalledOnce();
    expect(duplicate).toHaveBeenCalledWith(7);
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a duplicate %s to the user-facing error", async (_case, makeDuplicate) => {
    await expect(createTabActions(tabApi({ duplicate: makeDuplicate() })).duplicate(7)).rejects.toThrow(
      "无法复制该标签页",
    );
  });

  it("updates the requested tab pinned state", async () => {
    const update = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ update })).setPinned(7, true);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { pinned: true });
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a setPinned %s to the user-facing error", async (_case, makeUpdate) => {
    await expect(createTabActions(tabApi({ update: makeUpdate() })).setPinned(7, true)).rejects.toThrow(
      "无法更新标签固定状态",
    );
  });

  it("moves within a group without changing pinned state or membership", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);
    const group = vi.fn().mockResolvedValue(9);
    const ungroup = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ update, move, group, ungroup })).reorder(sameGroupPlan);

    expect(update).not.toHaveBeenCalled();
    expect(group).not.toHaveBeenCalled();
    expect(ungroup).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledWith(7, { index: 2 });
  });

  it("groups before moving across groups", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);
    const group = vi.fn().mockResolvedValue(9);

    await createTabActions(tabApi({ update, move, group })).reorder(crossGroupPlan);

    expect(update).not.toHaveBeenCalled();
    expect(group).toHaveBeenCalledWith({ tabIds: 7, groupId: 9 });
    expect(move).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledWith(7, { index: 0 });
    expect(group.mock.invocationCallOrder[0]!).toBeLessThan(move.mock.invocationCallOrder[0]!);
  });

  it("unpins, groups, then moves a pinned tab into a group", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);
    const group = vi.fn().mockResolvedValue(9);

    await createTabActions(tabApi({ update, move, group })).reorder(pinnedToGroupPlan);

    expect(update).toHaveBeenCalledWith(7, { pinned: false });
    expect(group).toHaveBeenCalledWith({ tabIds: 7, groupId: 9 });
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(group.mock.invocationCallOrder[0]!);
    expect(group.mock.invocationCallOrder[0]!).toBeLessThan(move.mock.invocationCallOrder[0]!);
  });

  it("ungroups, pins, then moves a grouped tab into pinned tabs", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);
    const ungroup = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ update, move, ungroup })).reorder(groupToPinnedPlan);

    expect(ungroup).toHaveBeenCalledWith(7);
    expect(update).toHaveBeenCalledWith(7, { pinned: true });
    expect(ungroup.mock.invocationCallOrder[0]!).toBeLessThan(update.mock.invocationCallOrder[0]!);
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(move.mock.invocationCallOrder[0]!);
  });

  it("ungroups before moving a tab out of a group", async () => {
    const move = vi.fn().mockResolvedValue(tab);
    const ungroup = vi.fn().mockResolvedValue(undefined);

    await createTabActions(tabApi({ move, ungroup })).reorder(removeFromGroupPlan);

    expect(ungroup).toHaveBeenCalledWith(7);
    expect(ungroup.mock.invocationCallOrder[0]!).toBeLessThan(move.mock.invocationCallOrder[0]!);
  });

  it("reorders across groups when called without its owner object", async () => {
    const group = vi.fn().mockResolvedValue(9);
    const move = vi.fn().mockResolvedValue(tab);
    const { reorder } = createTabActions(tabApi({ group, move }));

    await reorder(crossGroupPlan);

    expect(group).toHaveBeenCalledWith({ tabIds: 7, groupId: 9 });
    expect(move).toHaveBeenCalledWith(7, { index: 0 });
  });

  it.each([
    ["unpin", pinnedToGroupPlan, "update", ["group", "move"]],
    ["group", crossGroupPlan, "group", ["move"]],
    ["ungroup", groupToPinnedPlan, "ungroup", ["update", "move"]],
    ["pin", groupToPinnedPlan, "update", ["move"]],
    ["move", sameGroupPlan, "move", []],
  ] as const)(
    "preserves the cause and stops after a %s failure",
    async (step, plan, failingMethod, laterMethods) => {
      const cause = new Error(`${step} failed`);
      const failingCall = vi.fn().mockRejectedValue(cause);
      const api = tabApi({ [failingMethod]: failingCall });

      let received: unknown;
      try {
        await createTabActions(api).reorder(plan);
      } catch (error) {
        received = error;
      }

      expect(received).toBeInstanceOf(Error);
      expect(received).toMatchObject({ message: "无法移动该标签页", cause });
      expect(failingCall).toHaveBeenCalledOnce();
      for (const method of laterMethods) {
        expect(api[method]).not.toHaveBeenCalled();
      }
    },
  );
});

describe("shortcut actions", () => {
  it("normalizes a URL and opens it in an active tab", async () => {
    const create = vi.fn().mockResolvedValue(tab);

    await createShortcutActions({ create }).open(" example.com/docs ");

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ url: "https://example.com/docs", active: true });
  });

  it("preserves the model validation error and does not create a tab", async () => {
    const create = vi.fn();

    await expect(createShortcutActions({ create }).open("javascript:alert(1)")).rejects.toThrow(
      "仅支持 HTTP 或 HTTPS 地址",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a create %s to the user-facing error", async (_case, makeCreate) => {
    await expect(createShortcutActions({ create: makeCreate() }).open("https://example.com")).rejects.toThrow(
      "无法打开快捷网站",
    );
  });
});
