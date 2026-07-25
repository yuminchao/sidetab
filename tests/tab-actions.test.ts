import { describe, expect, it, vi } from "vitest";
import { createShortcutActions } from "../src/sidepanel/shortcut-actions";
import { createTabActions } from "../src/sidepanel/tab-actions";

const tab = { id: 7, windowId: 3, index: 0 } as chrome.tabs.Tab;

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

    await createTabActions({ update, remove: vi.fn() }).activate(7);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(7, { active: true });
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps an activate %s to the user-facing error", async (_case, makeUpdate) => {
    const actions = createTabActions({ update: makeUpdate(), remove: vi.fn() });

    await expect(actions.activate(7)).rejects.toThrow("无法切换到该标签页");
  });

  it("closes exactly the requested tab", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await createTabActions({ update: vi.fn(), remove }).close(7);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(7);
  });

  it.each([
    ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
    ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
  ])("maps a close %s to the user-facing error", async (_case, makeRemove) => {
    const actions = createTabActions({ update: vi.fn(), remove: makeRemove() });

    await expect(actions.close(7)).rejects.toThrow("无法关闭该标签页");
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
