# 标签组右键菜单与标题样式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分组标题行改为 20px 高、14px 字号和整行分组色底，并提供新建标签、重命名、改色、解散分组的独立右键菜单，最后与同类网站标签功能统一发布为 0.9.0 安装包。

**Architecture:** `tab-renderer` 只把真实 `TabGroupViewModel` 映射为紧凑分组行；新的 `tab-group-context-menu` 负责菜单、颜色子菜单和临时目标状态；新的 `tab-group-rename-dialog` 负责单一名称编辑会话；分组动作层封装 Chrome API，`sidebar` 在执行瞬间从 `TabStore`/`GroupStore` 重算位置和成员并依赖 Chrome 事件同步。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM/CSS、HTMLDialogElement、Vitest、jsdom、esbuild、PowerShell、Node.js 发布脚本。

---

## 前置条件

- 先完整执行 `docs/superpowers/plans/2026-08-02-same-site-tab-actions-implementation.md`。
- 本计划不得改变已确认的标签右键菜单两段顺序、同类网站 hostname 规则或批量目标计算。
- 本计划不新增权限、资源文件、轮询、缓存或 Chrome 事件监听器。

## 文件结构

- Modify: `src/sidepanel/tab-renderer.ts`：移除分组颜色圆点，把颜色写到整行 dataset。
- Modify: `src/sidepanel/sidebar.css`：20px 分组行、14px 标题、九种整行底色、对比前景色和交互状态。
- Create: `src/sidepanel/tab-group-context-menu.ts`：分组主菜单、颜色子菜单、键盘导航、定位和临时边框。
- Create: `src/sidepanel/tab-group-rename-dialog.ts`：名称编辑会话、忙碌状态、错误保留和生命周期清理。
- Modify: `src/sidepanel/tab-group-actions.ts`：分组内新建标签、重命名、改色和批量解散动作。
- Modify: `src/sidepanel/index.html`：增加独立重命名 dialog。
- Modify: `src/sidepanel/sidebar.ts`：菜单互斥、执行瞬间重算、分组级忙碌、失败重同步和清理。
- Modify: `tests/helpers/fake-chrome.ts`：让 create/update/group/ungroup 可验证新行为和真实状态变化。
- Create: `tests/tab-group-context-menu.test.ts`、`tests/tab-group-rename-dialog.test.ts`。
- Modify: `tests/tab-renderer.test.ts`、`tests/sidepanel-css.test.ts`、`tests/sidepanel-markup.test.ts`、`tests/tab-group-actions.test.ts`、`tests/tab-context-menu.test.ts`、`tests/sidebar.test.ts`。
- Modify: `manifest.json`、`package.json`、`package-lock.json`、`README.md`、`docs/chrome-web-store-checklist.md`、`update.log`、`tests/smoke.test.ts`：统一发布 0.9.0。

### Task 1：紧凑分组标题行与整行颜色

**Files:**
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：先写渲染器红灯测试**

修改分组行测试，要求：

```ts
const row = list.querySelector<HTMLElement>(".tab-group-row")!;
expect(row.dataset.groupId).toBe("7");
expect(row.dataset.groupColor).toBe("blue");
expect(row.querySelector(".tab-group-color")).toBeNull();
expect(row.querySelector(".tab-group-title")?.textContent).toBe("未命名分组");
```

调用 `renderer.patchGroup({ ...group, color: "orange", title: "Updated" })` 后断言复用同一 row/main/title 节点，只更新 `data-group-color="orange"`、标题和 ARIA，不重建 DOM。

- [ ] **Step 2：先写 20px、14px 和九色背景 CSS 红灯测试**

用 PostCSS/正则锁定：

```ts
expect(css).toMatch(/\.tab-group-row\s*{[^}]*height:\s*20px/s);
expect(css).toMatch(/\.tab-group-main\s*{[^}]*grid-template-columns:\s*12px\s+minmax\(0,\s*1fr\)[^}]*height:\s*20px[^}]*padding:\s*0\s+6px/s);
expect(css).toMatch(/\.tab-group-title\s*{[^}]*font-size:\s*14px[^}]*line-height:\s*20px/s);
expect(css).not.toMatch(/\.tab-group-color\s*{/);
```

遍历 `TAB_GROUP_COLORS`，断言每个 `.tab-group-row[data-group-color="..."]` 都有 background；深色主题存在对应浅色背景。普通 `.tab-row` 仍为 `var(--tab-row-height)` 且根变量保持 `30px`。修改 `--tab-title-font-size` 不得影响 `.tab-group-title`。

- [ ] **Step 3：运行专项测试确认失败**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts`

Expected: FAIL，当前仍渲染圆点、分组行 28px 且标题未固定 14px。

- [ ] **Step 4：更新分组 DOM 映射**

`createGroupRow()` 改为只创建并追加：

```ts
main.append(chevron, title);
```

`updateGroupRow()` 删除 `.tab-group-color` 查询，改为：

```ts
row.dataset.groupColor = group.color;
title.textContent = displayTitle;
```

继续维护 `data-group-id`、`data-collapsed`、`aria-expanded` 和包含折叠状态的 `aria-label`。

- [ ] **Step 5：实现紧凑九色样式**

基础布局：

```css
.tab-group-row,
.tab-group-main {
  height: 20px;
}

.tab-group-main {
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 6px;
  padding: 0 6px;
}

.tab-group-title {
  font-family: "Microsoft YaHei", "微软雅黑", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
}
```

浅色主题背景使用现有九种原色：`#80868b/#1a73e8/#d93025/#f9ab00/#188038/#d01884/#a142f4/#007b83/#fa7b17`。灰、蓝、红、绿、粉、青使用白色前景；黄、紫、橙使用 `#202124`。深色主题使用现有九种浅色变体并统一使用 `#202124` 前景。悬停与按下只在透明的 `.tab-group-main` 上叠加 `color-mix()`，不得替换 row 的分组色。

- [ ] **Step 6：运行测试、视觉静态检查并提交**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts`

Run: `npm run typecheck`

Expected: PASS，分组 patch 复用节点，20px 行在最小宽度无溢出。

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，只暂存本任务四个文件，提交消息使用：`yyyyMMddHHmmss feat 优化标签组标题行样式`。

### Task 2：独立分组右键菜单与颜色子菜单

**Files:**
- Create: `src/sidepanel/tab-group-context-menu.ts`
- Create: `tests/tab-group-context-menu.test.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：写入主菜单结构与命令红灯测试**

创建 `tests/tab-group-context-menu.test.ts`，DOM fixture 包含：

```html
<div id="list">
  <div class="tab-group-row" data-group-id="7" data-group-color="blue">
    <button class="tab-group-main">Work</button>
  </div>
</div>
```

导入待实现工厂并按以下接口创建：

```ts
const menu = createTabGroupContextMenu(
  { document, list, viewport: window },
  {
    getGroup: (id) => groups.find((group) => group.id === id),
    isGroupBusy: () => false,
    onBeforeOpen: vi.fn(),
    onCommand,
  },
);
```

右键后断言主菜单可见、位置限制在 viewport 内、焦点在第一项，菜单文字严格为“在分组中新建标签页、重命名分组、修改颜色、解散分组”，且只有一条 separator 位于第三、第四项之间。点击分别派发：

```ts
{ action: "new-tab", groupId: 7 }
{ action: "rename", groupId: 7 }
{ action: "dissolve", groupId: 7 }
```

- [ ] **Step 2：写入颜色子菜单和键盘红灯测试**

“修改颜色”必须有 `aria-haspopup="menu"`。展开后九项顺序等于 `TAB_GROUP_COLORS`，每项为 `role="menuitemradio"`，包含色块和中文名称；当前 `blue` 为 `aria-checked="true"` 且 disabled。选择 red 派发：

```ts
{ action: "set-color", groupId: 7, color: "red" }
```

覆盖 hover 展开、边缘左右翻转、上下循环跳过当前颜色、ArrowRight 进入、ArrowLeft 返回、Enter/空格执行、Escape 关闭两层菜单。

- [ ] **Step 3：写入临时边框和生命周期红灯测试**

右键或 `Shift+F10` 后断言分组 row 有 `data-context-selected="true"`；颜色子菜单打开期间保留。命令、外部点击、Escape、滚动、resize、`closeForGroup(7)`、切换分组和 destroy 全部清除属性与临时 DOM。`isGroupBusy(7)` 为 true 时四项全部禁用且不派发命令。

- [ ] **Step 4：运行测试确认模块缺失**

Run: `npm test -- --run tests/tab-group-context-menu.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 5：实现独立菜单模块**

定义：

```ts
export type TabGroupContextCommand =
  | { action: "new-tab"; groupId: number }
  | { action: "rename"; groupId: number }
  | { action: "set-color"; groupId: number; color: TabGroupColor }
  | { action: "dissolve"; groupId: number };

export function createTabGroupContextMenu(
  elements: { document: Document; list: HTMLElement; viewport: Window },
  callbacks: {
    getGroup(id: number): TabGroupViewModel | undefined;
    isGroupBusy(id: number): boolean;
    onBeforeOpen(): void;
    onCommand(command: TabGroupContextCommand): void;
  },
): {
  close(restoreFocus?: boolean): void;
  closeForGroup(groupId: number): void;
  destroy(): void;
};
```

实现沿用 `tab-context-menu` 的委托监听、viewport 定位、可用项循环和统一 `close()` 清理模式。九种中文名使用只读静态映射；菜单命令只保存 groupId/color，不保存成员标签 ID。

- [ ] **Step 6：增加分组菜单与蓝色边框 CSS**

分组菜单复用或组合 `.tab-context-menu` 基础类，使用 `color-mix(in srgb, CanvasText 4%, Canvas)`、微软雅黑、现有边框/阴影/hover/active。颜色项使用固定两列“色块 + 名称”。临时状态：

```css
.tab-group-row[data-context-selected="true"] {
  box-shadow: inset 0 0 0 1px #1a73e8;
}

.tab-group-row[data-context-selected="true"][data-group-color="blue"] {
  box-shadow:
    inset 0 0 0 1px #1a73e8,
    inset 0 0 0 2px Canvas;
}
```

深色主题把蓝色边框改为 `#8ab4f8`，蓝色分组仍保留 `Canvas` 对比衬线。所有阴影为 inset，不改变 20px 高度。

- [ ] **Step 7：运行测试并提交**

Run: `npm test -- --run tests/tab-group-context-menu.test.ts tests/sidepanel-css.test.ts`

Run: `npm run typecheck`

Expected: PASS，九种颜色、菜单清理和键盘导航完整。

提交前读取 Git 提交规则，只暂存本任务四个文件，提交消息使用：`yyyyMMddHHmmss feat 新增标签组右键菜单`。

### Task 3：独立分组重命名弹窗

**Files:**
- Create: `src/sidepanel/tab-group-rename-dialog.ts`
- Create: `tests/tab-group-rename-dialog.test.ts`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-markup.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：写入弹窗标记红灯测试**

在 `tests/sidepanel-markup.test.ts` 断言独立结构：

```html
<dialog id="tab-group-rename-dialog" aria-labelledby="tab-group-rename-title">
  <form id="tab-group-rename-form" method="dialog" novalidate>
    <header class="dialog-header">
      <h2 id="tab-group-rename-title">重命名分组</h2>
    </header>
    <label for="tab-group-rename-name">
      <span>名称</span>
      <input id="tab-group-rename-name" type="text" autocomplete="off" />
    </label>
    <p id="tab-group-rename-error" role="alert"></p>
    <div class="dialog-actions dialog-actions-primary">
      <button id="tab-group-rename-cancel" type="button">取消</button>
      <button id="tab-group-rename-save" class="primary-button" type="submit">保存</button>
    </div>
  </form>
</dialog>
```

断言不含颜色 radio，不嵌套卡片，所有 label/ARIA 关联正确。

- [ ] **Step 2：写入控制器会话红灯测试**

创建 `tests/tab-group-rename-dialog.test.ts`，按接口：

```ts
const controller = createTabGroupRenameDialog(elements, {
  onSave: vi.fn(async () => undefined),
});
controller.open(7, " Work ");
```

覆盖：预填当前名称并调用 `select()`；未命名预填空；submit 传 `{ groupId: 7, title: "New name" }` 且 trim 首尾；空白提交空字符串；busy 时输入/取消/保存禁用且重复 submit 不执行；成功关闭；失败保留 dialog、原输入和错误；取消/Escape 关闭；旧异步结果不得关闭新会话；destroy 后不响应。

- [ ] **Step 3：运行标记与控制器测试确认失败**

Run: `npm test -- --run tests/sidepanel-markup.test.ts tests/tab-group-rename-dialog.test.ts`

Expected: FAIL，标记和模块不存在。

- [ ] **Step 4：实现重命名控制器**

定义：

```ts
export type TabGroupRenameDialog = {
  open(groupId: number, title: string): void;
  close(): void;
  closeForGroup(groupId: number): void;
  destroy(): void;
};

export function createTabGroupRenameDialog(
  elements: {
    dialog: HTMLDialogElement;
    form: HTMLFormElement;
    name: HTMLInputElement;
    error: HTMLElement;
    cancel: HTMLButtonElement;
    save: HTMLButtonElement;
  },
  callbacks: {
    onSave(input: { groupId: number; title: string }): Promise<void>;
  },
): TabGroupRenameDialog;
```

复用 `tab-group-dialog` 的 generation/session 模式。提交使用 `elements.name.value.trim()`；catch 使用 Error.message 或“无法重命名标签组”；失败不关闭和不覆盖输入。

- [ ] **Step 5：添加标记和紧凑 CSS**

将上述 dialog 追加在现有创建分组 dialog 之后。CSS 与创建分组弹窗共用宽度、微软雅黑、header、label、32px 输入、错误区和按钮样式；仅新增 name-only form 的 grid/gap 规则。180px 媒体查询必须把弹窗限制在 `calc(100vw - 8px)`，不得产生横向滚动。

- [ ] **Step 6：运行测试并提交**

Run: `npm test -- --run tests/tab-group-rename-dialog.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Run: `npm run typecheck`

Expected: PASS，失败会话可重试，旧 promise 不污染新会话。

提交前读取 Git 提交规则，只暂存本任务六个文件，提交消息使用：`yyyyMMddHHmmss feat 新增标签组重命名弹窗`。

### Task 4：分组管理动作层

**Files:**
- Modify: `src/sidepanel/tab-group-actions.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：扩展动作 API fixture 并写红灯测试**

让测试 fixture 向 `createTabGroupActions()` 传入 `{ create, group, ungroup }`。覆盖：

```ts
await actions.createTabInGroup({ groupId: 7, windowId: 10, index: 6 });
expect(create).toHaveBeenCalledWith({ windowId: 10, index: 6, active: true });
expect(group).toHaveBeenCalledWith({ tabIds: 999, groupId: 7 });

await actions.rename(7, "Renamed");
expect(update).toHaveBeenCalledWith(7, { title: "Renamed" });

await actions.setColor(7, "red");
expect(update).toHaveBeenCalledWith(7, { color: "red" });

await actions.dissolve([1, 2, 3]);
expect(ungroup).toHaveBeenCalledOnce();
expect(ungroup).toHaveBeenCalledWith([1, 2, 3]);
```

失败覆盖：create 失败不调用 group；created tab 无 ID 提示“新标签页缺少 ID”；group 失败抛出 `PartialTabGroupAddError`，包含 `tabId`、`partial: true` 和“标签页已创建，但无法加入分组”；rename/color/dissolve 分别映射稳定中文错误；无效 groupId 在 API 前拒绝；空 dissolve 静默返回。

- [ ] **Step 2：运行测试确认失败**

Run: `npm test -- --run tests/tab-group-actions.test.ts`

Expected: FAIL，动作接口没有四项管理能力且 tabs API 未包含 create。

- [ ] **Step 3：实现动作类型和部分失败错误**

扩展构造参数：

```ts
tabs: Pick<typeof chrome.tabs, "create" | "group" | "ungroup">
```

增加：

```ts
export class PartialTabGroupAddError extends Error {
  readonly partial = true;
  constructor(readonly tabId: number, options?: ErrorOptions) {
    super("标签页已创建，但无法加入分组", options);
    this.name = "PartialTabGroupAddError";
  }
}
```

`createTabInGroup()` 先校验 groupId，再调用 create；create 失败时抛出带 cause 的 `Error("无法在分组中新建标签页")`。随后校验返回 tab.id 并调用 group，第二步失败抛出部分失败错误。`rename()`、`setColor()` 各调用一次 `groups.update()`；`dissolve()` 对非空数组只调用一次 `tabs.ungroup()`，调用前把已验证的非空数组收窄为 `[number, ...number[]]`。所有 catch 保留 cause。

- [ ] **Step 4：运行动作测试并提交**

Run: `npm test -- --run tests/tab-group-actions.test.ts`

Run: `npm run typecheck`

Expected: PASS，成功路径 API 次数固定，动作层不接触 Store 或 DOM。

提交前读取 Git 提交规则，只暂存动作和测试，提交消息使用：`yyyyMMddHHmmss feat 新增标签组管理动作`。

### Task 5：Sidebar 菜单互斥、重算与事件同步

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/sidebar.test.ts`
- Modify: `tests/tab-context-menu.test.ts`
- Modify: `tests/helpers/fake-chrome.ts`

- [ ] **Step 1：为标签菜单增加互斥钩子红灯测试**

给 `createTabContextMenu` callbacks 增加可选 `onBeforeOpen?(): void`。测试右键和 `Shift+F10` 每次打开前恰好调用一次；目标无效时不调用；原命令、定位和清理行为不变。

- [ ] **Step 2：扩展 sidebar DOM fixture 和伪 Chrome**

`tests/sidebar.test.ts` 的测试页面加入 Task 3 的六个 rename 元素，并把必需 ID 列表同步更新。`tests/helpers/fake-chrome.ts` 的 `create()` 必须把新 tab 写入 `tabState`，尊重 `windowId/index/active` 并返回稳定 ID；`groupUpdate()`、`groupTabs()`、`ungroup()` 继续修改内部状态，便于重同步断言。暴露 methods 中的 create/group/ungroup/groupUpdate 供测试检查。

- [ ] **Step 3：写入四项分组命令集成红灯测试**

覆盖：

- 右键分组行打开分组菜单并关闭已打开的标签菜单；随后右键标签行反向关闭分组菜单。
- “在分组中新建标签页”执行前从最新 `tabStore.list()` 找出该组最大 index，并传 `index + 1`；新标签激活且加入 groupId。
- create 失败显示“无法在分组中新建标签页”；group 部分失败保留新普通标签、显示部分失败文案并只重同步一次。
- “重命名分组”使用执行时的 `groupStore.get()` 标题打开弹窗；保存 trim 后调用一次 groupUpdate；失败保留弹窗。
- 选择当前颜色不提交；选择新颜色时先重新读取 `groupStore.get(groupId)`，若执行瞬间已经是目标颜色则静默结束，否则调用一次 update，等待 group onUpdated 后整行 dataset/background 变化。
- 解散执行时从最新完整 Store 收集该 group 全部 tab ID，包括 collapsed 分组成员，只调用一次 ungroup；不调用 tabs.remove/move，不弹确认。

- [ ] **Step 4：写入并发、移除和销毁红灯测试**

使用 `groupCommandBusy = new Set<number>()` 的预期行为覆盖：同一 group 命令未完成时不能重复提交，其他 group 可独立执行；菜单可用状态同时检查现有 `groupToggleBusy`，折叠切换期间不能提交管理命令；菜单打开后 group 被删除时菜单关闭并清除边框；rename 打开后 group 被删除时弹窗关闭；scroll/resize/cleanup 关闭两类菜单；cleanup 后迟到成功或失败不更新状态、弹窗或 DOM。

- [ ] **Step 5：运行集成测试确认失败**

Run: `npm test -- --run tests/tab-context-menu.test.ts tests/sidebar.test.ts`

Expected: FAIL，缺少互斥钩子、分组菜单/弹窗实例和命令分支。

- [ ] **Step 6：集成新元素、菜单和弹窗**

扩展 `SidebarElements` 与 `getSidebarElements()`，创建：

```ts
let groupContextMenu: ReturnType<typeof createTabGroupContextMenu> | undefined;

const contextMenu = createTabContextMenu(elementsForMenu, {
  // 保留现有回调
  onBeforeOpen: () => groupContextMenu?.close(),
  onCommand: handleTabContextCommand,
});

groupContextMenu = createTabGroupContextMenu(elementsForMenu, {
  getGroup: (id) => groupStore.get(id),
  isGroupBusy: (id) => groupCommandBusy.has(id) || groupToggleBusy.has(id),
  onBeforeOpen: () => contextMenu.close(),
  onCommand: handleGroupContextCommand,
});
```

创建 rename dialog，`onSave` 在调用 `groupActions.rename()` 前重新检查 group 是否存在；失败时设置 operation 状态、触发一次 `resyncTabsAndGroups()` 并重新抛出供弹窗保留错误。

- [ ] **Step 7：实现执行瞬间重算命令**

新建标签：

```ts
const tabs = tabStore.list().filter((tab) => tab.groupId === groupId);
const group = groupStore.get(groupId);
if (!group || tabs.length === 0) return;
const index = Math.max(...tabs.map((tab) => tab.index)) + 1;
await groupActions.createTabInGroup({ groupId, windowId: group.windowId, index });
```

解散：

```ts
const ids = tabStore.list()
  .filter((tab) => tab.groupId === groupId)
  .map((tab) => tab.id);
if (!groupStore.get(groupId) || ids.length === 0) return;
await groupActions.dissolve(ids);
```

所有命令通过按 groupId 的 busy 包装器执行；包装器开始前同时检查 `groupCommandBusy` 与 `groupToggleBusy`，finally 释放。失败回调只请求一次现有合并重同步。成功后不 patch Store/DOM。group removed handler同时调用 `groupContextMenu?.closeForGroup(groupId)` 和 `groupRenameDialog.closeForGroup(groupId)`。

- [ ] **Step 8：运行专项测试、类型检查并提交**

Run: `npm test -- --run tests/tab-group-context-menu.test.ts tests/tab-group-rename-dialog.test.ts tests/tab-context-menu.test.ts tests/tab-group-actions.test.ts tests/sidebar.test.ts`

Run: `npm run typecheck`

Expected: PASS；`fake-chrome.ts` 的状态变化由 sidebar 集成测试间接覆盖，不把 helper 文件作为独立测试入口。

提交前读取 Git 提交规则，只暂存本任务五个文件，提交消息使用：`yyyyMMddHHmmss feat 集成标签组右键管理`。

### Task 6：全量回归、性能与内存边界

**Files:**
- Modify only if a failing regression requires a scoped fix.

- [ ] **Step 1：运行全部自动化检查**

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Expected: 类型检查、完整 Vitest、构建、dist 审计和标签渲染基准全部通过。

- [ ] **Step 2：审计常驻资源与权限**

Run: `Get-Item 'src\sidepanel\tab-group-context-menu.ts','src\sidepanel\tab-group-rename-dialog.ts' | Select-String -Pattern 'setInterval|setTimeout|chrome\.tabs\.query|chrome\.tabGroups\.query'`

Expected: 无匹配。检查 `manifest.json`，权限仍精确为 `sidePanel,tabs,tabGroups,storage,history,sessions,bookmarks`，没有 `contextMenus` 或主机权限。

- [ ] **Step 3：检查事件与 DOM 清理测试**

Run: `npm test -- --run tests/tab-group-context-menu.test.ts tests/tab-group-rename-dialog.test.ts tests/sidebar.test.ts tests/tab-renderer.test.ts`

Expected: destroy、group removal、scroll、resize 和迟到 promise 测试全部通过；没有新增全局监听器数量或长期成员缓存。

- [ ] **Step 4：提交仅由回归发现的必要修复**

若本任务没有源码变化，不创建空提交。若有修复，先读取 Git 提交规则，只暂存相关文件，提交消息使用：`yyyyMMddHHmmss fix 修复标签组管理回归问题`。

### Task 7：统一升级 0.9.0 与更新发布资料

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `update.log`
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1：先写版本与更新日志红灯测试**

把 `tests/smoke.test.ts` 的版本断言统一改为 `0.9.0`：

```ts
expect(manifest.version).toBe("0.9.0");
expect(packageJson.version).toBe("0.9.0");
expect(packageLock.version).toBe("0.9.0");
expect(packageLock.packages[""].version).toBe("0.9.0");
expect(readme).toContain("release/sidetab-lite-0.9.0.zip");
```

新增更新日志断言：首行是 `0.9.0`，当前版本段包含“关闭其他同类网站标签页”“快速分组同类网站”“标签组右键菜单”“重命名分组”“修改颜色”“解散分组”“20px”“14px”，并说明未新增权限、缓存、轮询或查询。

- [ ] **Step 2：运行 smoke 测试确认版本红灯**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前四处版本仍为 0.8.2，更新日志缺少 0.9.0 段。

- [ ] **Step 3：同步 npm 与 Manifest 版本**

Run: `npm version 0.9.0 --no-git-tag-version`

Expected: `package.json`、`package-lock.json` 和 lockfile 根 package 同步为 0.9.0，不创建 Git tag。

使用 `apply_patch` 把 `manifest.json` 版本改为 `0.9.0`，不得修改权限、CSP 或 minimum Chrome version。

- [ ] **Step 4：更新中文发布资料和 update.log**

README 增加本版标签右键批量操作、分组标题视觉与分组右键管理能力，并把 ZIP 路径改为 `release/sidetab-lite-0.9.0.zip`。商店检查清单同步 0.9.0 文件名，但权限和远程代码说明保持不变。

在 `update.log` 顶部插入完整 0.9.0 段，保留所有旧版本记录；内容明确本版功能、20px/14px 视觉、错误恢复、执行瞬间重算、最少 API 调用和无新增权限/常驻资源。

- [ ] **Step 5：运行发布前检查并提交**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Expected: PASS；发布文件数量不变，没有新增 SVG、源码文件或权限进入 dist。

提交前读取 Git 提交规则，只暂存本任务七个文件，提交消息使用：`yyyyMMddHHmmss feat 发布标签管理功能0.9.0`。

### Task 8：生成 Chrome 安装包与最终验收

**Files:**
- Generated (ignored): `dist/**`
- Generated (ignored): `release/sidetab-lite-0.9.0.zip`

- [ ] **Step 1：执行确定性打包**

Run: `npm run package`

Expected: typecheck、全部测试、build、dist 审计通过，生成 `release/sidetab-lite-0.9.0.zip`；不会删除 release 中旧版本 ZIP。

- [ ] **Step 2：审计 ZIP 内容、权限和版本**

使用 PowerShell `System.IO.Compression.ZipFile` 读取 ZIP，断言条目集合与 `scripts/release-files.mjs` 的 `EXPECTED_FILES` 完全一致；包内 Manifest 为 0.9.0，权限仍为七项既有权限，不含 `contextMenus`、host permissions、source map、`src`、`tests`、`docs`、package 元数据或远程代码。

- [ ] **Step 3：验证打包确定性与哈希**

连续执行两次 `npm run package`，分别运行：

Run: `Get-FileHash 'release\sidetab-lite-0.9.0.zip' -Algorithm SHA256`

Expected: 两次 SHA-256 完全一致。记录最终 ZIP 绝对路径、字节数和哈希。

- [ ] **Step 4：在真实 Chrome 扩展环境验收**

加载 `dist` 后检查：

- 分组标题行 20px、标题 14px、九种整行底色、无颜色圆点。
- 浅色/深色、180px/240px/常规宽度无裁切、重叠或横向滚动。
- 标签菜单两段顺序、浅灰底色、临时蓝色边框和同类网站两项批量命令。
- 分组菜单两段、九色子菜单、重命名失败保留、新标签位置与激活、解散不关闭标签。
- 蓝色分组右键边框仍可辨；滚动、resize、Escape 和目标移除都清理菜单状态。
- DevTools 无未处理异常，任务管理器中反复开关菜单/弹窗后内存不持续增长。

- [ ] **Step 5：最终验证和工作区检查**

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Run: `git status --short`

Expected: 所有受控文件已提交、工作区干净；`dist` 与 release ZIP 由 `.gitignore` 排除；最终安装包可加载且版本为 0.9.0。
