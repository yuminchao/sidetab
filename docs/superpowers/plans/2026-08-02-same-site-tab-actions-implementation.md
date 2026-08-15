# 同类网站标签批量操作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标签右键菜单中加入“快速分组同类网站”和“关闭其他同类网站标签页”，同时完成菜单分段、浅灰底色、右键目标蓝色边框及新增标签按钮居中回归保护。

**Architecture:** 使用独立纯函数模块从当前 `TabStore` 快照按标准 `URL.hostname` 计算目标集合；标签与分组动作层只负责最少次数的 Chrome API 调用；`tab-context-menu` 只展示可用状态并派发携带 `tabId` 的轻量命令；`sidebar` 在命令执行瞬间重新计算计划并依赖 Chrome 事件同步界面。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM/CSS、Vitest、jsdom、esbuild。

---

## 文件结构

- Create: `src/sidepanel/same-site-tab-model.ts`：解析 HTTP/HTTPS hostname，计算批量关闭目标和快速分组计划。
- Create: `tests/same-site-tab-model.test.ts`：覆盖 hostname、固定/分组过滤、顺序稳定和线性扫描边界。
- Modify: `src/sidepanel/tab-actions.ts`：增加具有独立错误文案的同类标签批量关闭动作。
- Modify: `src/sidepanel/tab-group-actions.ts`：增加同类标签批量建组并保存 hostname/灰色的动作。
- Modify: `src/sidepanel/tab-context-menu.ts`：增加两项命令、两段式菜单、分割线和临时右键目标状态。
- Modify: `src/sidepanel/sidebar.ts`：执行瞬间重新计算目标、并发保护、失败重同步和菜单清理。
- Modify: `src/sidepanel/sidebar.css`：菜单底色、分割线、蓝色边框和加号居中回归样式。
- Modify: `tests/tab-actions.test.ts`、`tests/tab-group-actions.test.ts`、`tests/tab-context-menu.test.ts`、`tests/sidebar.test.ts`、`tests/sidepanel-css.test.ts`：动作、菜单、集成与视觉契约。

### Task 1：同类网站纯函数模型

**Files:**
- Create: `src/sidepanel/same-site-tab-model.ts`
- Create: `tests/same-site-tab-model.test.ts`

- [ ] **Step 1：先写 hostname 解析失败测试**

创建 `tests/same-site-tab-model.test.ts`，导入下列待实现 API：

```ts
import {
  createSameSiteGroupPlan,
  getHttpHostname,
  getOtherSameSiteTabIds,
} from "../src/sidepanel/same-site-tab-model";
```

使用 `fakeTabModel()` 或文件内构造器覆盖：

```ts
expect(getHttpHostname("https://Example.com:8443/a")).toBe("example.com");
expect(getHttpHostname("http://example.com/b")).toBe("example.com");
expect(getHttpHostname("https://www.example.com/")).toBe("www.example.com");
expect(getHttpHostname("chrome://settings/")).toBeUndefined();
expect(getHttpHostname("file:///tmp/a")).toBeUndefined();
expect(getHttpHostname("not a url")).toBeUndefined();
expect(getHttpHostname("")).toBeUndefined();
```

- [ ] **Step 2：运行测试确认模块缺失**

Run: `npm test -- --run tests/same-site-tab-model.test.ts`

Expected: FAIL，提示无法导入 `same-site-tab-model`。

- [ ] **Step 3：实现最小 hostname 解析函数**

创建 `src/sidepanel/same-site-tab-model.ts`：

```ts
import type { TabViewModel } from "./tab-model";

export type SameSiteGroupPlan = {
  hostname: string;
  windowId: number;
  tabIds: [number, number, ...number[]];
};

export function getHttpHostname(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? parsed.hostname
      : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4：写入关闭与分组计划失败测试**

增加以下明确场景：

```ts
expect(getOtherSameSiteTabIds(tabs, 1)).toEqual([3, 5]);
expect(getOtherSameSiteTabIds(tabs, 999)).toEqual([]);
expect(createSameSiteGroupPlan(tabs, 1)).toEqual({
  hostname: "example.com",
  windowId: 10,
  tabIds: [1, 3, 5],
});
```

其中 fixture 必须同时包含：当前目标、同 hostname 的普通未分组标签、同 hostname 的已分组普通标签、同 hostname 固定标签、不同子域、`www` 变体、非 HTTP 页面和其他窗口标签。断言关闭结果保留目标与全部固定标签但包含已分组普通标签；分组计划只包含当前窗口内未固定且未分组的同 hostname 标签，少于两个时返回 `undefined`，输入数组保持不变。

- [ ] **Step 5：实现两个线性计划函数**

在同一模块加入：

```ts
export function getOtherSameSiteTabIds(
  tabs: readonly TabViewModel[],
  tabId: number,
): number[] {
  const target = tabs.find((tab) => tab.id === tabId);
  const hostname = target ? getHttpHostname(target.url) : undefined;
  if (!target || !hostname) return [];
  return tabs
    .filter((tab) =>
      tab.windowId === target.windowId &&
      tab.id !== target.id &&
      !tab.pinned &&
      getHttpHostname(tab.url) === hostname)
    .map((tab) => tab.id);
}

export function createSameSiteGroupPlan(
  tabs: readonly TabViewModel[],
  tabId: number,
): SameSiteGroupPlan | undefined {
  const target = tabs.find((tab) => tab.id === tabId);
  const hostname = target ? getHttpHostname(target.url) : undefined;
  if (!target || !hostname || target.pinned || target.groupId >= 0) return undefined;
  const tabIds = tabs
    .filter((tab) =>
      tab.windowId === target.windowId &&
      !tab.pinned &&
      tab.groupId < 0 &&
      getHttpHostname(tab.url) === hostname)
    .map((tab) => tab.id);
  return tabIds.length >= 2
    ? { hostname, windowId: target.windowId, tabIds: tabIds as SameSiteGroupPlan["tabIds"] }
    : undefined;
}
```

- [ ] **Step 6：运行模型测试、类型检查并提交**

Run: `npm test -- --run tests/same-site-tab-model.test.ts`

Run: `npm run typecheck`

Expected: PASS；500 个标签 fixture 的结果顺序稳定，模型不依赖 `chrome`、DOM 或 Store。

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，只暂存本任务文件，提交消息使用：`yyyyMMddHHmmss feat 新增同类网站标签计划模型`。

### Task 2：批量关闭与快速建组动作

**Files:**
- Modify: `src/sidepanel/tab-actions.ts`
- Modify: `src/sidepanel/tab-group-actions.ts`
- Modify: `tests/tab-actions.test.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：写入批量关闭动作失败测试**

在 `tests/tab-actions.test.ts` 增加：

```ts
await actions.closeOtherSameSite([3, 5]);
expect(remove).toHaveBeenCalledOnce();
expect(remove).toHaveBeenCalledWith([3, 5]);

await actions.closeOtherSameSite([]);
expect(remove).not.toHaveBeenCalled();

remove.mockRejectedValueOnce(new Error("chrome failed"));
await expect(actions.closeOtherSameSite([3])).rejects.toThrow(
  "无法关闭其他同类网站标签页",
);
```

- [ ] **Step 2：实现独立关闭动作**

在 `createTabActions()` 返回对象中加入：

```ts
async closeOtherSameSite(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  try {
    await api.remove(tabIds);
  } catch {
    throw new Error("无法关闭其他同类网站标签页");
  }
},
```

不得复用错误文案为“关闭下方标签页”的 `closeMany()`。

- [ ] **Step 3：写入快速分组动作失败测试**

扩展 `tests/tab-group-actions.test.ts` 的 API fixture，断言：

```ts
await actions.createSameSite({
  tabIds: [1, 3, 5],
  windowId: 10,
  hostname: "example.com",
});
expect(group).toHaveBeenCalledWith({
  tabIds: [1, 3, 5],
  createProperties: { windowId: 10 },
});
expect(update).toHaveBeenCalledWith(7, {
  title: "example.com",
  color: "grey",
});
```

再覆盖 `group()` 失败时提示“无法快速分组同类网站”；`group()` 成功而 `update()` 失败时错误对象包含 `groupId: 7`、`partial: true`，文案为“分组已创建，但无法保存名称或颜色”；无效 groupId 不调用 `update()`。

- [ ] **Step 4：实现批量建组动作**

扩展动作接口并实现：

```ts
createSameSite(input: {
  tabIds: [number, number, ...number[]];
  windowId: number;
  hostname: string;
}): Promise<number>;
```

实现主体只调用一次 `tabs.group()`，取得有效 `groupId` 后复用 `updateCreated(groupId, input.hostname, "grey")`。`tabs.group()` 的 catch 必须抛出带 cause 的 `Error("无法快速分组同类网站")`，不得逐个加入分组。

- [ ] **Step 5：运行动作测试并提交**

Run: `npm test -- --run tests/tab-actions.test.ts tests/tab-group-actions.test.ts`

Run: `npm run typecheck`

Expected: PASS，批量关闭一次 remove，快速分组一次 group 加一次 update。

提交前读取 Git 提交规则，只暂存本任务四个文件，提交消息使用：`yyyyMMddHHmmss feat 新增同类网站批量动作`。

### Task 3：两段式标签右键菜单与临时蓝色边框

**Files:**
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1：写入菜单结构和命令失败测试**

将可见主菜单顺序锁定为：

```ts
[
  "复制标签页",
  "固定标签",
  "设为快捷网站",
  "添加到分组",
  "快速分组同类网站",
  "关闭下方标签页",
  "关闭其他同类网站标签页",
  "打开最近关闭标签页",
]
```

已分组标签仍在“添加到分组”之后显示“从分组中移除”。断言主菜单恰好一个 `[role="separator"]`，位置始终在“快速分组同类网站”和“关闭下方标签页”之间，分割线不是 button、不可聚焦。分别设置 `canGroupSameSite` 与 `canCloseOtherSameSite` 返回 false，断言对应按钮显示但禁用且方向键跳过。

点击或键盘激活时断言命令仅携带目标 ID：

```ts
{ action: "group-same-site", tabId: 1 }
{ action: "close-same-site", tabId: 1 }
```

- [ ] **Step 2：写入临时选中状态和清理失败测试**

右键和 `Shift+F10` 打开菜单后断言目标行：

```ts
expect(row(1).dataset.contextSelected).toBe("true");
expect(row(2).dataset.contextSelected).toBeUndefined();
```

依次验证命令执行、外部 pointerdown、`Escape`、list scroll、window resize、`closeForTab()`、切换目标和 `destroy()` 都删除旧行属性；分组子菜单展开期间属性继续保留；关闭后焦点仍按现有规则返回触发行。

- [ ] **Step 3：运行菜单测试确认失败**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，缺少新命令、分割线、禁用回调和 `data-context-selected`。

- [ ] **Step 4：实现菜单命令、分段和统一清理**

扩展类型：

```ts
export type TabContextCommand =
  | { action: "group-same-site"; tabId: number }
  | { action: "close-same-site"; tabId: number }
  // 保留现有命令联合类型
```

回调增加：

```ts
canGroupSameSite?(id: number): boolean;
canCloseOtherSameSite?(id: number): boolean;
```

创建 `const separator = document.createElement("div")` 并设置 `role="separator"`。`open()` 只计算按钮 disabled 状态并给触发行设置 `data-context-selected="true"`；`close()` 在清空 `openTabId` 前删除 `returnFocus?.dataset.contextSelected`。所有关闭路径继续只调用该 `close()`，禁止各路径分别清理属性。

- [ ] **Step 5：运行菜单测试并提交**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Run: `npm run typecheck`

Expected: PASS，禁用项和 separator 不进入键盘循环，命令不携带预计算 ID 数组。

提交前读取 Git 提交规则，只暂存菜单及其测试，提交消息使用：`yyyyMMddHHmmss feat 整理标签右键菜单批量操作`。

### Task 4：菜单、右键状态和加号视觉契约

**Files:**
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：写入 CSS 红灯断言**

在 `tests/sidepanel-css.test.ts` 增加精确契约：

```ts
expect(css).toMatch(/\.tab-context-menu\s*\{[^}]*background:\s*color-mix\(in srgb, CanvasText 4%, Canvas\)/s);
expect(css).toMatch(/\.tab-context-separator\s*\{[^}]*height:\s*1px[^}]*pointer-events:\s*none/s);
expect(css).toMatch(/\.tab-row\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px #1a73e8/s);
```

深色媒体查询必须把临时边框改为 `#8ab4f8`。同时保留 `.new-tab-button` 的 `display: grid`、`place-items: center`、`44px × 24px`、`padding: 0`、`line-height: 1`；断言不存在 `add-tab.svg`、垂直 `transform`、`top` 或负 margin。

- [ ] **Step 2：运行 CSS 测试确认失败**

Run: `npm test -- --run tests/sidepanel-css.test.ts`

Expected: FAIL，菜单仍为 `Canvas`，缺少 separator 和右键边框规则。

- [ ] **Step 3：实现视觉样式**

菜单主样式改为：

```css
.tab-context-menu {
  background: color-mix(in srgb, CanvasText 4%, Canvas);
}

.tab-context-separator {
  height: 1px;
  margin: 4px 6px;
  background: color-mix(in srgb, CanvasText 18%, transparent);
  pointer-events: none;
}

.tab-row[data-context-selected="true"] {
  box-shadow: inset 0 0 0 1px #1a73e8;
}

@media (prefers-color-scheme: dark) {
  .tab-row[data-context-selected="true"] {
    box-shadow: inset 0 0 0 1px #8ab4f8;
  }
}
```

不要覆盖 `.tab-row[data-active="true"]` 的激活标记；如需组合阴影，为同时匹配 active/context 的规则显式保留 `inset 2px 0 AccentColor` 与完整蓝色内描边。

- [ ] **Step 4：运行 CSS 与菜单测试并提交**

Run: `npm test -- --run tests/sidepanel-css.test.ts tests/tab-context-menu.test.ts`

Run: `git diff --check`

Expected: PASS，新增标签按钮仍上下左右居中且没有定位微调。

提交前读取 Git 提交规则，只暂存 CSS 与测试，提交消息使用：`yyyyMMddHHmmss feat 优化右键菜单与目标状态样式`。

### Task 5：Sidebar 执行瞬间重算与失败恢复

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：写入菜单可用状态和执行重算失败测试**

在 `tests/sidebar.test.ts` 增加同 hostname fixtures，覆盖：

- 只有目标时两项菜单禁用。
- 存在同 hostname 普通标签时“关闭其他”可用。
- 只有已分组同 hostname 普通标签时“关闭其他”可用，但“快速分组”禁用。
- 目标固定、已分组或非 HTTP/HTTPS 时“快速分组”禁用。
- 菜单打开后通过 `tabs.onCreated/onUpdated/onRemoved` 改变快照，再点击命令，API 接收执行瞬间重新计算的 ID，而不是打开菜单时的旧数组。

关键断言：

```ts
expect(fake.methods.remove).toHaveBeenCalledWith([3, 5]);
expect(fake.methods.group).toHaveBeenCalledWith({
  tabIds: [1, 3, 5],
  createProperties: { windowId: 10 },
});
```

- [ ] **Step 2：写入并发、部分失败和清理失败测试**

覆盖：同一批候选在第一次分组未完成时不可重复提交；`tabs.group()` 失败只显示“无法快速分组同类网站”并触发一次重同步；元数据更新失败保留 Chrome 默认分组，显示“分组已创建，但无法保存名称或颜色”并触发一次重同步；关闭失败不提前删除 DOM；cleanup 后迟到 rejection 不更新状态。

- [ ] **Step 3：运行 sidebar 测试确认失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，sidebar 尚未提供新菜单回调或命令分支。

- [ ] **Step 4：集成模型与命令**

导入：

```ts
import {
  createSameSiteGroupPlan,
  getOtherSameSiteTabIds,
} from "./same-site-tab-model";
```

菜单回调使用当前快照：

```ts
canCloseOtherSameSite: (id) => getOtherSameSiteTabIds(tabStore.list(), id).length > 0,
canGroupSameSite: (id) => createSameSiteGroupPlan(tabStore.list(), id) !== undefined,
```

命令处理必须重新计算：

```ts
if (command.action === "close-same-site") {
  const ids = getOtherSameSiteTabIds(tabStore.list(), command.tabId);
  runTabOperation(tabActions.closeOtherSameSite(ids));
  return;
}

if (command.action === "group-same-site") {
  const plan = createSameSiteGroupPlan(tabStore.list(), command.tabId);
  if (!plan || plan.tabIds.some((id) => groupTabBusy.has(id))) return;
  for (const id of plan.tabIds) groupTabBusy.add(id);
  runTabOperation(
    groupActions.createSameSite(plan),
    () => { for (const id of plan.tabIds) groupTabBusy.delete(id); },
    () => { void resyncTabsAndGroups(); },
  );
}
```

成功路径不得直接修改 Store 或 DOM。关闭命令目标为空时动作层静默返回；分组计划无效时不得调用 Chrome API。

- [ ] **Step 5：运行专项测试和性能基准**

Run: `npm test -- --run tests/same-site-tab-model.test.ts tests/tab-actions.test.ts tests/tab-group-actions.test.ts tests/tab-context-menu.test.ts tests/sidebar.test.ts tests/sidepanel-css.test.ts`

Run: `npm run benchmark:tabs`

Run: `npm run typecheck`

Expected: PASS；不新增 `chrome.tabs.query()`、hostname 索引、轮询或监听器。

- [ ] **Step 6：提交 sidebar 集成**

提交前读取 Git 提交规则，只暂存 `sidebar.ts` 与 `sidebar.test.ts`，提交消息使用：`yyyyMMddHHmmss feat 集成同类网站标签批量操作`。

### Task 6：第一阶段完整验证

**Files:**
- No source changes expected.

- [ ] **Step 1：运行完整检查**

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Expected: 类型检查、全部 Vitest、构建、dist 审计和标签渲染基准全部通过。

- [ ] **Step 2：审计权限与查询次数**

Run: `Get-Item 'src\sidepanel\same-site-tab-model.ts','src\sidepanel\tab-context-menu.ts' | Select-String -Pattern 'chrome\.tabs\.query|chrome\.tabGroups\.query|setInterval|setTimeout'`

Expected: 无匹配；`manifest.json` 权限列表不变。

- [ ] **Step 3：检查工作区**

Run: `git status --short`

Expected: 源码与测试提交完成，工作区干净；本阶段不改版本、不写 `update.log`、不打包，统一发布留到标签组右键菜单计划末尾。
