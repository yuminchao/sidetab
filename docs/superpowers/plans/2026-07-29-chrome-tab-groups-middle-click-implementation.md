# Chrome 标签分组与中键关闭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SideTab Lite 中增量同步 Chrome 原生标签分组，提供分组展示、右键分组操作、跨组拖动和中键关闭，并用用户提供的 SVG 优化全宽底部搜索框，发布 0.7.0。

**Architecture:** 标签与分组分别由 `TabStore` 和 `TabGroupStore` 管理，通过纯函数生成联合展示列表；渲染器只消费联合列表。分组 API、事件、菜单、编辑框、拖动和中键关闭各自封装，`sidebar.ts` 负责启动快照、事件缓冲、动作编排与失败重同步。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、`chrome.tabs`、`chrome.tabGroups`、原生 DOM/CSS、Vitest、JSDOM、esbuild。

---

## 文件结构

- `src/sidepanel/tab-group-model.ts`：Chrome 分组到视图模型的转换和颜色常量。
- `src/sidepanel/tab-group-store.ts`：当前窗口分组的增量存储。
- `src/sidepanel/tab-list-model.ts`：标签与分组生成联合展示列表、关闭下方标签计算。
- `src/sidepanel/tab-group-events.ts`：订阅和过滤 `chrome.tabGroups` 事件。
- `src/sidepanel/tab-group-actions.ts`：创建、加入、移出、折叠和失败语义。
- `src/sidepanel/tab-group-dialog.ts`：新建分组编辑框状态和交互。
- `src/sidepanel/tab-middle-click.ts`：中键默认行为抑制和关闭命令分发。
- `src/sidepanel/tab-model.ts`、`tab-store.ts`：增加 `groupId`。
- `src/sidepanel/tab-renderer.ts`：渲染联合列表和分组标题。
- `src/sidepanel/tab-context-menu.ts`：增加分组二级菜单。
- `src/sidepanel/tab-reorder-model.ts`、`tab-drag-controller.ts`、`tab-actions.ts`：跨分组拖动计划与执行。
- `src/sidepanel/sidebar.ts`：集成双快照、双事件流、动作和重同步。
- `src/sidepanel/index.html`、`sidebar.css`：分组编辑框和全宽搜索框。
- `assets/icons/search.svg`、`settings.svg`：清理后的用户 SVG。
- `tests/helpers/fake-chrome.ts`：标签分组假 API 和事件。

### Task 1: 标签 groupId 与分组模型存储

**Files:**
- Create: `src/sidepanel/tab-group-model.ts`
- Create: `src/sidepanel/tab-group-store.ts`
- Create: `tests/tab-group-model.test.ts`
- Create: `tests/tab-group-store.test.ts`
- Modify: `src/sidepanel/tab-model.ts`
- Modify: `src/sidepanel/tab-store.ts`
- Modify: `tests/tab-model.test.ts`
- Modify: `tests/tab-store.test.ts`
- Modify: `tests/helpers/fake-chrome.ts`

- [ ] **Step 1: 写入标签 groupId 和分组转换失败测试**

```ts
expect(toTabViewModel(fakeTab({ groupId: 7 })).groupId).toBe(7);
expect(toTabViewModel(fakeTab({ groupId: undefined })).groupId).toBe(TAB_GROUP_ID_NONE);
expect(toTabGroupViewModel(fakeGroup({ id: 4, title: undefined }))).toEqual({
  id: 4, windowId: 10, title: "", color: "grey", collapsed: false,
});
```

在测试环境中不要依赖全局 `chrome` 常量，生产代码导出 `TAB_GROUP_ID_NONE = -1` 并断言与 Chrome 官方值一致。

- [ ] **Step 2: 运行模型测试确认失败**

Run: `npm test -- --run tests/tab-model.test.ts tests/tab-group-model.test.ts`

Expected: FAIL，缺少 `groupId`、`toTabGroupViewModel` 和 `TAB_GROUP_ID_NONE`。

- [ ] **Step 3: 实现模型**

```ts
export const TAB_GROUP_ID_NONE = -1;
export const TAB_GROUP_COLORS = [
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
] as const satisfies readonly chrome.tabGroups.Color[];

export type TabGroupViewModel = {
  id: number;
  windowId: number;
  title: string;
  color: chrome.tabGroups.Color;
  collapsed: boolean;
};

export function toTabGroupViewModel(group: chrome.tabGroups.TabGroup): TabGroupViewModel {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title?.trim() ?? "",
    color: group.color,
    collapsed: group.collapsed,
  };
}
```

`TabViewModel` 增加 `groupId: number`；`toTabViewModel()` 使用 `tab.groupId ?? TAB_GROUP_ID_NONE`；`TabStore.update()` 仅接受整数 `groupId`。

- [ ] **Step 4: 写入并验证 GroupStore 失败测试**

覆盖 `initialize/list/get/put/remove`、当前窗口过滤、同 ID 替换、返回对象隔离和无效分组忽略。

Run: `npm test -- --run tests/tab-group-store.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 5: 实现 GroupStore**

```ts
export class TabGroupStore {
  private readonly groups = new Map<number, TabGroupViewModel>();

  initialize(groups: readonly chrome.tabGroups.TabGroup[], windowId: number): void;
  list(): TabGroupViewModel[];
  get(id: number): TabGroupViewModel | undefined;
  put(group: chrome.tabGroups.TabGroup, windowId: number): TabGroupViewModel | undefined;
  remove(id: number): boolean;
}
```

`list()` 按 `id` 稳定排序并返回副本；展示顺序由 Task 2 根据标签 index 决定。

- [ ] **Step 6: 运行模型和存储测试**

Run: `npm test -- --run tests/tab-model.test.ts tests/tab-store.test.ts tests/tab-group-model.test.ts tests/tab-group-store.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```text
yyyyMMddHHmmss feat 新增标签分组模型与存储
```

### Task 2: 联合展示列表与关闭下方语义

**Files:**
- Create: `src/sidepanel/tab-list-model.ts`
- Create: `tests/tab-list-model.test.ts`
- Modify: `src/sidepanel/tab-close-model.ts`
- Modify: `tests/tab-close-model.test.ts`

- [ ] **Step 1: 写入联合列表失败测试**

```ts
expect(buildTabListItems(tabs, groups)).toMatchObject([
  { kind: "tab", tab: { id: 1, pinned: true } },
  { kind: "group", group: { id: 7, title: "Work", color: "blue" } },
  { kind: "tab", tab: { id: 2, groupId: 7 } },
  { kind: "tab", tab: { id: 3, groupId: -1 } },
]);
```

增加折叠组不输出子标签、空标题保留空值、缺失分组按未分组展示、未分组标签可夹在分组之间、同组标题只输出一次的用例。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-list-model.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现联合列表纯函数**

```ts
export type TabListItem =
  | { kind: "tab"; tab: TabViewModel }
  | { kind: "group"; group: TabGroupViewModel };

export function buildTabListItems(
  tabs: readonly TabViewModel[], groups: readonly TabGroupViewModel[],
): TabListItem[];
```

算法只做一次 `groups` 映射和一次 tabs 遍历，时间复杂度为 O(T + G)。固定标签先输出；普通标签按 index；第一次遇到有效 groupId 时输出标题；折叠组跳过标签。

- [ ] **Step 4: 锁定关闭下方使用真实标签列表**

`getClosableTabsBelow()` 保持接收完整 `TabViewModel[]`，新增折叠组标签仍被返回的测试。禁止改为消费渲染后的 `TabListItem[]`。

Run: `npm test -- --run tests/tab-close-model.test.ts tests/tab-list-model.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```text
yyyyMMddHHmmss feat 新增标签分组联合列表
```

### Task 3: 分组事件订阅

**Files:**
- Create: `src/sidepanel/tab-group-events.ts`
- Create: `tests/tab-group-events.test.ts`
- Modify: `tests/helpers/fake-chrome.ts`

- [ ] **Step 1: 写入分组事件失败测试**

测试四个事件各注册一个稳定监听器，只转发当前窗口事件，跨窗口移动按 removed/created 处理，重复 unsubscribe 幂等，unsubscribe 后不再调用处理器。

```ts
export type TabGroupEventHandlers = {
  created(group: chrome.tabGroups.TabGroup): void;
  updated(group: chrome.tabGroups.TabGroup): void;
  moved(group: chrome.tabGroups.TabGroup): void;
  removed(groupId: number): void;
};
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-group-events.test.ts`

Expected: FAIL，订阅模块和 fake events 不存在。

- [ ] **Step 3: 扩展 fake Chrome 并实现订阅**

`createFakeChrome()` 增加 `groups` 输入、`tabGroups.query/get/update`、`tabs.group/ungroup` 和四个 `tabGroups` FakeEvent。`subscribeToTabGroupEvents(api, windowId, handlers)` 按 `group.windowId` 过滤；removed 处理器从事件携带的完整 group 提取 ID。

- [ ] **Step 4: 运行测试**

Run: `npm test -- --run tests/tab-group-events.test.ts tests/tab-events.test.ts`

Expected: PASS，原七类标签事件不回归。

- [ ] **Step 5: 提交**

```text
yyyyMMddHHmmss feat 订阅Chrome标签分组事件
```

### Task 4: 分组标题渲染

**Files:**
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写入渲染失败测试**

测试 `render(items)` 生成 `.tab-group-row[data-group-id]`，内部按钮 `data-action="toggle-group"`，包含 `.tab-group-chevron`、`.tab-group-color` 和 `.tab-group-title`。空标题显示“未命名分组”，不显示数量；颜色通过 `data-color`；折叠状态进入 `aria-expanded` 和无障碍名称。

```ts
expect(groupButton.getAttribute("aria-expanded")).toBe("false");
expect(groupTitle.textContent).toBe("未命名分组");
expect(groupRow.querySelector(".tab-group-count")).toBeNull();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts`

Expected: FAIL，渲染器只接受标签。

- [ ] **Step 3: 实现联合渲染器**

将 API 改为：

```ts
export type TabRenderer = {
  render(items: readonly TabListItem[]): void;
  patchTab(tab: TabViewModel): void;
  patchGroup(group: TabGroupViewModel): void;
  removeTab(id: number): void;
  setDragEnabled(enabled: boolean): void;
  destroy(): void;
};
```

保留 favicon 委托错误监听。`patchTab` 和 `patchGroup` 不替换现有行；结构变化由调用方执行 `render()`。

- [ ] **Step 4: 添加紧凑分组样式**

分组行固定 28px 高；按钮全宽无边框；箭头 12px；颜色圆点 8px；标题使用微软雅黑优先并省略溢出。为 9 种 `data-color` 映射 Chrome 接近色，深色模式通过 `color-scheme` 保持可见。分组标题不得产生正最小宽度。

- [ ] **Step 5: 运行渲染与 CSS 测试**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts`

Expected: PASS，包括 100 标签节点复用基线。

- [ ] **Step 6: 提交**

```text
yyyyMMddHHmmss feat 展示Chrome标签分组标题
```

### Task 5: 分组动作层

**Files:**
- Create: `src/sidepanel/tab-group-actions.ts`
- Create: `tests/tab-group-actions.test.ts`

- [ ] **Step 1: 写入动作失败测试**

测试：

```ts
await actions.create({ tabId: 3, windowId: 10, title: "Work", color: "blue" });
expect(tabs.group).toHaveBeenCalledWith({ tabIds: 3, createProperties: { windowId: 10 } });
expect(groups.update).toHaveBeenCalledWith(7, { title: "Work", color: "blue" });

await actions.add(3, 8);
expect(tabs.group).toHaveBeenCalledWith({ tabIds: 3, groupId: 8 });
await actions.remove(3);
expect(tabs.ungroup).toHaveBeenCalledWith(3);
await actions.setCollapsed(8, true);
expect(groups.update).toHaveBeenCalledWith(8, { collapsed: true });
```

覆盖每个 API 拒绝的中文错误；元数据更新失败的错误对象必须带 `groupId` 和 `partial: true`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-group-actions.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现动作层**

```ts
export class PartialTabGroupCreationError extends Error {
  readonly partial = true;
  constructor(readonly groupId: number) { super("分组已创建，但无法保存名称或颜色"); }
}

export function createTabGroupActions(
  tabs: Pick<typeof chrome.tabs, "group" | "ungroup">,
  groups: Pick<typeof chrome.tabGroups, "update">,
): {
  create(input: { tabId: number; windowId: number; title: string; color: chrome.tabGroups.Color }): Promise<number>;
  updateCreated(groupId: number, title: string, color: chrome.tabGroups.Color): Promise<void>;
  add(tabId: number, groupId: number): Promise<void>;
  remove(tabId: number): Promise<void>;
  setCollapsed(groupId: number, collapsed: boolean): Promise<void>;
};
```

- [ ] **Step 4: 运行动作测试**

Run: `npm test -- --run tests/tab-group-actions.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```text
yyyyMMddHHmmss feat 封装标签分组操作
```

### Task 6: 二级右键菜单

**Files:**
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/tab-context-menu.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 扩展命令类型并写失败测试**

```ts
type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean }
  | { action: "add-shortcut"; tabId: number }
  | { action: "close-below"; tabId: number }
  | { action: "create-group"; tabId: number }
  | { action: "add-to-group"; tabId: number; groupId: number }
  | { action: "remove-from-group"; tabId: number };
```

测试“添加到分组”一级项、动态二级菜单、9 色中的组颜色圆点、空名显示“未命名分组”、当前组 `aria-checked="true"` 且禁用、未分组标签不显示移出项、分组标签显示移出项。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，菜单仍为扁平结构。

- [ ] **Step 3: 实现动态二级菜单**

回调增加：

```ts
getGroups(): readonly TabGroupViewModel[];
```

一级按钮使用 `aria-haspopup="menu"` 与 `aria-expanded`。二级菜单每次打开根据 `getGroups()` 重建，第一项固定为“新建分组”。动态按钮存储 `data-group-id`，不闭包保存过期分组对象。

- [ ] **Step 4: 实现定位和键盘测试**

覆盖 hover/click 打开、ArrowRight 进入、ArrowLeft 返回、上下循环、Escape 关闭、窗口右侧不足向左展开、底部不足向上收敛、滚动/resize/外点/销毁同时关闭两层菜单。

- [ ] **Step 5: 实现二级菜单样式和行为**

二级菜单复用 `.tab-context-menu` 字体和状态样式，增加 `.tab-context-submenu`、`.group-menu-color`、选中标记和展开箭头。两层菜单均使用固定定位，菜单内部不嵌套卡片。

- [ ] **Step 6: 运行测试**

Run: `npm test -- --run tests/tab-context-menu.test.ts tests/sidepanel-css.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```text
yyyyMMddHHmmss feat 新增标签分组右键菜单
```

### Task 7: 新建分组编辑框

**Files:**
- Create: `src/sidepanel/tab-group-dialog.ts`
- Create: `tests/tab-group-dialog.test.ts`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-markup.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写入标记和控制器失败测试**

HTML 增加独立 `#tab-group-dialog`，包含 `#tab-group-name`、9 个 `input[type=radio][name=tab-group-color]`、`#tab-group-error`、取消和创建按钮。测试默认灰色、名称允许空、打开时隔离 draft、重复提交去重、取消、Escape、成功关闭、失败保留输入和销毁后迟到结果无 DOM 写入。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-group-dialog.test.ts tests/sidepanel-markup.test.ts`

Expected: FAIL，缺少模块和标记。

- [ ] **Step 3: 实现控制器**

```ts
export type TabGroupDraft = {
  tabId: number;
  windowId: number;
  title: string;
  color: chrome.tabGroups.Color;
  createdGroupId?: number;
};

export function createTabGroupDialog(elements, callbacks): {
  open(tabId: number, windowId: number): void;
  close(): void;
  destroy(): void;
};
```

首次提交调用 `callbacks.onCreate(draft)`；部分失败保存 `createdGroupId`，再次提交调用 `callbacks.onUpdateCreated(draft)`，不得再次创建分组。

- [ ] **Step 4: 实现色板与紧凑对话框样式**

色板使用圆形 swatch 和真实 radio；颜色选择不使用文字按钮。对话框最大宽 300px，并在 180px 宽度下使用 `calc(100vw - 8px)`。所有文字使用微软雅黑优先，错误区域复用现有警示色。

- [ ] **Step 5: 运行测试**

Run: `npm test -- --run tests/tab-group-dialog.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```text
yyyyMMddHHmmss feat 新增标签分组编辑框
```

### Task 8: 跨分组拖动计划与执行

**Files:**
- Modify: `src/sidepanel/tab-reorder-model.ts`
- Modify: `src/sidepanel/tab-drag-controller.ts`
- Modify: `src/sidepanel/tab-actions.ts`
- Modify: `tests/tab-reorder-model.test.ts`
- Modify: `tests/tab-drag-controller.test.ts`
- Modify: `tests/tab-actions.test.ts`

- [ ] **Step 1: 写入拖动意图失败测试**

```ts
export type TabDropTarget =
  | { kind: "tab"; tabId: number; placement: "before" | "after" }
  | { kind: "group"; groupId: number };
export type TabDropIntent = { sourceId: number; target: TabDropTarget };
```

测试分组标题只能作为目标不能作为源；折叠标题可接收 drop；关闭按钮不能启动拖动；插入线只出现在标签行，分组标题使用 `data-drop-target="true"`。

- [ ] **Step 2: 写入重排计划失败测试**

`TabReorderPlan` 增加 `sourceGroupId`、`targetGroupId`、`groupChanged`。覆盖：同组排序、跨组、拖到组标题末尾、移出到未分组、固定转分组、分组转固定、无变化返回 undefined。

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- --run tests/tab-drag-controller.test.ts tests/tab-reorder-model.test.ts`

Expected: FAIL，旧意图和计划不含 groupId。

- [ ] **Step 4: 实现拖动意图与纯计划**

```ts
export type TabReorderPlan = {
  tabId: number;
  targetIndex: number;
  targetPinned: boolean;
  pinnedChanged: boolean;
  sourceGroupId: number;
  targetGroupId: number;
  groupChanged: boolean;
};
```

目标为组标题时，从完整 Chrome 顺序找到该组最后一个标签，删除源标签后计算末尾插入 index。目标为标签时继承目标 pinned/groupId。

- [ ] **Step 5: 写入动作执行顺序失败测试**

扩展 `TabsActionApi` 为 `update/move/group/ungroup`。断言：固定转分组执行 unpin → group → move；分组转固定执行 ungroup → pin → move；跨组执行 group → move；移出执行 ungroup → move；同组只 move。

- [ ] **Step 6: 实现重排动作**

动作层只执行计划，不修改 store；任何 API 失败抛出明确移动错误，由 sidebar 触发快照恢复。

- [ ] **Step 7: 运行测试**

Run: `npm test -- --run tests/tab-drag-controller.test.ts tests/tab-reorder-model.test.ts tests/tab-actions.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```text
yyyyMMddHHmmss feat 支持标签跨分组拖动
```

### Task 9: 鼠标中键关闭

**Files:**
- Create: `src/sidepanel/tab-middle-click.ts`
- Create: `tests/tab-middle-click.test.ts`

- [ ] **Step 1: 写入失败测试**

测试中键命中 `.tab-row[data-tab-id]` 时 `mousedown.preventDefault()`，随后 `auxclick` 只调用一次 `onClose(tabId)`；左键、右键、分组标题、空白、新建按钮和列表外目标不处理；destroy 后不处理。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-middle-click.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现委托控制器**

```ts
export function createTabMiddleClickController(
  { list }: { list: HTMLElement },
  { onClose }: { onClose(tabId: number): void },
): { destroy(): void };
```

两个事件均要求 `event.button === 1`，通过 `closest(".tab-row[data-tab-id]")` 查找标签；`auxclick` 同时 `preventDefault()` 和 `stopPropagation()`。

- [ ] **Step 4: 运行测试并提交**

Run: `npm test -- --run tests/tab-middle-click.test.ts`

Expected: PASS。

Commit: `yyyyMMddHHmmss feat 支持中键关闭标签页`

### Task 10: Sidebar 双快照、事件缓冲与动作集成

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`
- Modify: `tests/helpers/fake-chrome.ts`

- [ ] **Step 1: 写入启动与依赖失败测试**

`SidebarDependencies` 增加 `tabGroups: typeof chrome.tabGroups`。测试当前窗口确定后先注册 tabs/group 监听，再并发调用：

```ts
tabs.query({ windowId });
tabGroups.query({ windowId });
```

快照未完成期间发出的标签和分组事件必须在快照后按接收顺序应用。分组查询失败时标签仍展示并显示“无法读取当前窗口的标签分组”。

- [ ] **Step 2: 运行集成测试确认失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，缺少 tabGroups 依赖和分组渲染。

- [ ] **Step 3: 集成 stores、联合列表和事件**

新增 `renderTabList()`：

```ts
const renderTabList = () => {
  tabRenderer.render(buildTabListItems(tabStore.list(), groupStore.list()));
};
```

分组折叠、创建、移动、删除及标签 groupId/index 变化调用联合渲染；仅标题元数据变化且结构不变时 `patchGroup()`；普通标题/favicon/active 变化使用 `patchTab()`。

- [ ] **Step 4: 集成右键和分组编辑框**

`getGroups()` 返回 `groupStore.list()`。命令映射：create-group 打开编辑框；add/remove 调用 `TabGroupActions`；toggle-group 从当前 store 读取反向 collapsed。部分创建失败把 `groupId` 交回 dialog，普通失败写状态栏。

- [ ] **Step 5: 集成拖动、中键与失败重同步**

实现单航班 `resyncTabsAndGroups()`，并发查询当前窗口标签和分组，成功后一次替换两个 store 和一次渲染。分组动作或跨组拖动失败时调用一次重同步，不循环重试。中键控制器调用 `tabActions.close()`。

- [ ] **Step 6: 扩展竞态、失败和清理测试**

覆盖迟到快照、缓冲 created/updated/moved/removed、部分创建重试、重复操作去重、重同步失败、页面清理注销 7 个 tabs 事件、4 个 group 事件、菜单、dialog、drag 和 middle-click。

- [ ] **Step 7: 运行集成测试**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-events.test.ts tests/tab-group-events.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```text
yyyyMMddHHmmss feat 集成Chrome标签分组交互
```

### Task 11: 全宽搜索框与用户 SVG

**Files:**
- Create: `assets/icons/search.svg`
- Create: `assets/icons/settings.svg`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/assets.test.ts`
- Modify: `tests/sidepanel-markup.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写入 SVG 安全失败测试**

读取两个目标 SVG，断言包含 `viewBox` 和 `<path`，且不包含 `DOCTYPE`、`script`、`onload=`、`href=`、`xlink`、`http://`、`https://`、固定 `width=`、`height=`、`p-id` 或生成器时间属性。

- [ ] **Step 2: 运行资产测试确认失败**

Run: `npm test -- --run tests/assets.test.ts`

Expected: FAIL，目标 SVG 不存在。

- [ ] **Step 3: 创建清理后的本地图标**

`search.svg` 使用原文件 `viewBox="0 0 1024 1024"` 和唯一 path；`settings.svg` 使用 `viewBox="0 0 1065 1024"` 和唯一 path。文件结构统一为：

```svg
<svg viewBox="..." xmlns="http://www.w3.org/2000/svg"><path d="..."/></svg>
```

- [ ] **Step 4: 写入全宽搜索标记和 CSS 失败测试**

HTML 目标结构：

```html
<footer class="bottom-toolbar">
  <div id="history-search-results" role="listbox" hidden></div>
  <div class="search-shell">
    <span class="search-icon" aria-hidden="true"></span>
    <input id="tab-search" type="search" />
    <button id="shortcut-settings" class="icon-button" type="button" title="设置" aria-label="设置">
      <span class="settings-icon" aria-hidden="true"></span>
    </button>
  </div>
</footer>
```

CSS 测试锁定单列全宽、左右绝对定位、search 16px、settings 18px/32px 点击区、input 左右 padding、`::-webkit-search-cancel-button { appearance: none; }`、结果框 `left: 6px; right: 6px`。

历史搜索测试增加 Escape 关闭结果并保留输入内容的断言，防止隐藏原生清除按钮后误改键盘行为。

- [ ] **Step 5: 实现标记和样式**

两个图标用 `mask: url("../assets/icons/*.svg") center / contain no-repeat` 和 `background-color: currentColor`。`.search-shell` 宽 100%、高 32px、position relative；设置按钮定位到右侧且无按钮外框；输入框 `padding-inline: 32px 38px`。

- [ ] **Step 6: 运行资产、标记和 CSS 测试**

Run: `npm test -- --run tests/assets.test.ts tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```text
yyyyMMddHHmmss feat 优化底部搜索框图标布局
```

### Task 12: 权限、发布资源与 0.7.0

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `scripts/release-files.mjs`
- Modify: `scripts/check-dist.mjs`
- Modify: `tests/smoke.test.ts`
- Modify: `tests/release-scripts.test.ts`

- [ ] **Step 1: 写入权限、版本和发布文件失败测试**

将冒烟测试期望更新为 `0.7.0` 和：

```ts
expect(manifest.permissions).toEqual([
  "sidePanel", "tabs", "tabGroups", "storage", "history",
]);
```

发布文件精确列表增加 `assets/icons/search.svg`、`assets/icons/settings.svg`，总数从 11 改为 13。dist 检查必须读取 SVG 并执行与资产测试相同的禁止项验证。

- [ ] **Step 2: 运行发布测试确认失败**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: FAIL，仍为 0.6.1、缺少权限和 SVG allowlist。

- [ ] **Step 3: 更新权限、版本、发布脚本和文档**

同步 `manifest.json`、package 两文件、README ZIP 名称和商店检查清单。`check-dist.mjs` 权限精确值改为包含 `tabGroups`；`release-files.mjs` 增加两个 SVG；检查清单改为 13 个文件。

- [ ] **Step 4: 运行发布测试**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```text
yyyyMMddHHmmss feat 发布标签分组功能0.7.0
```

### Task 13: 完整验证、视觉检查与打包

**Files:**
- Generated: `dist/**`
- Generated: `release/sidetab-lite-0.7.0.zip`

- [ ] **Step 1: 运行完整打包流程**

Run: `npm run package`

Expected: TypeScript 类型检查、全部 Vitest 文件、esbuild、dist 审计通过，并生成 `release/sidetab-lite-0.7.0.zip`。

- [ ] **Step 2: 在真实 Chrome 扩展环境检查交互**

加载 `dist` 后验证：已有分组名称/颜色/折叠同步；新建、加入、移出；跨组和固定区拖动；折叠组 drop；中键关闭；右键二级菜单键盘操作；180px、240px 和常规宽度搜索框不溢出。开发者工具不得出现未处理异常。

- [ ] **Step 3: 审计 ZIP**

确认 manifest 版本 `0.7.0`，权限为 `sidePanel,tabs,tabGroups,storage,history`，ZIP 精确 13 个文件，不含 `src`、`tests`、`docs`、`node_modules`、source map 和 package 元数据；记录 SHA-256。

- [ ] **Step 4: 检查工作区并提交必要修复**

Run: `git status --short && git diff --check`

Expected: 源码与测试提交完成，`dist` 和 `release` 仍由 `.gitignore` 排除，工作区干净。
