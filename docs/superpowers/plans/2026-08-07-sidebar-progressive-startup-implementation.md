# 侧边栏渐进启动与快速分组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除侧边栏每次打开约 10 秒的空白标签列表，同时完成分组活动样式、默认 14px 字号、单标签快速分组、自动避色和右键菜单分区，并保持搜索结果打开成功后清空搜索框。

**Architecture:** 用 `windows.getCurrent({ populate: true })` 建立首屏标签快照并立即渲染、返回 cleanup；快捷设置和完整标签/分组对账在后台独立收敛。分组快照就绪状态显式控制快速分组可用性，颜色由纯模型函数基于内存快照选择。菜单继续使用原生 DOM 与事件委托，只调整项目顺序、分隔线和共享字体样式。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM、Chrome `windows/tabs/tabGroups/storage` API、Vitest、jsdom、CSS。

---

## 前置条件

- 工作目录：`E:\java\sidebar\.worktrees\feature-side-panel-tabs`。
- 设计依据：`docs/superpowers/specs/2026-08-07-sidebar-progressive-startup-design.md`。
- 严格按 TDD 执行，每个行为先观察目标测试失败，再修改生产代码。
- 提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，用本地时间生成 14 位时间戳。
- 当前工作树已有 `0.10.1` 发布元数据改动；每次只暂存任务明确列出的文件，不得暂存或覆盖 `README.md`、`docs/chrome-web-store-checklist.md`、`manifest.json`、`package.json`、`package-lock.json`、`tests/smoke.test.ts`、`update.log`。
- 本计划不升级版本、不修改发布说明、不执行 `npm run package`、不生成 ZIP，因此不触发新的版本和 `update.log` 记录。

## 文件映射

- Modify: `tests/helpers/fake-chrome.ts`：支持 `getCurrent({ populate: true })` 返回标签快照。
- Modify: `src/sidepanel/sidebar.ts`：渐进启动、后台对账、分组快照就绪状态和快速分组颜色接线。
- Modify: `tests/sidebar.test.ts`：首屏时序、降级、事件收敛、快速分组、字号与搜索回归。
- Modify: `src/sidepanel/same-site-tab-model.ts`：允许单标签计划并选择未使用颜色。
- Modify: `tests/same-site-tab-model.test.ts`：单标签、过滤、颜色选择和线性复杂度。
- Modify: `src/sidepanel/tab-group-actions.ts`：快速分组接收选定颜色和单元素非空数组。
- Modify: `tests/tab-group-actions.test.ts`：颜色透传、单标签和错误消息。
- Modify: `src/sidepanel/tab-context-menu.ts`：菜单重命名、三区排序和第二条分隔线。
- Modify: `tests/tab-context-menu.test.ts`：菜单结构、焦点和键盘回归。
- Modify: `src/sidepanel/sidebar.css`：分组活动竖线、默认字号和菜单微软雅黑 14px。
- Modify: `tests/sidepanel-css.test.ts`：亮色、深色、强制色和菜单字体结构断言。
- Modify: `src/sidepanel/shortcut-model.ts`：默认标签标题字号改为 14。
- Modify: `tests/shortcut-model.test.ts`：默认、旧设置迁移与显式字号保留。
- Verify only: `src/sidepanel/history-search.ts`、`tests/history-search.test.ts`：搜索结果成功清空与失败保留已由 `fe0378d` 实现，本次只回归。

### Task 1：建立渐进首屏的失败测试与 Chrome 假对象

**Files:**
- Modify: `tests/helpers/fake-chrome.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：让假窗口 API 支持 populate 快照**

将 `getCurrent` 改为接收查询参数，并在 `populate: true` 时返回当前 `tabState` 的克隆：

```ts
const getCurrent = vi.fn(async (queryOptions?: chrome.windows.QueryOptions) => {
  const currentWindow = options.currentWindow ?? ({ id: 10 } as chrome.windows.Window);
  return queryOptions?.populate
    ? { ...currentWindow, tabs: tabState.map((tab) => ({ ...tab })) }
    : currentWindow;
});
```

不要把 `tabs` 写回 `options.currentWindow`，确保测试间状态隔离。

- [ ] **Step 2：把基础启动断言改为 populate**

更新首个 Sidebar 启动测试：

```ts
expect(fake.methods.getCurrent).toHaveBeenCalledWith({ populate: true });
expect(rowIds()).toEqual([1, 2]);
```

正常首屏不再依赖首次 `tabs.query()`；完整后台对账仍应最终调用：

```ts
await vi.waitFor(() => {
  expect(fake.methods.query).toHaveBeenCalledWith({ windowId: 10 });
  expect(fake.methods.groupQuery).toHaveBeenCalledWith({ windowId: 10 });
});
```

- [ ] **Step 3：新增慢分组与慢 storage 的首屏红灯测试**

分别把 `groupQuery`、两个 `storageGet` 返回值设为 deferred。调用 `startSidebar(fake)` 后，必须在这些 Promise 未完成时取得 cleanup、看到标签并标记 ready：

```ts
const groups = deferred<chrome.tabGroups.TabGroup[]>();
fake.methods.groupQuery.mockReturnValueOnce(groups.promise);

const cleanup = await startSidebar(fake);
expect(rowIds()).toEqual([1, 2]);
expect(document.documentElement.dataset.ready).toBe("true");
expect(groupRow(7)).toBeNull();
```

storage 测试同时断言设置按钮仍保持自身加载态，标签激活点击可立即调用 `tabs.update`。完成 deferred 后用 `vi.waitFor()` 验证分组和快捷入口原位补齐。

- [ ] **Step 4：运行并确认红灯原因**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: 新测试 FAIL；现实现等待 `tabGroups.query()` 和 storage，且 `getCurrent` 调用参数不是 `{ populate: true }`。失败不得来自 fixture 或类型错误。

### Task 2：实现快速首屏和后台一致性收敛

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：把完整对账改为可报告首次分组状态**

为 `resyncTabsAndGroups` 增加可选的首次启动参数，例如：

```ts
const resyncTabsAndGroups = (reportInitialStatus = false): Promise<void> => {
```

查询使用 `Promise.allSettled()`，让标签和分组结果可独立应用。标签成功时更新 `TabStore`；分组成功时更新 `TabGroupStore`、设置 `groupsReady = true` 并清除分组错误；首次分组失败时设置“无法读取当前窗口的标签分组”并保持 `groupsReady = false`。后续操作触发的 best-effort 对账失败仍保留最后一致视图，不循环重试。

```ts
const [tabsResult, groupsResult] = await Promise.allSettled([
  deps.tabs.query({ windowId }),
  deps.tabGroups.query({ windowId }),
]);
```

无论结果如何都要走现有 `finishBufferedEvents()`；只有快照或缓冲事件实际改变状态时才渲染。

- [ ] **Step 2：实现 populate 首屏和 tabs 缺失降级**

将 `loadTabsAndGroups` 改为只等待首屏：

```ts
const currentWindow = await deps.windows.getCurrent({ populate: true });
const windowId = requireValidWindowId(currentWindow.id);
const initialTabs = Array.isArray(currentWindow.tabs)
  ? currentWindow.tabs
  : await deps.tabs.query({ windowId });

if (!active) return;
currentWindowId = windowId;
tabStore.initialize(initialTabs);
groupStore.initialize([], windowId);
syncShortcutFavicons();
renderTabList();
deps.document.documentElement.dataset.ready = "true";
```

渲染后立即注册现有 tab/group 监听器、打开事件缓冲，再调用但不等待首次完整对账：

```ts
bufferingEvents = true;
unsubscribeTabs = subscribeWithBufferedAsyncEvents(windowId);
unsubscribeGroups = subscribeToTabGroupEvents(
  deps.tabGroups,
  windowId,
  groupEventHandlers,
);
void resyncTabsAndGroups(true);
```

快照到订阅之间的极小缺口由该完整对账消除。不得清空已渲染列表。

- [ ] **Step 3：解除总 Promise 屏障**

`loadShortcuts` 和首次完整对账都在内部捕获错误。`startSidebarInternal()` 只等待首屏标签分支，不再 `await Promise.all([loadShortcuts, loadTabsAndGroups])`：

```ts
void loadShortcuts;
await loadInitialTabs();
return cleanup;
```

若窗口 ID、窗口 API 或降级 `tabs.query` 失败，设置标签错误并返回 cleanup；销毁或 AbortSignal 已失效时不设置 ready、不注册监听器、不写 DOM。

- [ ] **Step 4：改写旧启动事件测试以匹配双快照语义**

旧测试中第一次 `tabs.query()`/`groupQuery()` 现在属于后台完整对账。保留以下覆盖：

- 首屏快照显示后、后台查询完成前产生的 created/updated/moved/removed/group 事件按接收顺序重放。
- `onAttached`/`onReplaced` 的异步 `tabs.get()` 在 cleanup 后不写 Store 或 DOM。
- 后台标签成功、分组失败时保留普通标签并显示分组错误。
- 后台标签失败、分组成功时仍补充分组快照且不清空首屏标签。
- 重复对账继续合并，不增加监听器。

- [ ] **Step 5：新增降级、失败和 pagehide 测试**

覆盖 `getCurrent({ populate: true })` 返回 `{ id: 10, tabs: undefined }` 时只为首屏额外调用一次 `tabs.query({ windowId: 10 })`；覆盖无效 ID、窗口拒绝、降级查询拒绝。自动入口在 populate、降级查询、storage 或后台对账迟到时收到 `pagehide`，均不得设置 ready 或更新列表。

- [ ] **Step 6：运行专项验证**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: PASS；慢分组和慢 storage 时标签先出现，后台结果最终收敛，所有生命周期测试通过。

Run: `npm run typecheck`

Expected: PASS；`windows.QueryOptions`、`Window.tabs` 和后台 Promise 无未处理类型错误。

- [ ] **Step 7：提交渐进启动实现**

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
git add -- src/sidepanel/sidebar.ts tests/helpers/fake-chrome.ts tests/sidebar.test.ts
git commit -m "$stamp fix 加快侧边栏首次标签渲染"
```

### Task 3：支持单标签快速分组和自动避色

**Files:**
- Modify: `src/sidepanel/same-site-tab-model.ts`
- Modify: `tests/same-site-tab-model.test.ts`
- Modify: `src/sidepanel/tab-group-actions.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：先写单标签和颜色选择红灯测试**

将“only one eligible tab exists”从拒绝表移出，新增：

```ts
expect(createSameSiteGroupPlan([tab()], 1)).toEqual({
  hostname: "example.com",
  windowId: 10,
  tabIds: [1],
});
```

新增 `selectQuickGroupColor()` 测试：空列表返回 `grey`；`grey/blue/red` 已用时返回 `yellow`；同一颜色重复仍只按占用处理；九色全用且 9 个组时返回 `grey`、10 个组时返回 `blue`；不同窗口组不参与；输入不变。

- [ ] **Step 2：实现非空计划和 O(n) 避色函数**

把计划类型改为：

```ts
tabIds: [number, ...number[]];
```

候选为空才返回 `undefined`。颜色函数接收当前窗口 ID 和只读分组列表：

```ts
export function selectQuickGroupColor(
  groups: readonly TabGroupViewModel[],
  windowId: number,
): TabGroupColor {
  const windowGroups = groups.filter((group) => group.windowId === windowId);
  const used = new Set(windowGroups.map((group) => group.color));
  return TAB_GROUP_COLORS.find((color) => !used.has(color))
    ?? TAB_GROUP_COLORS[windowGroups.length % TAB_GROUP_COLORS.length]!;
}
```

500 项复杂度测试继续只允许线性读取，不排序、不嵌套扫描调色板以外的数据。

- [ ] **Step 3：让执行层接收颜色**

扩展 `createSameSite` 输入：

```ts
createSameSite(input: {
  tabIds: [number, ...number[]];
  windowId: number;
  hostname: string;
  color: TabGroupColor;
}): Promise<number>;
```

调用 `updateCreated(groupId, input.hostname, input.color)`；错误文案同步改为“无法快速分组”。测试覆盖 `tabIds: [3]` 原样传给 `tabs.group`、指定颜色原样传给 `tabGroups.update`，以及创建失败和元数据部分失败。

- [ ] **Step 4：运行模型与动作测试**

Run: `npm test -- --run tests/same-site-tab-model.test.ts tests/tab-group-actions.test.ts`

Expected: PASS；单标签、过滤、颜色耗尽、输入不可变和错误路径全部通过。

- [ ] **Step 5：提交纯模型和动作层**

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
git add -- src/sidepanel/same-site-tab-model.ts tests/same-site-tab-model.test.ts src/sidepanel/tab-group-actions.ts tests/tab-group-actions.test.ts
git commit -m "$stamp feat 支持快速分组单标签并自动避色"
```

### Task 4：接入分组快照状态并重排右键菜单

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1：先写快照就绪与集成红灯测试**

在 `groupQuery` deferred 时打开菜单，断言“快速分组”禁用；成功 resolve 后重新打开即启用。分组读取失败后仍禁用。成功路径覆盖：

- 只有一个 `example.com` 标签时 `tabs.group({ tabIds: [1], createProperties: { windowId: 10 } })`。
- 当前组已用 `grey`、`blue` 时 metadata update 使用 `red`。
- 操作未完成时同主机候选保持 busy，完成或失败后恢复。
- 错误状态使用“无法快速分组”，失败后只触发一次后台对账。

- [ ] **Step 2：把 groupsReady 纳入菜单上下文和点击复验**

`groupsReady` 初始为 `false`，只在当前窗口分组快照成功应用时变为 `true`。菜单上下文：

```ts
canGroupSameSite: groupsReady && availability.canGroupSameSite
```

点击命令必须再次检查 `groupsReady`、重新创建计划并检查所有候选 busy，然后计算颜色：

```ts
const color = selectQuickGroupColor(groupStore.list(), plan.windowId);
groupActions.createSameSite({ ...plan, color });
```

不能依赖菜单打开时的旧计划或旧颜色。

- [ ] **Step 3：把菜单改成三区和两个分隔线**

菜单标签改为“快速分组”。创建两个独立 separator 节点，顺序固定为：

```ts
menu.append(
  duplicate,
  setPinned,
  addShortcut,
  generalSeparator,
  addToGroup,
  removeFromGroup,
  groupSameSite,
  groupSeparator,
  closeBelow,
  closeSameSite,
  restoreRecentlyClosed,
);
```

两个节点均为 `div.tab-context-separator[role="separator"]`，无 `tabindex`。现有 `getAvailableItems()` 只查询可用按钮，因此无需新增键盘分支。

- [ ] **Step 4：更新菜单鼠标和键盘测试**

精确断言 11 个子项顺序、两个 separator 不可聚焦、可见按钮文本中只有“快速分组”。ArrowUp/ArrowDown 必须跨过 separator 和隐藏的“从分组中移除”；二级菜单 ArrowLeft/Escape 和焦点返回保持原行为。

- [ ] **Step 5：运行集成测试**

Run: `npm test -- --run tests/tab-context-menu.test.ts tests/sidebar.test.ts`

Expected: PASS；菜单结构、单标签避色、快照门控、失败恢复和键盘导航全部通过。

- [ ] **Step 6：提交菜单与接线**

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
git add -- src/sidepanel/sidebar.ts tests/sidebar.test.ts src/sidepanel/tab-context-menu.ts tests/tab-context-menu.test.ts
git commit -m "$stamp feat 完善快速分组菜单与状态控制"
```

### Task 5：调整分组活动样式、默认字号和菜单字体

**Files:**
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`
- Modify: `src/sidepanel/shortcut-model.ts`
- Modify: `tests/shortcut-model.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：先更新默认字号模型测试**

把默认设置、导出边界、缺字段旧对象和 getter/proxy 覆盖中的默认期望从 16 改为 14。保留显式 16 的测试，证明用户已保存值不被迁移覆盖。

Run: `npm test -- --run tests/shortcut-model.test.ts`

Expected: FAIL；`DEFAULT_TAB_TITLE_FONT_SIZE` 仍为 16。

- [ ] **Step 2：修改默认常量和 CSS 初始值**

```ts
export const DEFAULT_TAB_TITLE_FONT_SIZE = 14;
```

```css
:root {
  --tab-title-font-size: 14px;
}
```

Sidebar 初始加载测试期望 `14px`；显式存储 16/17 的测试继续保持对应值。

- [ ] **Step 3：先写分组活动样式红灯测试再实现**

保留未分组 active 的 `inset 2px 0 AccentColor`。在通用 active/context 规则之后增加更具体规则：

```css
.tab-row[data-active="true"][data-group-id] {
  box-shadow: none;
}

.tab-row[data-active="true"][data-group-id][data-context-selected="true"] {
  box-shadow: inset 0 0 0 1px #1a73e8;
}
```

深色媒体中覆盖组合规则为 `#8ab4f8`。强制色继续依赖 outline 表达临时上下文选中，分组边框继续使用 `CanvasText`；测试断言 grouped active 规则不包含 `AccentColor`，但不移除 background、border 或 outline。

- [ ] **Step 4：显式设置两级菜单微软雅黑 14px**

在共享 `.tab-context-menu` 规则中保留现有字体栈并增加：

```css
font-size: 14px;
```

CSS 测试断言该规则包含 `Microsoft YaHei`、`微软雅黑` 和 `14px`，且不包含 `var(--tab-title-font-size)`；因为二级菜单共享同一 class，无需重复规则。

- [ ] **Step 5：运行样式与设置测试**

Run: `npm test -- --run tests/shortcut-model.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts`

Expected: PASS；默认 14、显式 16 保留、分组 active 无竖线、两级菜单 14px 全部通过。

- [ ] **Step 6：提交样式和字号**

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
git add -- src/sidepanel/sidebar.css tests/sidepanel-css.test.ts src/sidepanel/shortcut-model.ts tests/shortcut-model.test.ts tests/sidebar.test.ts
git commit -m "$stamp feat 优化分组状态与默认字体样式"
```

### Task 6：完整回归、性能和敏感信息审计

**Files:**
- Verify only: 全仓库

- [ ] **Step 1：验证搜索结果成功清空和失败保留**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: PASS；收藏夹和历史记录的鼠标慢速点击及 Enter 成功后 `input.value === ""`、结果隐藏；打开失败时输入值和结果保留。不得修改 `history-search.ts`，除非该既有测试被本次改动真实破坏。

- [ ] **Step 2：运行核心专项测试**

Run:

```powershell
npm test -- --run tests/sidebar.test.ts tests/same-site-tab-model.test.ts tests/tab-group-actions.test.ts tests/tab-context-menu.test.ts tests/shortcut-model.test.ts tests/sidepanel-css.test.ts tests/history-search.test.ts
```

Expected: PASS。

- [ ] **Step 3：运行类型、全量、构建和 dist 审计**

Run: `npm run check`

Expected: typecheck、全部 Vitest、build、`check-dist.mjs` 均 PASS；发布文件清单不变。

- [ ] **Step 4：运行观察性性能基准**

Run: `npm run benchmark:tabs`

Expected: 输出 100/500 标签的 JSON 指标并正常退出；不把机器波动的毫秒值设为硬失败门槛。确认启动路径没有新增 `setInterval`、轮询或持久标签缓存。

- [ ] **Step 5：检查敏感信息和范围**

Run:

```powershell
rg -n -i "公司|company|employee|客户|customer|password|passwd|secret|token|api[_-]?key|private[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|C:\\Users\\|E:\\java\\" src tests manifest.json README.md
git diff --check
git status --short
```

Expected: 无新增公司、个人、凭据或本机绝对路径；`git diff --check` 无输出。状态中只允许用户原有的 `0.10.1` 发布元数据改动，不应有本计划遗漏的未提交产品文件。

- [ ] **Step 6：真实 Chrome 验收**

加载 `dist` 解压扩展并重复打开侧边栏，验证：标签立即出现；分组稍后原位补齐；分组快照完成前快速分组禁用；单标签可快速分组且颜色优先未占用；菜单三区和两级菜单均为微软雅黑 14px；分组 active 无左竖线；搜索结果成功打开后清空。

- [ ] **Step 7：最终提交检查**

```powershell
git log --oneline -6
git status --short
```

Expected: 本计划实现提交均符合时间戳规则；没有暂存文件；不提交、不覆盖用户原有发布元数据，不打包。
