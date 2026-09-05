import { describe, expect, it, vi } from "vitest";
import { createFloatingBallBackground } from "../src/floating-ball/background-actions";

function sender(tabId = 42, windowId = 7): chrome.runtime.MessageSender {
  return { tab: { id: tabId, windowId, url: "https://page.example/" } as chrome.tabs.Tab };
}

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 42,
    windowId: 7,
    index: 0,
    title: "Page",
    url: "https://page.example/",
    active: true,
    pinned: false,
    groupId: -1,
    highlighted: true,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("floating ball background actions", () => {
  it("uses sender tab for duplicate, pin, close and search result open", async () => {
    const deps = {
      tabs: {
        query: vi.fn().mockResolvedValue([tab()]),
        create: vi.fn().mockResolvedValue(tab({ id: 99 })),
        duplicate: vi.fn().mockResolvedValue(tab({ id: 43 })),
        get: vi.fn().mockResolvedValue(tab()),
        update: vi.fn().mockResolvedValue(tab({ pinned: true })),
        remove: vi.fn().mockResolvedValue(undefined),
        group: vi.fn().mockResolvedValue(1),
      },
      tabGroups: { query: vi.fn().mockResolvedValue([]), get: vi.fn(), update: vi.fn() },
      bookmarks: { search: vi.fn().mockResolvedValue([]) },
      history: { search: vi.fn().mockResolvedValue([]) },
      search: { query: vi.fn().mockResolvedValue(undefined) },
      sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
      scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    };
    const background = createFloatingBallBackground(deps);

    await background.handle({ type: "floating-ball/duplicate-tab" }, sender());
    await background.handle({ type: "floating-ball/toggle-pin" }, sender());
    await background.handle({ type: "floating-ball/close-tab" }, sender());
    await background.handle({ type: "floating-ball/open-search-result", url: "https://result.example/" }, sender());
    await expect(background.handle({ type: "floating-ball/get-tab-state" }, sender())).resolves.toEqual({
      ok: true,
      value: { pinned: false },
    });

    expect(deps.tabs.duplicate).toHaveBeenCalledWith(42);
    expect(deps.tabs.update).toHaveBeenCalledWith(42, { pinned: true });
    expect(deps.tabs.remove).toHaveBeenCalledWith(42);
    expect(deps.tabs.create).toHaveBeenCalledWith({ url: "https://result.example/", active: true });
  });

  it("rejects messages without a valid sender tab", async () => {
    const background = createFloatingBallBackground({} as never);

    await expect(background.handle({ type: "floating-ball/close-tab" }, {})).resolves.toEqual({
      ok: false,
      error: "invalid-sender",
      message: "当前页面不可用",
    });
  });

  it("reuses an existing Other group for current-window one-click grouping", async () => {
    const deps = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          tab({ id: 42, url: "https://first.example/", groupId: -1 }),
          tab({ id: 43, index: 1, url: "https://second.example/", groupId: -1 }),
        ]),
        create: vi.fn(), duplicate: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(),
        group: vi.fn().mockResolvedValue(9),
      },
      tabGroups: {
        query: vi.fn().mockResolvedValue([{ id: 9, windowId: 7, title: "其他", color: "blue" }]),
        get: vi.fn(), update: vi.fn(),
      },
      bookmarks: { search: vi.fn() }, history: { search: vi.fn() }, sidePanel: { open: vi.fn() },
      search: { query: vi.fn() },
      scripting: { executeScript: vi.fn() },
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
    };
    const background = createFloatingBallBackground(deps);

    await expect(background.handle({ type: "floating-ball/smart-group-window" }, sender())).resolves.toEqual({ ok: true });
    expect(deps.tabs.group).toHaveBeenCalledWith({ groupId: 9, tabIds: [42, 43] });
  });

  it("opens a trimmed query with the browser default search in a new tab", async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const background = createFloatingBallBackground({
      tabs: {} as never,
      tabGroups: {} as never,
      bookmarks: {} as never,
      history: {} as never,
      search: { query },
      sidePanel: {} as never,
      scripting: {} as never,
      storage: {} as never,
    });

    await expect(background.handle({
      type: "floating-ball/search-web",
      query: "  状态管理  ",
    }, sender())).resolves.toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith({ text: "状态管理", disposition: "NEW_TAB" });
  });

  it("maps browser search rejection to a controlled operation failure", async () => {
    const background = createFloatingBallBackground({
      tabs: {} as never,
      tabGroups: {} as never,
      bookmarks: {} as never,
      history: {} as never,
      search: { query: vi.fn().mockRejectedValue(new Error("search unavailable")) },
      sidePanel: {} as never,
      scripting: {} as never,
      storage: {} as never,
    });

    await expect(background.handle({
      type: "floating-ball/search-web",
      query: "missing",
    }, sender())).resolves.toEqual({
      ok: false,
      error: "operation-failed",
      message: "悬浮球操作失败",
    });
  });

  it("requires a valid sender before opening browser search", async () => {
    const query = vi.fn();
    const background = createFloatingBallBackground({
      search: { query },
    } as never);

    await expect(background.handle({
      type: "floating-ball/search-web",
      query: "missing",
    }, {})).resolves.toEqual({
      ok: false,
      error: "invalid-sender",
      message: "当前页面不可用",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
