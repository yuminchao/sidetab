# 网页悬浮球搜索与标签快捷操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在普通网页提供默认关闭、可拖拽记忆位置的悬浮球，并复用侧边栏搜索和一键分组能力完成当前标签快捷操作。

**Architecture:** 使用 Manifest V3 内容脚本在关闭模式 Shadow DOM 中承载界面，Service Worker 负责所有 Chrome 特权 API。设置、消息协议、共享搜索用例和智能分组入口保持独立模块，页面消息只能操作 `sender.tab`，不能指定任意标签 ID。

**Tech Stack:** TypeScript 5.8、Chrome Extensions Manifest V3、esbuild、Vitest 3、JSDOM、原生 DOM/CSS。

---

## 文件结构

- 新建 `src/floating-ball/settings.ts`：悬浮球开关与位置的校验和持久化。
- 新建 `src/floating-ball/messages.ts`：内容脚本、侧边栏与 Service Worker 的类型化消息协议。
- 新建 `src/floating-ball/search.ts`：书签与历史记录共享查询用例。
- 新建 `src/floating-ball/background-actions.ts`：后台消息处理、已打开页面补注入与当前窗口一键分组。
- 新建 `src/floating-ball/position.ts`：拖拽阈值、比例坐标与视口边界纯函数。
- 新建 `src/floating-ball/controller.ts`：Shadow DOM 界面、搜索、菜单、拖拽、全屏和清理生命周期。
- 新建 `src/floating-ball/content-script.ts`：内容脚本幂等启动入口。
- 修改 `src/background/service-worker.ts`：注册悬浮球后台处理器。
- 修改 `src/sidepanel/history-search.ts`：改用共享搜索用例，保持现有侧边栏交互。
- 修改 `src/sidepanel/shortcut-renderer.ts`、`src/sidepanel/sidebar.ts`、`src/sidepanel/index.html`、`src/sidepanel/sidebar.css`：设置开关读写与界面。
- 修改 `manifest.json`、`scripts/build.mjs`、`scripts/release-files.mjs`、`scripts/check-dist.mjs`：权限、内容脚本产物和发布白名单。
- 新建对应 `tests/floating-ball-*.test.ts`，并修改现有设置、搜索、后台、冒烟与发布测试。

### Task 1: 悬浮球设置模型与位置纯函数

**Files:**
- Create: `src/floating-ball/settings.ts`
- Create: `src/floating-ball/position.ts`
- Test: `tests/floating-ball-settings.test.ts`
- Test: `tests/floating-ball-position.test.ts`

- [ ] **Step 1: 写设置默认值、损坏数据降级和分键保存的失败测试**

```ts
const store = createFloatingBallSettingsStore(area);
expect(await store.load()).toEqual({
  enabled: false,
  position: { xRatio: 1, yRatio: 1 },
});
await store.setEnabled(true);
expect(area.set).toHaveBeenCalledWith({ floatingBallEnabled: true });
await store.savePosition({ xRatio: 0.25, yRatio: 0.75 });
expect(area.set).toHaveBeenCalledWith({
  floatingBallPosition: { xRatio: 0.25, yRatio: 0.75 },
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/floating-ball-settings.test.ts tests/floating-ball-position.test.ts`

Expected: FAIL，提示两个新模块不存在。

- [ ] **Step 3: 实现独立设置键和位置换算 API**

```ts
export const FLOATING_BALL_ENABLED_KEY = "floatingBallEnabled";
export const FLOATING_BALL_POSITION_KEY = "floatingBallPosition";
export type FloatingBallPosition = Readonly<{ xRatio: number; yRatio: number }>;
export type FloatingBallSettings = Readonly<{
  enabled: boolean;
  position: FloatingBallPosition;
}>;

export interface FloatingBallSettingsStore {
  load(): Promise<FloatingBallSettings>;
  setEnabled(enabled: boolean): Promise<void>;
  savePosition(position: FloatingBallPosition): Promise<void>;
}

export function clampBallPosition(
  position: FloatingBallPosition,
  viewport: Readonly<{ width: number; height: number }>,
  ballSize = 44,
  margin = 12,
): Readonly<{ left: number; top: number }>;

export function toRatioPosition(
  point: Readonly<{ left: number; top: number }>,
  viewport: Readonly<{ width: number; height: number }>,
  ballSize = 44,
): FloatingBallPosition;

export function exceedsDragThreshold(dx: number, dy: number, threshold = 5): boolean;
```

校验仅接受有限的 `0..1` 数值；损坏值回退右下角。两个字段使用不同 storage key，避免拖拽保存位置时覆盖设置对话框刚写入的开关。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/floating-ball-settings.test.ts tests/floating-ball-position.test.ts`

Expected: PASS。

### Task 2: 侧边栏设置开关

**Files:**
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `src/sidepanel/shortcut-renderer.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/shortcut-renderer.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写设置默认关闭、打开对话框回显及保存回调的失败测试**

```ts
expect(elements.floatingBallEnabled.checked).toBe(false);
renderer.setFloatingBallEnabled(true);
elements.settingsButton.click();
expect(elements.floatingBallEnabled.checked).toBe(true);
elements.floatingBallEnabled.checked = false;
elements.form.requestSubmit();
await flushAsyncEvents();
expect(onFloatingBallEnabledChange).toHaveBeenCalledWith(false);
```

侧边栏集成测试同时验证快捷网站设置仍写入 `shortcutSettings`，悬浮球开关只写入 `floatingBallEnabled`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/shortcut-renderer.test.ts tests/sidebar.test.ts`

Expected: FAIL，提示缺少 `floatingBallEnabled` 元素和回调。

- [ ] **Step 3: 增加设置区与渲染器接口**

```html
<section class="settings-section" aria-labelledby="floating-ball-heading">
  <h3 id="floating-ball-heading">网页悬浮球</h3>
  <label class="toggle-label" for="floating-ball-enabled">
    <input id="floating-ball-enabled" type="checkbox" />
    <span>在普通网页显示悬浮球</span>
  </label>
</section>
```

```ts
export type ShortcutRenderer = {
  render(settings: ShortcutSettings): void;
  setFloatingBallEnabled(enabled: boolean): void;
  destroy(): void;
};

export type ShortcutRendererCallbacks = {
  onSave(settings: ShortcutSettings): Promise<ShortcutSettings>;
  onFloatingBallEnabledChange(enabled: boolean): Promise<void>;
};
```

提交表单时先完成两个保存 Promise；任一失败则保留对话框并显示错误。`startSidebar` 启动时并行加载两个 store，设置回调保存开关；开启成功后向后台发送 `floating-ball/ensure-injected`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/shortcut-renderer.test.ts tests/sidebar.test.ts`

Expected: PASS。

### Task 3: 共享搜索用例

**Files:**
- Create: `src/floating-ball/search.ts`
- Modify: `src/sidepanel/history-search.ts`
- Create: `tests/floating-ball-search.test.ts`
- Modify: `tests/history-search.test.ts`

- [ ] **Step 1: 写空查询、合并顺序、部分失败与总数上限测试**

```ts
expect(await searchBookmarksAndHistory({ bookmarks, history }, "")).toEqual(recentHistory);
expect(await searchBookmarksAndHistory({ bookmarks, history }, "chrome"))
  .toEqual([...bookmarkResults.slice(0, 5), ...dedupedHistory].slice(0, 20));
await expect(searchBookmarksAndHistory({ bookmarks: failing, history: failing }, "x"))
  .rejects.toThrow("无法读取搜索记录");
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/floating-ball-search.test.ts tests/history-search.test.ts`

Expected: FAIL，提示共享函数不存在。

- [ ] **Step 3: 实现共享查询并让侧边栏控制器调用它**

```ts
export async function searchBookmarksAndHistory(
  deps: Readonly<{ bookmarks: BookmarkSearchApi; history: HistorySearchApi }>,
  rawQuery: string,
): Promise<SearchResult[]> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) return searchHistory(deps.history, "");
  const [bookmarks, history] = await Promise.allSettled([
    searchBookmarks(deps.bookmarks, query),
    searchHistory(deps.history, query),
  ]);
  if (bookmarks.status === "rejected" && history.status === "rejected") {
    throw new Error("无法读取搜索记录");
  }
  return mergeSearchResults(
    bookmarks.status === "fulfilled" ? bookmarks.value : [],
    history.status === "fulfilled" ? history.value : [],
  );
}
```

侧边栏保留原有 100ms 防抖、generation、防焦点竞态和文案，只替换数据查询实现。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/floating-ball-search.test.ts tests/history-search.test.ts`

Expected: PASS。

### Task 4: 消息协议与后台动作

**Files:**
- Create: `src/floating-ball/messages.ts`
- Create: `src/floating-ball/background-actions.ts`
- Modify: `src/background/service-worker.ts`
- Test: `tests/floating-ball-background-actions.test.ts`

- [ ] **Step 1: 写消息校验、`sender.tab` 目标约束和五类命令失败测试**

```ts
await handler({ type: "floating-ball/duplicate-tab" }, senderTab42);
expect(tabs.duplicate).toHaveBeenCalledWith(42);
await handler({ type: "floating-ball/toggle-pin", tabId: 99 } as never, senderTab42);
expect(tabs.update).toHaveBeenCalledWith(42, { pinned: true });
await expect(handler({ type: "floating-ball/close-tab" }, missingSender))
  .resolves.toEqual({ ok: false, error: "invalid-sender" });
```

再覆盖搜索、只允许 `http/https` 的搜索结果打开、打开侧边栏、非法消息、超长关键词、单页面注入失败不终止批次。

- [ ] **Step 2: 写当前窗口一键分组复用测试并确认 RED**

```ts
await runWindowSmartGrouping(deps, windowId);
expect(tabs.group).toHaveBeenCalledWith({
  groupId: existingOtherGroupId,
  tabIds: expect.arrayContaining(ungroupedAndDuplicateGroupTabIds),
});
expect(tabGroups.update).not.toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({ title: "其他" }),
);
```

分别准备多个“其他”同名分组和多个网站同名分组，断言所有来源分组成员都移动到稳定目标组，且不调用无 `groupId` 的新建分组 API。

Run: `npm test -- --run tests/floating-ball-background-actions.test.ts`

Expected: FAIL，新模块不存在。

- [ ] **Step 3: 定义可判别消息与稳定响应**

```ts
export type FloatingBallRequest =
  | { type: "floating-ball/search"; query: string }
  | { type: "floating-ball/open-search-result"; url: string }
  | { type: "floating-ball/duplicate-tab" }
  | { type: "floating-ball/toggle-pin" }
  | { type: "floating-ball/close-tab" }
  | { type: "floating-ball/open-side-panel" }
  | { type: "floating-ball/smart-group-window" }
  | { type: "floating-ball/ensure-injected" };

export type FloatingBallResponse<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; error: string; message: string };
```

- [ ] **Step 4: 实现后台处理与智能分组复用**

```ts
export interface FloatingBallChromeDependencies {
  tabs: Pick<typeof chrome.tabs, "query" | "create" | "duplicate" | "get" | "update" | "remove" | "group">;
  tabGroups: Pick<typeof chrome.tabGroups, "query" | "get" | "update">;
  bookmarks: BookmarkSearchApi;
  history: HistorySearchApi;
  sidePanel: Pick<typeof chrome.sidePanel, "open">;
  scripting: Pick<typeof chrome.scripting, "executeScript">;
  sessionStorage: StorageArea;
}
```

`runWindowSmartGrouping` 用 `toTabViewModel`、`createOneClickGroupPlan`、`executeSmartGroupPlan` 和 `createSmartGroupSessionStore`。操作前重新查询 tabs/groups；同一窗口使用 busy Set 防重入；创建“其他”后保存角色。消息处理器只从 `sender.tab.id/windowId` 取得目标。

- [ ] **Step 5: 注册 Service Worker 监听器并运行 GREEN**

```ts
const floatingBallBackground = createFloatingBallBackground(chrome);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isFloatingBallRequest(message)) return undefined;
  void floatingBallBackground.handle(message, sender).then(sendResponse);
  return true;
});
```

Run: `npm test -- --run tests/floating-ball-background-actions.test.ts tests/smart-group-model.test.ts tests/smart-group-actions.test.ts`

Expected: PASS。

### Task 5: 悬浮球位置、搜索和菜单控制器

**Files:**
- Create: `src/floating-ball/controller.ts`
- Test: `tests/floating-ball-controller.test.ts`

- [ ] **Step 1: 写默认不挂载、启用挂载、左键聚焦和空查询测试**

```ts
const controller = createFloatingBallController(deps);
await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
click(shadow.querySelector("[data-action='toggle-search']"));
expect(shadow.activeElement).toBe(shadow.querySelector("input[type='search']"));
expect(runtime.sendMessage).toHaveBeenCalledWith({
  type: "floating-ball/search",
  query: "",
});
```

- [ ] **Step 2: 写 100ms 防抖、旧响应丢弃和键盘导航测试**

```ts
input.value = "old";
input.dispatchEvent(new InputEvent("input"));
input.value = "new";
input.dispatchEvent(new InputEvent("input"));
await vi.advanceTimersByTimeAsync(100);
resolveNew(newResults);
resolveOld(oldResults);
expect(renderedTitles()).toEqual(newResults.map(({ title }) => title));
```

- [ ] **Step 3: 写拖拽、全屏、菜单互斥和命令忙碌测试**

```ts
dispatchPointerDrag(ball, { dx: 40, dy: -20 });
expect(settingsStore.savePosition).toHaveBeenCalledTimes(1);
setFullscreenElement(document.documentElement);
document.dispatchEvent(new Event("fullscreenchange"));
expect(host.hidden).toBe(true);
contextmenu(ball);
expect(menu.hidden).toBe(false);
expect(search.hidden).toBe(true);
```

Run: `npm test -- --run tests/floating-ball-controller.test.ts`

Expected: FAIL，控制器不存在。

- [ ] **Step 4: 实现关闭模式 Shadow DOM 结构和单色图标**

```ts
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = FLOATING_BALL_CSS;
const ball = createIconButton(document, "打开 SideTab Lite 搜索");
ball.dataset.action = "toggle-search";
shadow.append(style, createWidget(document, ball));
```

CSS 固定 44px 球体、8px 以内面板圆角、44px 胶囊高度、稳定结果行尺寸、12px 安全边距、高对比焦点环；不使用渐变、装饰性图形或远程资源。

- [ ] **Step 5: 实现交互与生命周期**

控制器维护 `closed | search | menu` 三态、请求 generation、busy 命令和拖拽会话。左键正常点击进入 search 后同步 `input.focus()` 并立即发送空查询；输入 100ms 防抖；Escape/外部点击关闭；上下键循环选择；Enter 请求后台创建标签页。右键只在球体调用 `preventDefault()`。`destroy()` 清除 timer、监听器、宿主和未决状态。

- [ ] **Step 6: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/floating-ball-controller.test.ts tests/floating-ball-position.test.ts`

Expected: PASS。

### Task 6: 内容脚本入口与即时注入

**Files:**
- Create: `src/floating-ball/content-script.ts`
- Test: `tests/floating-ball-content-script.test.ts`
- Modify: `tests/floating-ball-background-actions.test.ts`

- [ ] **Step 1: 写幂等重启、storage 变化和受限状态测试**

```ts
await startFloatingBallContentScript(deps);
await startFloatingBallContentScript(deps);
expect(document.querySelectorAll("[data-sidetab-floating-ball-host]")).toHaveLength(1);
emitStorageChange(FLOATING_BALL_ENABLED_KEY, false, true);
expect(document.querySelector("[data-sidetab-floating-ball-host]")).not.toBeNull();
emitStorageChange(FLOATING_BALL_ENABLED_KEY, true, false);
expect(document.querySelector("[data-sidetab-floating-ball-host]")).toBeNull();
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/floating-ball-content-script.test.ts`

Expected: FAIL，入口不存在。

- [ ] **Step 3: 实现幂等入口和配置监听**

```ts
declare global {
  var __sideTabFloatingBallController: { destroy(): void } | undefined;
}

export async function startFloatingBallContentScript(deps: ContentScriptDependencies): Promise<void> {
  globalThis.__sideTabFloatingBallController?.destroy();
  const settings = await deps.settingsStore.load();
  const controller = createFloatingBallController(deps);
  await controller.applySettings(settings);
  globalThis.__sideTabFloatingBallController = controller;
}
```

storage 监听只处理 `local` 区域的两个悬浮球键。开关关闭时卸载宿主但保留轻量入口监听，使再次开启无需刷新；位置变化时重新定位。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/floating-ball-content-script.test.ts tests/floating-ball-background-actions.test.ts`

Expected: PASS。

### Task 7: 清单、构建与发布校验

**Files:**
- Modify: `manifest.json`
- Modify: `scripts/build.mjs`
- Modify: `scripts/release-files.mjs`
- Modify: `scripts/check-dist.mjs`
- Modify: `tests/smoke.test.ts`
- Modify: `tests/release-scripts.test.ts`

- [ ] **Step 1: 写清单和精确发布文件失败测试**

```ts
expect(manifest.minimum_chrome_version).toBe("116");
expect(manifest.permissions).toContain("scripting");
expect(manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
expect(manifest.content_scripts).toEqual([{
  matches: ["http://*/*", "https://*/*"],
  js: ["content/floating-ball.js"],
  run_at: "document_idle",
}]);
expect(EXPECTED_FILES).toContain("content/floating-ball.js");
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: FAIL，清单仍为 Chrome 114 且缺少内容脚本。

- [ ] **Step 3: 更新清单、构建入口和发布白名单**

```js
entryPoints: {
  "background/service-worker": resolve(root, "src/background/service-worker.ts"),
  "content/floating-ball": resolve(root, "src/floating-ball/content-script.ts"),
  "sidepanel/sidebar": resolve(root, "src/sidepanel/sidebar.ts"),
}
```

esbuild target 同步改为 `chrome116`。发布校验允许清单新增 `host_permissions`、`content_scripts`，权限精确列表追加 `scripting`，发布文件精确列表追加 `content/floating-ball.js`。继续禁止动态导入、网络 API、远程脚本和额外产物。

- [ ] **Step 4: 运行发布测试并确认 GREEN**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: PASS。

### Task 8: 全量验证、敏感信息检查与版本记录

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `update.log`

- [ ] **Step 1: 将下一补丁版本统一为 0.12.7 并记录更新内容**

`package.json`、`package-lock.json` 和 `manifest.json` 统一为 `0.12.7`。`update.log` 新增 0.12.7 条目，包含悬浮球开关、拖拽位置、书签/历史搜索、当前标签快捷菜单、一键分组复用以及 Chrome 116 最低版本和新增站点权限。README 补充设置入口、权限用途和本机处理说明。

- [ ] **Step 2: 运行定向测试与全量检查**

Run: `npm run typecheck`

Expected: PASS。

Run: `npm test -- --run`

Expected: PASS，无未处理 rejection 或测试泄漏。

Run: `npm run build`

Expected: PASS，生成 `dist/content/floating-ball.js`。

Run: `node scripts/check-dist.mjs`

Expected: 输出 `dist check passed` 且包体不超过 300000 bytes。

- [ ] **Step 3: 扫描敏感信息**

Run: `rg -n -i "(password|passwd|secret|token|api[_-]?key|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|公司名称|身份证|手机号|内网地址)" src manifest.json README.md update.log dist`

Expected: 无真实凭据、公司信息、个人信息或内部地址；仅允许测试性/说明性词汇并逐项人工确认。

- [ ] **Step 4: Chrome 实机验收**

加载 `dist` 后验证：设置默认关闭；开启/关闭即时作用于多个已打开普通网页；左键自动聚焦并显示最近记录；关键词搜索与键盘操作；拖拽跨站恢复；全屏隐藏恢复；五项右键命令；同名网站分组与“其他”分组合并复用。

- [ ] **Step 5: 记录最终状态**

Run: `git diff --check`

Expected: 无空白错误。使用 `git status --short` 核对本功能文件与用户原有改动，禁止还原或误提交无关改动。
