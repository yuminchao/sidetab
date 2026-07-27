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
};
const crossGroupPlan: TabReorderPlan = {
  tabId: 7,
  targetIndex: 0,
  targetPinned: true,
  pinnedChanged: true,
};

function tabApi(overrides: Partial<Parameters<typeof createTabActions>[0]> = {}) {
  return {
    update: vi.fn().mockResolvedValue(tab),
    remove: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockResolvedValue(tab),
    move: vi.fn().mockResolvedValue(tab),
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

  it("moves within a group without changing pinned state", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ update, move })).reorder(sameGroupPlan);

    expect(update).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledWith(7, { index: 2 });
  });

  it("updates pinned state before moving across groups", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);

    await createTabActions(tabApi({ update, move })).reorder(crossGroupPlan);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { pinned: true });
    expect(move).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledWith(7, { index: 0 });
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(move.mock.invocationCallOrder[0]!);
  });

  it("reorders across groups when the action is called without its owner object", async () => {
    const update = vi.fn().mockResolvedValue(tab);
    const move = vi.fn().mockResolvedValue(tab);
    const { reorder } = createTabActions(tabApi({ update, move }));

    await reorder(crossGroupPlan);

    expect(update).toHaveBeenCalledWith(7, { pinned: true });
    expect(move).toHaveBeenCalledWith(7, { index: 0 });
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("does not move across groups after a pinning %s", async (_case, makeUpdate) => {
    const update = makeUpdate();
    const move = vi.fn().mockResolvedValue(tab);

    await expect(createTabActions(tabApi({ update, move })).reorder(crossGroupPlan)).rejects.toThrow(
      "无法更新标签固定状态",
    );
    expect(move).not.toHaveBeenCalled();
  });

  it.each([
    ["same group synchronous throw", sameGroupPlan, () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["same group promise rejection", sameGroupPlan, () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
    ["across groups synchronous throw", crossGroupPlan, () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["across groups promise rejection", crossGroupPlan, () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a %s to the user-facing error", async (_case, plan, makeMove) => {
    const move = makeMove();
    await expect(
      createTabActions(tabApi({ move })).reorder(plan),
    ).rejects.toThrow("无法移动该标签页");
  });
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
