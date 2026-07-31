# SideTab Lite 0.8.1 历史搜索、新建图标与最近关闭标签页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加轮询、长期大对象缓存或标签列表额外重渲染的前提下，完成历史记录按站点路径去重与失焦收起、替换新建标签页图标、恢复最近关闭标签页，并发布 `0.8.1` 安装包。

**Architecture:** 历史搜索继续由纯查询函数和 DOM 控制器分层；新建按钮图标作为经过约束校验的本地 SVG 资源，通过 CSS mask 渲染；最近关闭标签页新增独立的轻量控制器，只缓存一个 `sessionId`，使用 `chrome.sessions.onChanged` 事件驱动刷新，并通过现有右键菜单和侧边栏编排层触发恢复。三个能力在单元测试中独立验证，在发布阶段统一更新权限、版本和精确文件白名单。

**Tech Stack:** TypeScript 5.8、Chrome Extension Manifest V3、Chrome History API、Chrome Sessions API、原生 DOM/CSS、Vitest 3、JSDOM、Node.js 发布脚本。

---

## 实施边界

- 本计划只实现三份已确认设计：历史搜索去重与失焦收起、新建标签页 SVG 图标、打开最近关闭标签页。
- 默认标签标题字号改为 `16px` 和浏览器启动时自动打开侧边栏不纳入本次 `0.8.1`。
- 不引入轮询、持久化会话缓存、完整最近关闭会话列表缓存或新的标签列表全量查询。
- 所有新行为先写失败测试，再写最小实现；每个任务完成后运行聚焦测试并提交。

### Task 1：按主机与规范化路径去重历史记录

**Files:**

- Modify: `src/sidepanel/history-search.ts`
- Modify: `tests/history-search.test.ts`

- [ ] **Step 1：写出失败的路径去重测试**

在 `tests/history-search.test.ts` 中把旧的完整 URL 去重断言改为以下行为：

```ts
it("deduplicates by host and normalized path while preserving the newest full URL", async () => {
  const search = vi.fn(async () => [
    historyItem("newest", "https://example.com/page/?utm=new#top", "Newest"),
    historyItem("scheme", "http://example.com/page", "Scheme"),
    historyItem("query", "https://example.com/page?utm=old", "Query"),
    historyItem("credentials", "https://user:pass@example.com/page", "Credentials"),
    historyItem("subdomain", "https://www.example.com/page", "Subdomain"),
    historyItem("port", "https://example.com:8443/page", "Port"),
    historyItem("case", "https://example.com/Page", "Case"),
    historyItem("other", "https://example.com/other", "Other"),
  ]);

  const results = await searchHistory({ search }, "docs");

  expect(search).toHaveBeenCalledWith({ text: "docs", startTime: 0, maxResults: 500 });
  expect(results.map((item) => item.url)).toEqual([
    "https://example.com/page/?utm=new#top",
    "https://www.example.com/page",
    "https://example.com:8443/page",
    "https://example.com/Page",
    "https://example.com/other",
  ]);
});
```

再增加一条测试：输入至少 25 个唯一的 `host + path`，确认最终只返回前 20 条，且同一路径的重复项不会占用 20 条额度。

- [ ] **Step 2：运行测试并确认红灯原因正确**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 测试因 `maxResults` 仍为 `200`、查询参数和尾斜杠仍参与去重而失败。

- [ ] **Step 3：实现去重键并提高候选上限**

在 `src/sidepanel/history-search.ts` 中使用结构化 URL 解析，保留首条记录的完整地址：

```ts
type NormalizedHistoryItem = {
  result: HistorySearchResult;
  dedupeKey: string;
};

function normalizeHistoryPath(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/, "");
  return withoutTrailingSlashes || "/";
}

function normalizeHistoryItem(
  item: chrome.history.HistoryItem,
): NormalizedHistoryItem | undefined {
  if (!item.url) return undefined;
  try {
    const url = new URL(item.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return {
      result: {
        id: item.id || url.href,
        title: item.title?.trim() || url.hostname,
        url: url.href,
      },
      dedupeKey: `${url.host}${normalizeHistoryPath(url.pathname)}`,
    };
  } catch {
    return undefined;
  }
}
```

把查询和收集循环改为：

```ts
items = await api.search({ text, startTime: 0, maxResults: 500 });

const results: HistorySearchResult[] = [];
const seenKeys = new Set<string>();
for (const item of items) {
  if (results.length === 20) break;
  const normalized = normalizeHistoryItem(item);
  if (!normalized || seenKeys.has(normalized.dedupeKey)) continue;
  seenKeys.add(normalized.dedupeKey);
  results.push(normalized.result);
}
```

- [ ] **Step 4：运行聚焦测试和类型检查**

Run: `npm test -- --run tests/history-search.test.ts && npm run typecheck`

Expected: 全部通过；协议、查询参数、哈希和尾斜杠不再制造重复结果，子域名、非默认端口和大小写不同的路径仍分别保留。

- [ ] **Step 5：提交历史去重改动**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，再执行：

```powershell
git add src/sidepanel/history-search.ts tests/history-search.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) fix 优化历史记录去重"
```

### Task 2：搜索框失焦后可靠收起结果面板

**Files:**

- Modify: `src/sidepanel/history-search.ts`
- Modify: `tests/history-search.test.ts`

- [ ] **Step 1：写出失败的失焦生命周期测试**

增加三条控制器测试：

1. 输入框失焦后推进零延迟计时器，结果面板隐藏且 `aria-expanded="false"`。
2. 输入框失焦后立即点击一条结果，`onOpen` 仍调用一次，避免失焦先销毁点击目标。
3. 失焦后立即重新聚焦会取消待执行收起；`destroy()` 后推进计时器不会修改 DOM 或触发查询。

测试使用 `vi.useFakeTimers()`，并在 `afterEach` 中恢复真实计时器。

- [ ] **Step 2：运行测试确认当前没有 blur 收起行为**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 新增测试因输入框未监听 `blur` 而失败。

- [ ] **Step 3：增加独立的零延迟失焦计时器**

在控制器状态中加入：

```ts
let blurTimer: ReturnType<typeof setTimeout> | undefined;

const clearBlurTimer = (): void => {
  if (blurTimer !== undefined) {
    clearTimeout(blurTimer);
    blurTimer = undefined;
  }
};

const onBlur = (): void => {
  clearBlurTimer();
  blurTimer = setTimeout(() => {
    blurTimer = undefined;
    if (active) close();
  }, 0);
};
```

让 `reopen()` 首先执行 `clearBlurTimer()`；让 `close()` 同时清除查询防抖和失焦计时器。注册并清理监听：

```ts
elements.input.addEventListener("blur", onBlur);

elements.input.removeEventListener("blur", onBlur);
```

零延迟仅用于让结果项点击事件先完成，不增加持续定时器或轮询。

- [ ] **Step 4：运行历史搜索测试**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 全部通过，没有悬挂计时器，结果项点击与失焦收起均正常。

- [ ] **Step 5：提交失焦收起改动**

```powershell
git add src/sidepanel/history-search.ts tests/history-search.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) fix 搜索框失焦时收起结果"
```

### Task 3：使用用户提供的 SVG 替换新建标签页加号

**Files:**

- Create: `assets/icons/add-tab.svg`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-markup.test.ts`
- Modify: `tests/sidepanel-css.test.ts`
- Modify: `tests/assets.test.ts`

- [ ] **Step 1：先写资源、结构和样式失败测试**

断言：

- `assets/icons/add-tab.svg` 存在，`viewBox` 为 `0 0 1024 1024`，根节点只包含两个仅有 `d` 属性的 `path`。
- `#new-tab-button` 保留 `title`、`aria-label` 和 `type="button"`，但没有可见文本 `+`。
- `.new-tab-button` 使用 `display: grid` 和 `place-items: center`，外层 `border: 0`、`background: transparent`。
- `.new-tab-button::before` 的宽高为 `18px`，通过 `mask` 和 `-webkit-mask` 引用 `../assets/icons/add-tab.svg`。
- hover、active、focus-visible 和 disabled 状态仍存在。

- [ ] **Step 2：运行聚焦测试确认红灯**

Run: `npm test -- --run tests/assets.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Expected: 因资源不存在、按钮仍含文本加号且旧样式带边框而失败。

- [ ] **Step 3：创建经过净化的 SVG 资源**

`assets/icons/add-tab.svg` 必须写成以下完整内容，不保留来源文件中的 XML 声明、注释、样式、脚本、外链或额外属性：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M705.139 484.318a39.852 39.852 0 0 0-28.97-12.232H552.562V347.835a39.568 39.568 0 0 0-39.914-39.914 39.306 39.306 0 0 0-39.914 39.914V471.44H347.842a39.915 39.915 0 1 0 0 79.825h123.605V674.87a39.915 39.915 0 1 0 79.825 0V551.272h123.605a38.876 38.876 0 0 0 28.326-11.588A38.482 38.482 0 0 0 714.79 512a36.715 36.715 0 0 0-9.656-27.682z"/><path d="M839.683 62H184.317A122.262 122.262 0 0 0 62 184.317v655.362a122.262 122.262 0 0 0 122.317 122.317h655.366A122.262 122.262 0 0 0 962 839.679V184.313A122.262 122.262 0 0 0 839.683 62z m41.847 777.679c0 22.531-19.312 41.847-41.847 41.847H184.317c-22.533 0-41.847-19.313-41.847-41.847V184.313c0-22.532 19.312-41.848 41.847-41.848h655.366c22.533 0 41.847 19.313 41.847 41.848z"/></svg>
```

创建后校验来源哈希：

Run: `Get-FileHash C:\Users\NUC\Downloads\新增按钮.svg -Algorithm SHA256`

Expected: `D2B0751EA0B01D06D1BF9B7D821B6F6325E1477D360C9B640D7D61125FB673D5`

- [ ] **Step 4：替换按钮结构和 CSS**

按钮结构改为：

```html
<button
  id="new-tab-button"
  class="new-tab-button"
  type="button"
  title="新建标签页"
  aria-label="新建标签页"
></button>
```

核心样式改为：

```css
.new-tab-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 24px;
  margin: 3px auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: CanvasText;
  cursor: pointer;
}

.new-tab-button::before {
  width: 18px;
  height: 18px;
  background-color: currentColor;
  content: "";
  -webkit-mask: url("../assets/icons/add-tab.svg") center / contain no-repeat;
  mask: url("../assets/icons/add-tab.svg") center / contain no-repeat;
}
```

保留既有交互态；disabled 状态用 `GrayText`，不在按钮内部再画第二层边框。

- [ ] **Step 5：运行聚焦测试和构建**

Run: `npm test -- --run tests/assets.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts && npm run build`

Expected: 测试通过，`dist/assets/icons/add-tab.svg` 存在。

- [ ] **Step 6：提交图标与界面改动**

```powershell
git add assets/icons/add-tab.svg src/sidepanel/index.html src/sidepanel/sidebar.css tests/assets.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) feat 替换新建标签页图标"
```

### Task 4：扩展发布资源校验支持双 path SVG

**Files:**

- Modify: `scripts/release-files.mjs`
- Modify: `scripts/check-dist.mjs`
- Modify: `tests/release-scripts.test.ts`

- [ ] **Step 1：写出发布清单和净化 SVG 失败测试**

在发布夹具中加入 `assets/icons/add-tab.svg`，将精确文件数断言改为 15。新增测试分别验证：合法的双 `path` 图标通过、少一个 `path` 失败、额外元素或额外属性失败。

- [ ] **Step 2：运行测试确认当前发布校验拒绝新资源**

Run: `npm test -- --run tests/release-scripts.test.ts`

Expected: 因发布白名单没有 `add-tab.svg`，且净化 SVG 校验只接受单个 `path` 而失败。

- [ ] **Step 3：更新精确白名单和每个图标的 path 数量**

在 `scripts/release-files.mjs` 的 `EXPECTED_FILES` 中加入：

```js
"assets/icons/add-tab.svg",
```

在 `scripts/check-dist.mjs` 中把单值集合改为明确数量映射：

```js
const sanitizedSvgPaths = new Map([
  ["assets/icons/add-tab.svg", 2],
  ["assets/icons/network.svg", 1],
  ["assets/icons/search.svg", 1],
  ["assets/icons/settings.svg", 1],
]);
```

`validateSanitizedSvg` 接受 `expectedPathCount`，并验证根节点全部子元素都是 `path`、数量精确、每个 `path` 只有非空 `d` 属性。调用端从映射中读取数量；`pin.svg` 继续走原有独立校验。

- [ ] **Step 4：运行发布脚本测试和分发目录校验**

Run: `npm test -- --run tests/release-scripts.test.ts && npm run build && node scripts/check-dist.mjs`

Expected: 全部通过，分发目录只有 15 个白名单文件。

- [ ] **Step 5：提交发布资源校验改动**

```powershell
git add scripts/release-files.mjs scripts/check-dist.mjs tests/release-scripts.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) test 扩展新建图标发布校验"
```

### Task 5：新增轻量的最近关闭标签页控制器

**Files:**

- Create: `src/sidepanel/recently-closed-tab.ts`
- Create: `tests/recently-closed-tab.test.ts`

- [ ] **Step 1：先写控制器失败测试**

覆盖以下契约：

- 创建时只调用一次 `getRecentlyClosed({ maxResults: 25 })`。
- 跳过窗口会话，只缓存返回顺序中第一个带字符串 `tab.sessionId` 的会话。
- 没有标签会话或查询失败时返回 `undefined`。
- `onChanged` 突发触发期间最多一个查询在运行，运行中事件只合并为一次后续查询。
- `restore(sessionId)` 精确调用 `chrome.sessions.restore(sessionId)`，成功和失败后都刷新缓存。
- 恢复失败抛出固定消息 `无法打开最近关闭标签页`。
- `destroy()` 移除监听；销毁后延迟查询结果不能回写缓存。

- [ ] **Step 2：运行测试确认模块尚不存在**

Run: `npm test -- --run tests/recently-closed-tab.test.ts`

Expected: 测试因模块不存在而失败。

- [ ] **Step 3：实现事件驱动、单值缓存控制器**

导出以下接口：

```ts
export type SessionsApi = Pick<
  typeof chrome.sessions,
  "getRecentlyClosed" | "restore" | "onChanged"
>;

export type RecentlyClosedTabController = {
  getSessionId(): string | undefined;
  refresh(): Promise<void>;
  restore(sessionId: string): Promise<void>;
  destroy(): void;
};
```

实现要求：

```ts
function findRecentTabSessionId(
  sessions: readonly chrome.sessions.Session[],
): string | undefined {
  for (const session of sessions) {
    const sessionId = session.tab?.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0) return sessionId;
  }
  return undefined;
}
```

控制器只保留 `active`、`sessionId`、一个运行中的 `refreshPromise` 和一个 `followUpRequested` 布尔值。`refresh()` 运行时再次调用只设置后续标记；当前查询结束后最多补一次查询。创建时注册 `onChanged` 并执行一次异步刷新，不设置定时器。`restore()` 在 `finally` 中刷新缓存，`destroy()` 移除监听并令迟到结果失效。

- [ ] **Step 4：运行单元测试和类型检查**

Run: `npm test -- --run tests/recently-closed-tab.test.ts && npm run typecheck`

Expected: 全部通过，测试证明没有轮询、没有完整会话列表缓存、并发刷新被合并。

- [ ] **Step 5：提交控制器**

```powershell
git add src/sidepanel/recently-closed-tab.ts tests/recently-closed-tab.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) feat 新增最近关闭标签页控制器"
```

### Task 6：在右键菜单末尾加入打开最近关闭标签页

**Files:**

- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1：写出菜单行为失败测试**

扩展测试夹具，传入 `getRecentlyClosedSessionId`。验证：

- 菜单最后一项是 `打开最近关闭标签页`，位于 `关闭下方标签页` 后。
- 没有可恢复会话时按钮 disabled，键盘上下移动会跳过它。
- 打开菜单时把当时的 `sessionId` 绑定到按钮；缓存随后变化也不改变本次点击命令。
- 鼠标点击和 Enter 都分发 `{ action: "restore-recently-closed", sessionId }`。
- 菜单关闭时清空按钮绑定的 `sessionId`。

- [ ] **Step 2：运行菜单测试确认红灯**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: 因菜单项和命令类型尚不存在而失败。

- [ ] **Step 3：扩展菜单命令和打开时快照**

向 `TabContextCommand` 增加：

```ts
| { action: "restore-recently-closed"; sessionId: string };
```

向回调增加：

```ts
getRecentlyClosedSessionId?(): string | undefined;
```

创建并追加最后一项：

```ts
const restoreRecentlyClosed = createItem(
  "restore-recently-closed",
  "打开最近关闭标签页",
);
menu.append(
  duplicate,
  setPinned,
  addShortcut,
  addToGroup,
  removeFromGroup,
  closeBelow,
  restoreRecentlyClosed,
);
```

每次打开菜单时读取一次回调结果，写入 `restoreRecentlyClosed.dataset.sessionId` 并同步 `disabled`；点击时只使用该快照。菜单关闭时删除 `data-session-id`，防止复用过期值。

- [ ] **Step 4：运行菜单测试和类型检查**

Run: `npm test -- --run tests/tab-context-menu.test.ts && npm run typecheck`

Expected: 菜单顺序、disabled、键盘导航和命令快照全部通过。

- [ ] **Step 5：提交菜单改动**

```powershell
git add src/sidepanel/tab-context-menu.ts tests/tab-context-menu.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) feat 右键菜单支持打开最近关闭标签页"
```

### Task 7：接入侧边栏生命周期和 Chrome Sessions API

**Files:**

- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/helpers/fake-chrome.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：扩展 Fake Chrome 并写侧边栏失败测试**

Fake Chrome 增加可配置的最近关闭会话、`sessions.getRecentlyClosed`、`sessions.restore` 和独立的 `sessions.onChanged` 假事件。侧边栏测试验证：

- 启动后仅查询一次最近关闭会话。
- 右键菜单能恢复菜单打开时绑定的 `sessionId`。
- 没有会话时菜单项禁用且不调用 restore。
- restore 拒绝时状态区显示 `无法打开最近关闭标签页`。
- restore 前后标签列表 DOM 节点身份不变，证明命令没有主动触发 TabStore 重建或 renderer 全量渲染。
- cleanup 后 `sessions.onChanged` 监听器数量为零，迟到结果不产生 DOM 变化。

- [ ] **Step 2：运行侧边栏测试确认依赖尚未接入**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: 因 `SidebarDependencies` 没有 `sessions` 且菜单未接入控制器而失败。

- [ ] **Step 3：扩展依赖并创建控制器**

在 `SidebarDependencies` 增加：

```ts
sessions: SessionsApi;
```

在侧边栏初始化时创建：

```ts
const recentlyClosed = createRecentlyClosedTabController(deps.sessions);
let restoreRecentlyClosedBusy = false;
```

向右键菜单回调提供：

```ts
getRecentlyClosedSessionId: () => recentlyClosed.getSessionId(),
```

命令处理增加独立分支：

```ts
if (command.action === "restore-recently-closed") {
  if (restoreRecentlyClosedBusy) return;
  restoreRecentlyClosedBusy = true;
  void recentlyClosed.restore(command.sessionId).then(
    () => setStatus("operation", ""),
    () => setStatus("operation", "无法打开最近关闭标签页"),
  ).finally(() => {
    restoreRecentlyClosedBusy = false;
  });
  return;
}
```

cleanup 中调用 `recentlyClosed.destroy()`；生产启动依赖中传入 `sessions: chrome.sessions`。恢复成功后的标签同步完全依赖现有 `chrome.tabs` 事件链，不直接查询或重绘标签列表。

- [ ] **Step 4：运行相关测试、类型检查和标签渲染基准**

Run: `npm test -- --run tests/recently-closed-tab.test.ts tests/tab-context-menu.test.ts tests/sidebar.test.ts && npm run typecheck && npm run benchmark:tabs`

Expected: 所有测试通过；基准脚本通过既有门槛；没有新的轮询或标签列表全量刷新。

- [ ] **Step 5：提交集成改动**

```powershell
git add src/sidepanel/sidebar.ts tests/helpers/fake-chrome.ts tests/sidebar.test.ts
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) feat 接入最近关闭标签页恢复"
```

### Task 8：升级到 0.8.1、更新权限文档并生成安装包

**Files:**

- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `update.log`
- Modify: `tests/smoke.test.ts`
- Modify: `tests/release-scripts.test.ts`
- Modify: `scripts/check-dist.mjs`
- Create: `release/sidetab-lite-0.8.1.zip`

- [ ] **Step 1：先更新发布契约测试并确认红灯**

测试应要求：

```ts
expect(manifest.version).toBe("0.8.1");
expect(packageJson.version).toBe("0.8.1");
expect(packageLock.version).toBe("0.8.1");
expect(packageLock.packages[""].version).toBe("0.8.1");
expect(manifest.permissions).toEqual([
  "sidePanel",
  "tabs",
  "tabGroups",
  "storage",
  "history",
  "sessions",
]);
```

同时要求 README 指向 `release/sidetab-lite-0.8.1.zip`，声明 15 个文件和 `sessions` 权限用途；更新日志包含历史去重、失焦收起、新建标签图标、最近关闭标签页和性能约束。

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: 因版本、权限和文档仍是 `0.8.0` 而失败。

- [ ] **Step 2：更新版本、权限和发布校验**

- 将 `manifest.json`、`package.json`、`package-lock.json` 根版本统一为 `0.8.1`。
- 在 Manifest 权限末尾加入 `sessions`，不增加主机权限或 content script。
- 在 `scripts/check-dist.mjs` 和发布测试夹具中同步精确权限数组。
- README 说明 `sessions` 只用于读取和恢复最近关闭的单个标签页，不持久化会话数据。
- 更新 `docs/chrome-web-store-checklist.md` 中的版本、15 个文件、6 项权限、功能验收和隐私检查。
- 在 `update.log` 顶部新增 `0.8.1` 中文记录，保留所有旧版本记录。

- [ ] **Step 3：运行完整验证**

Run: `npm run check`

Expected: 类型检查、全部 Vitest、构建和 `dist` 精确审计均通过；测试总数不得少于修改前基线。

Run: `npm run benchmark:tabs`

Expected: 标签渲染基准通过既有性能门槛。

- [ ] **Step 4：生成 ZIP 并审计内容**

Run: `npm run package`

Expected: 生成 `release/sidetab-lite-0.8.1.zip`。

Run:

```powershell
tar -tf release/sidetab-lite-0.8.1.zip
(tar -tf release/sidetab-lite-0.8.1.zip | Measure-Object).Count
Get-FileHash release/sidetab-lite-0.8.1.zip -Algorithm SHA256
```

Expected: ZIP 根目录直接包含扩展文件，条目数精确为 15，不包含源码、测试、source map、缓存、绝对路径或多余顶层目录；记录最终 SHA256。

- [ ] **Step 5：进行浏览器手工验收**

在 `chrome://extensions` 使用“加载已解压的扩展程序”加载 `dist`：

1. 聚焦搜索框默认显示最近记录，输入后按路径去重并最多展示 20 条。
2. 搜索框失焦时向上结果框收起，直接点击结果仍能打开页面。
3. 新建标签页按钮显示用户提供的 18px 图标，图形上下居中，悬停、键盘焦点和禁用态清晰。
4. 右键菜单最后一项可恢复最近关闭的单个标签页；无可恢复标签时禁用。
5. 连续关闭或恢复标签时，侧边栏顺序与 Chrome 保持一致，无重复、残留或凭空出现的标签。
6. 打开 DevTools Performance Monitor，空闲 60 秒确认没有周期性 CPU 活动和持续增长的 DOM 节点或 JS heap。

- [ ] **Step 6：提交 0.8.1 发布改动**

提交前再次读取 `C:\Users\NUC\.codex\rules\git-commit.md`：

```powershell
git add manifest.json package.json package-lock.json README.md docs/chrome-web-store-checklist.md update.log tests/smoke.test.ts tests/release-scripts.test.ts scripts/check-dist.mjs
git commit -m "$(Get-Date -Format yyyyMMddHHmmss) feat 发布0.8.1版本"
```

`release/` 目录按仓库现有 `.gitignore` 规则不纳入提交；ZIP 保留在本地作为可安装交付物，并在最终结果中报告路径和 SHA256。

## 最终完成标准

- `npm run check` 和 `npm run benchmark:tabs` 均通过。
- `release/sidetab-lite-0.8.1.zip` 存在，精确包含 15 个白名单文件。
- Manifest 只新增 `sessions` 权限，没有主机权限和 content script。
- 历史记录最多展示去重后的 20 条；输入框失焦可靠收起。
- 最近关闭控制器只缓存一个字符串 `sessionId`，没有轮询和持久化。
- 恢复操作不直接修改 TabStore，不主动触发标签列表全量重渲染。
- 所有生命周期监听器和计时器在 cleanup/destroy 中释放，迟到异步结果不能更新已销毁界面。
