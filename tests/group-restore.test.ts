import { describe, expect, it, vi } from "vitest";
import { createGroupRestore, type RestoreApi } from "../src/group-restore/controller";
import { createRestoreSettingsStore } from "../src/group-restore/settings";

function area() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); }),
  };
}

function browser() {
  const local = area();
  const session = area();
  let windows = [{ id: 1, incognito: false, type: "normal" }];
  let tabs = [{ id: 1, windowId: 1, groupId: 10, index: 0, url: "https://example.com/", incognito: false }];
  let groups = [{ id: 10, windowId: 1, title: "阅读", color: "blue", collapsed: false }];
  let nextId = 100;
  const api = {
    local, session,
    windows: { getAll: vi.fn(async () => structuredClone(windows)) },
    tabs: {
      query: vi.fn(async () => structuredClone(tabs)),
      create: vi.fn(async ({ windowId, url }: { windowId: number; url: string }) => {
        const tab = { id: nextId++, windowId, url, groupId: -1, index: tabs.length, incognito: false };
        tabs.push(tab);
        return structuredClone(tab);
      }),
      group: vi.fn(async ({ tabIds }: { tabIds: number[] }) => {
        const id = nextId++;
        const windowId = tabs.find((tab) => tab.id === tabIds[0])!.windowId;
        groups.push({ id, windowId, title: "", color: "grey", collapsed: false });
        tabs.filter((tab) => tabIds.includes(tab.id)).forEach((tab) => { tab.groupId = id; });
        return id;
      }),
      remove: vi.fn(async (ids: number[]) => {
        tabs = tabs.filter((tab) => !ids.includes(tab.id));
        groups = groups.filter((group) => tabs.some((tab) => tab.groupId === group.id));
      }),
    },
    tabGroups: {
      query: vi.fn(async () => structuredClone(groups)),
      update: vi.fn(async (id: number, change: object) => {
        const group = groups.find((group) => group.id === id)!;
        Object.assign(group, change);
        return structuredClone(group);
      }),
    },
  } satisfies RestoreApi;
  return {
    api, local, session,
    tabs: () => tabs, groups: () => groups,
    restart() { windows = [{ id: 2, incognito: false, type: "normal" }]; tabs = []; groups = []; Object.keys(session.data).forEach((key) => delete session.data[key]); },
    closeWindow() { windows = []; tabs = []; groups = []; },
    closeOne(id: number) {
      windows = windows.filter((window) => window.id !== id);
      tabs = tabs.filter((tab) => tab.windowId !== id);
      groups = groups.filter((group) => group.windowId !== id);
    },
    clearGroups() { groups = []; tabs = []; },
    addWindow(id: number, incognito = false) { windows.push({ id, incognito, type: "normal" }); },
    async enable(collapsed = true) { await createRestoreSettingsStore(local).save({ enabled: true, collapsed }); },
  };
}

describe("分组恢复", () => {
  it("默认关闭自动恢复并默认折叠，设置持久化", async () => {
    const storage = area();
    const store = createRestoreSettingsStore(storage);
    expect(await store.load()).toEqual({ enabled: false, collapsed: true });
    await store.save({ enabled: true, collapsed: false });
    expect(await store.load()).toEqual({ enabled: true, collapsed: false });
  });

  it.each([true, false])("重启后恢复网页、名称和颜色，折叠=%s", async (collapsed) => {
    const b = browser();
    await b.enable(collapsed);
    await createGroupRestore(b.api).open(1);
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.tabs().map((tab) => tab.url)).toEqual(["https://example.com/"]);
    expect(b.groups()).toEqual([expect.objectContaining({ title: "阅读", color: "blue", collapsed })]);
  });

  it("关闭开关不创建网页", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    await createRestoreSettingsStore(b.local).save({ enabled: false, collapsed: true });
    await createGroupRestore(b.api).open(2);
    expect(b.api.tabs.create).not.toHaveBeenCalled();
  });

  it("首次启用保存当前网页，即使没有重新打开侧边栏", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).settingsSaved(1);
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.tabs()).toHaveLength(1);
  });

  it("修改展开偏好后下次打开应用新设置", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    await controller.open(1);
    expect(b.groups()[0]!.collapsed).toBe(true);
    await b.enable(false);
    await controller.settingsSaved(1);
    await controller.open(1);
    expect(b.groups()[0]!.collapsed).toBe(false);
  });

  it("不复制仍在其他窗口打开的分组", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    await controller.open(1);
    b.addWindow(2);
    await controller.open(2);
    expect(b.tabs()).toHaveLength(1);
    expect(b.tabs()[0]!.windowId).toBe(1);
  });

  it("启用后记录没有打开过侧边栏的新窗口分组", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    await controller.open(1);
    b.addWindow(2);
    b.groups().push({ ...b.groups()[0]!, id: 20, windowId: 2, title: "新窗口" });
    b.tabs().push({ ...b.tabs()[0]!, id: 2, windowId: 2, groupId: 20 });
    await controller.capture();
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.groups().map((group) => group.title)).toEqual(["阅读", "新窗口"]);
  });

  it("关闭窗口的相同分组不能与仍打开窗口的独立分组合并", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    b.addWindow(2);
    b.groups().push({ ...b.groups()[0]!, id: 20, windowId: 2 });
    b.tabs().push({ ...b.tabs()[0]!, id: 2, windowId: 2, groupId: 20 });
    await controller.open(1);
    b.closeOne(2);
    controller.windowClosing(2);
    b.addWindow(3);
    await controller.open(3);
    expect(b.groups()).toHaveLength(2);
    expect(b.tabs().map((tab) => tab.windowId)).toEqual([1, 3]);
  });

  it("恢复过程中其他窗口关闭仍保留其快照", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    b.addWindow(2);
    b.groups().push({ ...b.groups()[0]!, id: 20, windowId: 2, title: "另一组" });
    b.tabs().push({ ...b.tabs()[0]!, id: 2, windowId: 2, groupId: 20, url: "https://second.example/" });
    await controller.open(1);
    b.closeOne(2);
    controller.windowClosing(2);
    b.addWindow(3);
    const create = b.api.tabs.create.getMockImplementation()!;
    b.api.tabs.create.mockImplementationOnce(async (properties) => {
      b.closeOne(1);
      controller.windowClosing(1);
      return create(properties);
    });
    await controller.open(3);
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.groups().map((group) => group.title).sort()).toEqual(["另一组", "阅读"].sort());
  });

  it("不向隐身窗口恢复网页", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    b.addWindow(3, true);
    await createGroupRestore(b.api).open(3);
    expect(b.tabs()).toHaveLength(0);
  });

  it("过滤不可恢复的 URL 和隐身标签", async () => {
    const b = browser();
    b.tabs().push({ ...b.tabs()[0]!, id: 2, url: "javascript:alert(1)" });
    b.tabs().push({ ...b.tabs()[0]!, id: 3, url: "https://private.example/", incognito: true });
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.tabs().map((tab) => tab.url)).toEqual(["https://example.com/"]);
  });

  it("保留同名同色同网址分组的数量", async () => {
    const b = browser();
    b.groups().push({ ...b.groups()[0]!, id: 11 });
    b.tabs().push({ ...b.tabs()[0]!, id: 2, groupId: 11 });
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.groups()).toHaveLength(2);
    expect(b.tabs()).toHaveLength(2);
  });

  it("重复和并发打开不重复恢复，也不覆盖手动展开", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    const controller = createGroupRestore(b.api);
    await Promise.all([controller.open(2), controller.open(2)]);
    b.groups()[0]!.collapsed = false;
    await createGroupRestore(b.api).open(2);
    expect(b.api.tabs.create).toHaveBeenCalledTimes(1);
    expect(b.groups()[0]!.collapsed).toBe(false);
  });

  it("Chrome 已恢复的相同分组不再创建", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    Object.keys(b.session.data).forEach((key) => delete b.session.data[key]);
    await createGroupRestore(b.api).open(1);
    expect(b.api.tabs.create).not.toHaveBeenCalled();
  });

  it("Chrome 自动恢复后先捕获再关闭窗口，不产生跨会话双份快照", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    Object.keys(b.session.data).forEach((key) => delete b.session.data[key]);
    const controller = createGroupRestore(b.api);
    await controller.capture();
    await controller.capture();
    b.closeOne(1);
    controller.windowClosing(1);
    b.addWindow(2);
    await controller.open(2);
    expect(b.groups()).toHaveLength(1);
  });

  it("Chrome 分批恢复成员时，完整分组仍能接管旧快照", async () => {
    const b = browser();
    await b.enable();
    b.tabs().push({ ...b.tabs()[0]!, id: 2, index: 1, url: "https://second.example/" });
    await createGroupRestore(b.api).open(1);
    Object.keys(b.session.data).forEach((key) => delete b.session.data[key]);
    const second = b.tabs().pop()!;
    const controller = createGroupRestore(b.api);
    await controller.capture();
    b.tabs().push(second);
    await controller.capture();
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.groups()).toHaveLength(1);
    expect(b.tabs()).toHaveLength(2);
  });

  it("关闭窗口不清空快照", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    await controller.open(1);
    b.closeWindow();
    controller.windowClosing(1);
    await controller.capture();
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.tabs()).toHaveLength(1);
  });

  it("手动删除分组更新快照，重启不复活", async () => {
    const b = browser();
    await b.enable();
    const controller = createGroupRestore(b.api);
    await controller.open(1);
    b.clearGroups();
    await controller.capture();
    b.restart();
    await createGroupRestore(b.api).open(2);
    expect(b.tabs()).toHaveLength(0);
  });

  it("恢复失败回滚新网页，保留快照供下次重试", async () => {
    const b = browser();
    await b.enable();
    await createGroupRestore(b.api).open(1);
    b.restart();
    b.api.tabGroups.update.mockRejectedValueOnce(new Error("失败"));
    const controller = createGroupRestore(b.api);
    await expect(controller.open(2)).rejects.toThrow();
    expect(b.tabs()).toHaveLength(0);
    await controller.open(2);
    expect(b.tabs()).toHaveLength(1);
  });
});
