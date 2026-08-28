# 右键菜单、收藏夹与搜索体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让标签页和分组右键菜单只显示可执行动作，增加当前标签收藏功能，并让侧边栏与悬浮球在无本地结果时使用 Chrome 默认搜索引擎搜索，同时统一悬浮球结果样式。

**Architecture:** 保留现有预创建菜单 DOM，通过上下文可见性和统一分隔线整理函数控制菜单；收藏可用性在菜单打开前按 URL 精确查询，收藏写入仍由侧边栏命令层执行。侧边栏搜索通过注入回调调用 `chrome.search`，悬浮球通过严格校验的消息交给 Service Worker 调用同一 API。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、Vitest、JSDOM、原生 DOM/CSS、Chrome `bookmarks` 与 `search` API。

---

## 文件结构

- 修改 `src/sidepanel/tab-context-menu.ts`：主菜单、分组子菜单的动作可见性，异步收藏可用性和分隔线整理。
- 修改 `src/sidepanel/tab-group-context-menu.ts`：忙碌分组不打开、不可用动作隐藏、颜色子菜单隐藏当前颜色。
- 新建 `src/sidepanel/bookmark-actions.ts`：封装可收藏 URL 校验、精确收藏查询和单书签创建。
- 修改 `src/sidepanel/sidebar.ts`：提供收藏动作、默认搜索回调和受控错误状态。
- 修改 `src/sidepanel/history-search.ts`：无结果 Enter 调用网页搜索并管理查询完成状态。
- 修改 `src/floating-ball/messages.ts`、`background-actions.ts`、`controller.ts`：增加网页搜索消息、后台调用、无结果 Enter 和结构化搜索结果。
- 修改 `src/background/service-worker.ts`：注入 `chrome.search`。
- 修改 `src/sidepanel/sidebar.css`：仅在共享样式需要明确补充时调整；侧边栏现有胶囊样式作为视觉基准。
- 修改 `manifest.json`、`README.md`、`docs/chrome-web-store-checklist.md`、`docs/privacy-policy.md`、`update.log`：权限、隐私和发布说明。
- 修改对应测试文件，新增 `tests/bookmark-actions.test.ts`。

### Task 1: 右键菜单只显示可执行动作

**Files:**
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `src/sidepanel/tab-group-context-menu.ts`
- Test: `tests/tab-context-menu.test.ts`
- Test: `tests/tab-group-context-menu.test.ts`

- [ ] **Step 1: 写标签页菜单失败测试**

把现有断言从 `disabled` 改为 `hidden`，并新增分隔线及子菜单用例：

```ts
// 同时在 menuContext 的 availability 类型中加入 canDuplicate?: boolean。
it("hides unavailable commands and removes empty separators", () => {
  const menu = createTabContextMenu(
    { document, list, viewport: window },
    {
      getContext: (id) => menuContext(id, {
        canDuplicate: false,
        canOpenAllShortcuts: false,
        canQuickGroupSameSite: false,
        canGroupAll: false,
        canDissolveTree: false,
        canDeleteSubtree: false,
        canCloseBelow: false,
        canCloseAbove: false,
        canCloseOtherSameSite: false,
      }),
      getGroups: () => [],
      onCommand: vi.fn(),
    },
  );

  context(row(1));
  const popup = document.querySelector<HTMLElement>(
    ".tab-context-menu:not(.tab-context-submenu)",
  )!;
  expect(popup.querySelector<HTMLButtonElement>("[data-menu-action='duplicate']")!.hidden).toBe(true);
  expect(popup.querySelector<HTMLButtonElement>("[data-menu-action='dissolve-tree']")!.hidden).toBe(true);
  expect(popup.querySelector<HTMLButtonElement>("[data-menu-action='delete-subtree']")!.hidden).toBe(true);
  const visible = Array.from(popup.children).filter((item) => !(item as HTMLElement).hidden);
  expect(visible[0]?.classList.contains("tab-context-separator")).toBe(false);
  expect(visible.at(-1)?.classList.contains("tab-context-separator")).toBe(false);
  expect(visible.some((item, index) =>
    item.classList.contains("tab-context-separator")
    && visible[index + 1]?.classList.contains("tab-context-separator"))).toBe(false);
  menu.destroy();
});

it("hides the currently selected target group", () => {
  const menu = createTabContextMenu(
    { document, list, viewport: window },
    { getContext: menuContext, getGroups: () => groups, onCommand: vi.fn() },
  );
  context(row(2));
  const addToGroup = document.querySelector<HTMLButtonElement>("[data-menu-action='add-to-group']")!;
  addToGroup.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  const current = document.querySelector<HTMLButtonElement>(
    ".tab-context-submenu [data-group-id='3']",
  )!;
  expect(current.hidden).toBe(true);
  expect(current.disabled).toBe(false);
  menu.destroy();
});
```

- [ ] **Step 2: 运行标签页菜单测试确认 RED**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，旧实现仍设置 `disabled`，分隔线保持显示，当前分组仍为禁用单选项。

- [ ] **Step 3: 实现标签页菜单可见性和分隔线整理**

在 `tab-context-menu.ts` 增加并使用以下内部函数：

```ts
function setAvailable(item: HTMLButtonElement, available: boolean): void {
  item.hidden = !available;
  item.disabled = false;
}

function syncSeparators(container: HTMLElement): void {
  const children = Array.from(container.children) as HTMLElement[];
  let hasVisibleItem = false;
  for (const child of children) {
    if (child.classList.contains("tab-context-separator")) {
      child.hidden = !hasVisibleItem;
      hasVisibleItem = false;
      continue;
    }
    if (!child.hidden && child.matches("button[role^='menuitem']")) hasVisibleItem = true;
  }
  let hasFollowingItem = false;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    if (child.classList.contains("tab-context-separator")) {
      child.hidden = child.hidden || !hasFollowingItem;
      hasFollowingItem = false;
      continue;
    }
    if (!child.hidden && child.matches("button[role^='menuitem']")) hasFollowingItem = true;
  }
}
```

将 `open()` 内全部 `disabled = !can*` 改为 `setAvailable()`；`removeFromGroup` 继续按组状态隐藏；`restoreRecentlyClosed` 无 session 时隐藏。调用 `syncSeparators(menu)` 后再测量和定位。`openSubmenu()` 中将当前分组按钮设为 `hidden = selected`，不再禁用。

- [ ] **Step 4: 运行标签页菜单测试确认 GREEN**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: PASS。

- [ ] **Step 5: 写分组菜单失败测试**

```ts
it("does not open for a busy group and hides unavailable close", () => {
  const busyController = createTabGroupContextMenu(
    { document, list, viewport: window },
    {
      getGroup: () => group,
      isGroupBusy: () => true,
      canCloseGroup: () => false,
      onBeforeOpen: vi.fn(),
      onCommand: vi.fn(),
    },
  );
  context(row);
  expect(document.querySelector<HTMLElement>(".tab-group-context-menu")!.hidden).toBe(true);
  busyController.destroy();
});

it("hides close and the current color instead of disabling them", () => {
  const controller = createTabGroupContextMenu(
    { document, list, viewport: window },
    {
      getGroup: () => group,
      isGroupBusy: () => false,
      canCloseGroup: () => false,
      onBeforeOpen: vi.fn(),
      onCommand: vi.fn(),
    },
  );
  context(row);
  const menu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;
  expect(menu.querySelector<HTMLButtonElement>("[data-group-menu-action='close']")!.hidden).toBe(true);
  menu.querySelector<HTMLButtonElement>("[data-group-menu-action='set-color']")!.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true }),
  );
  const selected = document.querySelector<HTMLButtonElement>(
    ".tab-group-color-submenu [data-color='blue']",
  )!;
  expect(selected.hidden).toBe(true);
  expect(selected.disabled).toBe(false);
  controller.destroy();
});
```

- [ ] **Step 6: 运行分组菜单测试确认 RED**

Run: `npm test -- --run tests/tab-group-context-menu.test.ts`

Expected: FAIL，旧实现仍打开忙碌菜单并禁用动作。

- [ ] **Step 7: 实现分组菜单隐藏规则**

在 `open()` 开头调用 `onBeforeOpen()` 和 `close()` 后，若 `isGroupBusy(group.id)` 直接返回；非忙碌时保持新建、重命名、颜色和解散可见，使用 `closeGroup.hidden = !canCloseGroup(group.id)`，整理分隔线后定位。颜色子菜单使用 `button.hidden = selected`，全部可见按钮保持 `disabled = false`。

- [ ] **Step 8: 运行两套菜单测试确认 GREEN**

Run: `npm test -- --run tests/tab-context-menu.test.ts tests/tab-group-context-menu.test.ts`

Expected: 2 files PASS。

- [ ] **Step 9: 提交菜单可见性改动**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 优化右键菜单可见操作"
git add src/sidepanel/tab-context-menu.ts src/sidepanel/tab-group-context-menu.ts tests/tab-context-menu.test.ts tests/tab-group-context-menu.test.ts
git commit -m $message
```

### Task 2: 添加当前标签到收藏夹

**Files:**
- Create: `src/sidepanel/bookmark-actions.ts`
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Create: `tests/bookmark-actions.test.ts`
- Modify: `tests/tab-context-menu.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写收藏领域动作失败测试**

```ts
describe("bookmark actions", () => {
  function tabModel(overrides: Partial<TabViewModel> = {}): TabViewModel {
    return {
      id: 1,
      windowId: 10,
      index: 0,
      title: "示例",
      url: "https://example.com/",
      domain: "example.com",
      active: false,
      pinned: false,
      groupId: -1,
      ...overrides,
    };
  }

  it("checks an exact web URL and creates one bookmark", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: "1" });
    const actions = createBookmarkActions({ search, create });
    const tab = tabModel({ title: "文档", url: "https://example.com/docs" });

    await expect(actions.canAdd(tab)).resolves.toBe(true);
    expect(search).toHaveBeenCalledWith({ url: "https://example.com/docs" });
    await actions.add(tab);
    expect(create).toHaveBeenCalledWith({ title: "文档", url: "https://example.com/docs" });
  });

  it.each(["chrome://settings", "", "not a url"])("rejects unsupported URL %s", async (url) => {
    const actions = createBookmarkActions({ search: vi.fn(), create: vi.fn() });
    await expect(actions.canAdd(tabModel({ url }))).resolves.toBe(false);
    await expect(actions.add(tabModel({ url }))).rejects.toThrow("当前标签无法添加到收藏夹");
  });

  it("hides an existing exact bookmark", async () => {
    const actions = createBookmarkActions({
      search: vi.fn().mockResolvedValue([{ id: "b", url: "https://example.com/" }]),
      create: vi.fn(),
    });
    await expect(actions.canAdd(tabModel({ url: "https://example.com/" }))).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 运行收藏动作测试确认 RED**

Run: `npm test -- --run tests/bookmark-actions.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现收藏动作模块**

```ts
import type { TabViewModel } from "./tab-model";

export type BookmarkActions = {
  canAdd(tab: Readonly<TabViewModel>): Promise<boolean>;
  add(tab: Readonly<TabViewModel>): Promise<void>;
};

export function createBookmarkActions(
  api: Pick<typeof chrome.bookmarks, "search" | "create">,
): BookmarkActions {
  return {
    async canAdd(tab) {
      const url = getBookmarkableUrl(tab.url);
      if (!url) return false;
      const matches = await api.search({ url });
      return !matches.some((item) => item.url === url);
    },
    async add(tab) {
      const url = getBookmarkableUrl(tab.url);
      if (!url) throw new Error("当前标签无法添加到收藏夹");
      try {
        await api.create({ title: tab.title || url, url });
      } catch {
        throw new Error("添加收藏夹失败");
      }
    },
  };
}

function getBookmarkableUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
```

对导出接口和包含 Chrome 外部调用的方法补充符合仓库规则的中文 Google 风格注释，包含参数、返回值和异常约定。

- [ ] **Step 4: 运行收藏动作测试确认 GREEN**

Run: `npm test -- --run tests/bookmark-actions.test.ts`

Expected: PASS。

- [ ] **Step 5: 写菜单异步收藏可用性失败测试**

为 `createTabContextMenu` 增加 `canAddBookmark(tab)` 异步回调的期望：未收藏时显示 `add-bookmark` 并派发 `{ action: "add-bookmark", tabId }`；已收藏、查询失败时隐藏；较早查询晚完成时不得打开旧菜单。

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

const first = deferred<boolean>();
const canAddBookmark = vi.fn()
  .mockReturnValueOnce(first.promise)
  .mockResolvedValueOnce(true);
context(row(1));
context(row(2));
await flush();
first.resolve(true);
await flush();
expect(row(2).dataset.contextSelected).toBe("true");
expect(row(1).dataset.contextSelected).toBeUndefined();
```

- [ ] **Step 6: 运行菜单测试确认 RED**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，收藏动作和异步打开代次尚不存在。

- [ ] **Step 7: 实现异步菜单打开和收藏命令**

在 `TabContextCommand` 增加 `{ action: "add-bookmark"; tabId: number }`，在菜单快捷网站动作前插入“添加到收藏夹”。回调增加：

```ts
canAddBookmark?(tab: Readonly<TabViewModel>): Promise<boolean>;
```

鼠标或键盘触发后立即 `preventDefault()`，递增 `openGeneration`，执行收藏查询；查询失败折叠为 `false`。完成后重新调用 `getContext(tabId)`，仅在代次仍一致、行仍连接且 URL 未变化时打开菜单。`close()`、滚动、resize、destroy 和新菜单请求都递增代次。没有提供回调的测试/调用方按不可收藏处理但保持同步打开兼容。

- [ ] **Step 8: 在侧边栏接入收藏动作并写集成失败测试**

在 `sidebar.ts` 创建 `bookmarkActions = createBookmarkActions(deps.bookmarks)`，菜单回调使用 `canAddBookmark: (tab) => bookmarkActions.canAdd(tab)`。命令处理：

```ts
if (command.action === "add-bookmark") {
  const tab = tabStore.get(command.tabId);
  if (!tab) return;
  runTabOperation(bookmarkActions.add(tab));
  return;
}
```

`bookmarkActions.add()` 将 Chrome 创建异常转换为“添加收藏夹失败”，由现有 `runTabOperation(operation, onSettled?, onRejected?)` 的统一失败路径展示。测试验证精确查询、创建参数、查询失败仍显示其他菜单、创建失败状态和目标标签消失时不调用 Chrome。

- [ ] **Step 9: 运行收藏相关测试确认 GREEN**

Run: `npm test -- --run tests/bookmark-actions.test.ts tests/tab-context-menu.test.ts tests/sidebar.test.ts`

Expected: 3 files PASS。

- [ ] **Step 10: 提交收藏功能**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 新增标签页收藏菜单"
git add src/sidepanel/bookmark-actions.ts src/sidepanel/tab-context-menu.ts src/sidepanel/sidebar.ts tests/bookmark-actions.test.ts tests/tab-context-menu.test.ts tests/sidebar.test.ts
git commit -m $message
```

### Task 3: 侧边栏无结果时使用默认搜索引擎

**Files:**
- Modify: `src/sidepanel/history-search.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Test: `tests/history-search.test.ts`
- Test: `tests/sidebar.test.ts`

- [ ] **Step 1: 写无结果 Enter 失败测试**

```ts
it("searches the web only after a completed empty local query", async () => {
  vi.useFakeTimers();
  const onSearchWeb = vi.fn().mockResolvedValue(undefined);
  const controller = createHistorySearchController(
    { document, input, results },
    {
      bookmarks: { search: vi.fn().mockResolvedValue([]) },
      history: { search: vi.fn().mockResolvedValue([]) },
      onOpen: vi.fn(),
      onSearchWeb,
    },
  );
  input.value = "  状态管理  ";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(onSearchWeb).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  await flush();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(onSearchWeb).toHaveBeenCalledWith("状态管理");
  controller.destroy();
});
```

再增加：空输入不调用、有结果时 Enter 调用 `onOpen` 而非 `onSearchWeb`、网页搜索失败保留输入并显示“无法打开浏览器搜索”。

- [ ] **Step 2: 运行搜索控制器测试确认 RED**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: FAIL，回调类型和无结果 Enter 行为不存在。

- [ ] **Step 3: 实现侧边栏搜索回退状态机**

回调类型增加：

```ts
onSearchWeb(query: string): Promise<void>;
```

控制器增加 `queryPending` 和 `settledQuery`。`runQuery()` 开始时设置 pending，只有当前代次完成并渲染结果后才记录去空白查询。Enter 处理顺序：

```ts
if (event.key === "Enter") {
  const query = elements.input.value.trim();
  if (currentResults.length > 0) {
    event.preventDefault();
    void openResult(selectedIndex);
  } else if (!queryPending && query && settledQuery === query) {
    event.preventDefault();
    void searchWeb(query);
  }
}
```

`searchWeb()` 捕获当前代次，成功时清空输入并关闭；失败时只在代次有效时显示“无法打开浏览器搜索”。

- [ ] **Step 4: 在 sidebar 绑定 Chrome Search API**

在 Sidebar 依赖类型中加入 `search: Pick<typeof chrome.search, "query">`，创建控制器时传入：

```ts
onSearchWeb: (text) => deps.search.query({ text, disposition: "NEW_TAB" }),
```

Chrome 依赖工厂绑定 `search: chrome.search`。测试 fake Chrome 依赖增加 `search.query`，并验证参数精确等于 `{ text: "状态管理", disposition: "NEW_TAB" }`。

- [ ] **Step 5: 运行侧边栏搜索和集成测试确认 GREEN**

Run: `npm test -- --run tests/history-search.test.ts tests/sidebar.test.ts`

Expected: 2 files PASS。

- [ ] **Step 6: 提交侧边栏搜索回退**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 新增侧边栏默认搜索回退"
git add src/sidepanel/history-search.ts src/sidepanel/sidebar.ts tests/history-search.test.ts tests/sidebar.test.ts
git commit -m $message
```

### Task 4: 悬浮球搜索回退和结果视觉对齐

**Files:**
- Modify: `src/floating-ball/messages.ts`
- Modify: `src/floating-ball/background-actions.ts`
- Modify: `src/floating-ball/controller.ts`
- Modify: `src/background/service-worker.ts`
- Test: `tests/floating-ball-messages.test.ts`
- Test: `tests/floating-ball-background-actions.test.ts`
- Test: `tests/floating-ball-controller.test.ts`

- [ ] **Step 1: 写网页搜索消息失败测试**

```ts
expect(isFloatingBallRequest({
  type: "floating-ball/search-web",
  query: "  浏览器扩展  ",
})).toBe(true);
expect(isFloatingBallRequest({ type: "floating-ball/search-web", query: "   " })).toBe(false);
expect(isFloatingBallRequest({ type: "floating-ball/search-web", query: "x".repeat(201) })).toBe(false);
```

后台动作测试期望：

```ts
await expect(background.handle(
  { type: "floating-ball/search-web", query: "浏览器扩展" },
  validSender,
)).resolves.toEqual({ ok: true });
expect(search.query).toHaveBeenCalledWith({ text: "浏览器扩展", disposition: "NEW_TAB" });
```

- [ ] **Step 2: 运行消息和后台测试确认 RED**

Run: `npm test -- --run tests/floating-ball-messages.test.ts tests/floating-ball-background-actions.test.ts`

Expected: FAIL，消息类型和 `search` 依赖不存在。

- [ ] **Step 3: 实现网页搜索消息和后台调用**

在 `FloatingBallRequest` 增加 `{ type: "floating-ball/search-web"; query: string }`。校验器要求恰好两个字段、trim 后长度为 1..200。后台依赖增加 `search: Pick<typeof chrome.search, "query">`，switch 分支执行：

```ts
case "floating-ball/search-web":
  await deps.search.query({ text: message.query.trim(), disposition: "NEW_TAB" });
  return success();
```

`service-worker.ts` 注入 `search: chrome.search`。

- [ ] **Step 4: 运行消息和后台测试确认 GREEN**

Run: `npm test -- --run tests/floating-ball-messages.test.ts tests/floating-ball-background-actions.test.ts`

Expected: 2 files PASS。

- [ ] **Step 5: 写悬浮球控制器失败测试**

新增三个行为测试：

```ts
it("searches the web on Enter only after an empty local result settles", async () => {
  vi.useFakeTimers();
  const runtime = {
    sendMessage: vi.fn(async (message: { type: string }) =>
      message.type === "floating-ball/search" ? { ok: true, value: [] } : { ok: true }),
  };
  const controller = createFloatingBallController({ document, window, settings: createSettingsStore(), runtime });
  await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
  const shadow = document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!.click();
  const input = shadow.querySelector<HTMLInputElement>("input")!;
  input.value = "浏览器扩展";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(100);
  await Promise.resolve();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(runtime.sendMessage).toHaveBeenLastCalledWith({
    type: "floating-ball/search-web",
    query: "浏览器扩展",
  });
  controller.destroy();
  vi.useRealTimers();
});

it("keeps opening a selected local result instead of searching the web", async () => {
  const result = { id: "h", title: "本地结果", url: "https://example.com/", source: "history" as const };
  const runtime = { sendMessage: vi.fn().mockResolvedValueOnce({ ok: true, value: [result] }).mockResolvedValue({ ok: true }) };
  const controller = createFloatingBallController({ document, window, settings: createSettingsStore(), runtime });
  await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
  const shadow = document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!.click();
  await Promise.resolve();
  const input = shadow.querySelector<HTMLInputElement>("input")!;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(runtime.sendMessage).toHaveBeenCalledWith({
    type: "floating-ball/open-search-result",
    url: "https://example.com/",
  });
  expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "floating-ball/search-web" }));
  controller.destroy();
});

it("renders matching typography and source pills", async () => {
  const runtime = { sendMessage: vi.fn().mockResolvedValue({
    ok: true,
    value: [
      { id: "b", title: "书签", url: "https://b.example/", source: "bookmark" },
      { id: "h", title: "历史", url: "https://h.example/", source: "history" },
    ],
  }) };
  const controller = createFloatingBallController({ document, window, settings: createSettingsStore(), runtime });
  await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
  const shadow = document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!.click();
  await Promise.resolve();
  const style = shadow.querySelector("style")!;
  expect(shadow.querySelectorAll(".result-source")).toHaveLength(2);
  expect(shadow.querySelector("[data-source='bookmark']")?.textContent).toBe("收藏夹");
  expect(shadow.querySelector("[data-source='history']")?.textContent).toBe("历史记录");
  expect(style.textContent).toContain("font:13px \"Segoe UI\",\"Microsoft YaHei\",system-ui,sans-serif");
  expect(style.textContent).toContain("border-radius:9px");
  controller.destroy();
});
```

另测网页搜索失败时搜索面板仍打开、输入保留、结果区域显示“无法打开浏览器搜索”。

- [ ] **Step 6: 运行控制器测试确认 RED**

Run: `npm test -- --run tests/floating-ball-controller.test.ts`

Expected: FAIL，旧结果仍以拼接文本渲染，Enter 无网页搜索回退。

- [ ] **Step 7: 实现悬浮球查询状态和结构化结果**

控制器增加 `searchPending`、`settledQuery` 和 `webSearchGeneration`。`runSearch()` 只在当前代次完成时更新这些字段。Enter 在有结果时保持现有打开逻辑；无结果、非空且已完成时发送 `floating-ball/search-web`。成功清空并关闭，失败保留输入和面板并在 `.results` 显示错误。

将选项渲染从拼接文本改为：

```ts
const title = deps.document.createElement("span");
title.className = "result-title";
title.textContent = item.title || item.url;
const source = deps.document.createElement("span");
source.className = "result-source";
source.dataset.source = item.source;
source.textContent = item.source === "bookmark" ? "收藏夹" : "历史记录";
option.append(title, source);
```

CSS 使用两列 grid、13px `Segoe UI/Microsoft YaHei/system-ui` 字体、标题省略，以及 11px/18px/9px 来源胶囊。颜色与 `sidebar.css` 的 `.history-search-source` 保持相同语义。

- [ ] **Step 8: 运行全部悬浮球测试确认 GREEN**

Run: `npm test -- --run tests/floating-ball-messages.test.ts tests/floating-ball-background-actions.test.ts tests/floating-ball-controller.test.ts tests/floating-ball-content-script.test.ts tests/floating-ball-search.test.ts`

Expected: 5 files PASS。

- [ ] **Step 9: 提交悬浮球搜索优化**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 优化悬浮球搜索体验"
git add src/floating-ball/messages.ts src/floating-ball/background-actions.ts src/floating-ball/controller.ts src/background/service-worker.ts tests/floating-ball-messages.test.ts tests/floating-ball-background-actions.test.ts tests/floating-ball-controller.test.ts
git commit -m $message
```

### Task 5: 权限、隐私、产物和完整验收

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `docs/privacy-policy.md`
- Modify: `update.log`
- Modify: `tests/smoke.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 写 Manifest 和文档失败测试**

在 `tests/smoke.test.ts` 断言：

```ts
expect(manifest.permissions).toContain("search");
expect(serviceWorkerSource).toContain("search: chrome.search");
```

增加内容脚本产物断言，确认 `floating-ball/search-web`、`.result-source` 和两类 `data-source` 样式保留在构建产物中。

- [ ] **Step 2: 运行 smoke 测试确认 RED**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，Manifest 尚无 `search` 权限。

- [ ] **Step 3: 更新权限和中文发布文档**

在 `manifest.json` 的 permissions 中加入 `search`。文档必须明确：

- `search` 仅在用户输入非空、本地无结果且主动按 Enter 时调用默认搜索引擎。
- 收藏动作只精确查询当前 URL 并创建单个书签。
- 不读取默认搜索引擎配置，不读取或上传搜索结果页面内容。
- 悬浮球默认关闭；现有主机权限和 `scripting` 说明保持一致。

把 `package.json`、`package-lock.json`、`manifest.json` 统一提升到 `0.12.8`。在 `update.log` 新增 `0.12.8` 标题、发布日期和菜单隐藏、收藏动作、默认搜索回退、来源胶囊四项内容。

- [ ] **Step 4: 运行定向测试和类型检查**

Run:

```powershell
npm test -- --run tests/tab-context-menu.test.ts tests/tab-group-context-menu.test.ts tests/bookmark-actions.test.ts tests/history-search.test.ts tests/floating-ball-messages.test.ts tests/floating-ball-background-actions.test.ts tests/floating-ball-controller.test.ts tests/sidebar.test.ts tests/smoke.test.ts
npm run typecheck
```

Expected: 全部 PASS，TypeScript exit 0。

- [ ] **Step 5: 使用浏览器插件做真实 UI 验收**

在加载 `dist` 的 Chrome 扩展环境验证：

1. 内容树关闭，标签菜单无树操作。
2. 各类边界标签/分组不显示不可执行项或多余分隔线。
3. 未收藏网页可收藏，重新打开菜单后收藏项消失。
4. 侧边栏与悬浮球无结果 Enter 打开默认搜索引擎。
5. 悬浮球标题字体、字号和来源胶囊与侧边栏一致，桌面与窄视口无重叠。

若浏览器插件无法控制扩展页，记录原因，并使用 Chrome 插件或仓库既有 Playwright/人工验收路径；不得用仅检查源字符串替代所有视觉验收。

- [ ] **Step 6: 执行全量验证**

Run:

```powershell
npm run check
git diff --check
rg -n -i --glob '!node_modules/**' --glob '!release/**' '(password|passwd|secret|api[_-]?key|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|公司名称|身份证|手机号|内网地址)' src manifest.json README.md docs update.log dist
```

Expected: 类型检查、Vitest 检测到的全部测试文件、构建和 dist 检查全部通过；空白检查无错误；敏感信息扫描无真实凭据或个人/公司信息。

- [ ] **Step 7: 打包 `0.12.8` 并核对产物**

用户要求交付安装包时，统一提升补丁版本并运行：

```powershell
npm run package
Get-Item release\sidetab-lite-0.12.8.zip | Select-Object FullName, Length, LastWriteTime
```

Expected: ZIP 创建成功，`update.log` 含相同版本和本次四类改动。

- [ ] **Step 8: 提交权限和文档改动**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 完成菜单收藏与搜索体验优化"
git add manifest.json package.json package-lock.json README.md docs/chrome-web-store-checklist.md docs/privacy-policy.md update.log tests/smoke.test.ts
git commit -m $message
```

## 完成审计

- [ ] 标签页和分组菜单所有原 `disabled` 业务状态均有对应隐藏断言。
- [ ] 内容树关闭、叶子节点、忙碌分组、空分组、当前分组、当前颜色均有测试证据。
- [ ] 收藏精确查询、已收藏隐藏、创建成功、查询失败和创建失败均有测试证据。
- [ ] 两处搜索入口的查询中、空输入、无结果、有结果、失败状态均有测试证据。
- [ ] 悬浮球 DOM 和 CSS 均证明标题与来源胶囊结构正确。
- [ ] Manifest、README、商店检查清单、隐私政策和更新日志一致。
- [ ] `npm run check`、真实 UI 验收、敏感信息扫描和 `git diff --check` 均有最新输出。
