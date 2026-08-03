# 搜索来源标签、连续分组容器与分组拖动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为搜索结果增加来源胶囊，把展开标签组渲染为连续同色圆角容器，并支持通过一次 `chrome.tabGroups.move()` 整体拖动标签组，最终发布 `0.10.0` 安装包。

**Architecture:** 搜索来源直接使用现有 `SearchResult.source`；列表模型在 O(n) 构建过程中为组内 Tab 附加短生命周期装饰数据，渲染器只 patch dataset 和 CSS。分组拖动使用独立纯计划模型与有判别字段的拖动意图，Sidebar 在 drop 执行瞬间从 Store 重算目标并调用动作层，成功后仍依赖 Chrome 事件同步。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM/CSS、Chrome tabs/tabGroups API、Vitest、jsdom、esbuild、Node.js、PowerShell。

---

## 前置条件

- 在隔离工作树 `E:\java\sidebar\.worktrees\feature-side-panel-tabs` 中执行。
- 设计依据：`docs/superpowers/specs/2026-08-03-search-source-group-container-drag-design.md`。
- 每次提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`。
- 设计和发布文档必须使用中文。
- 只有 Task 8 可以执行正式打包；正式打包必须升级版本并更新 `E:\java\sidebar\update.log`。

## 文件结构

- Modify: `src/sidepanel/history-search.ts`：渲染来源胶囊。
- Modify: `src/sidepanel/tab-list-model.ts`：计算组内 Tab 的颜色与首/中/末位置。
- Modify: `src/sidepanel/tab-renderer.ts`：把短生命周期分组装饰写入或清理 dataset。
- Create: `src/sidepanel/tab-group-reorder-model.ts`：纯函数计算整体分组移动计划。
- Modify: `src/sidepanel/tab-group-actions.ts`：封装单次 `chrome.tabGroups.move()`。
- Modify: `src/sidepanel/tab-drag-controller.ts`：区分标签与分组拖动源，生成对应 drop 意图并清理反馈。
- Modify: `src/sidepanel/sidebar.ts`：执行瞬间重算、busy 互斥、失败重同步和销毁保护。
- Modify: `src/sidepanel/sidebar.css`：来源胶囊、连续分组容器和分组拖动反馈。
- Modify: `tests/helpers/fake-chrome.ts`：实现有状态 `tabGroups.move()` fixture。
- Modify: `tests/history-search.test.ts`、`tests/tab-list-model.test.ts`、`tests/tab-renderer.test.ts`、`tests/tab-group-actions.test.ts`、`tests/tab-drag-controller.test.ts`、`tests/sidebar.test.ts`、`tests/sidepanel-css.test.ts`。
- Create: `tests/tab-group-reorder-model.test.ts`。
- Modify: `manifest.json`、`package.json`、`package-lock.json`、`README.md`、`docs/chrome-web-store-checklist.md`、`update.log`、`tests/smoke.test.ts`：统一发布 `0.10.0`。

### Task 1：搜索结果来源胶囊

**Files:**
- Modify: `src/sidepanel/history-search.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/history-search.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：先写来源 DOM 红灯测试**

在 `tests/history-search.test.ts` 的最近历史和混合搜索场景中增加断言：

```ts
const sources = Array.from(
  results.querySelectorAll<HTMLElement>(".history-search-source"),
  (element) => ({ text: element.textContent, source: element.dataset.source }),
);
expect(sources.slice(0, 6)).toEqual([
  { text: "收藏夹", source: "bookmark" },
  { text: "收藏夹", source: "bookmark" },
  { text: "收藏夹", source: "bookmark" },
  { text: "收藏夹", source: "bookmark" },
  { text: "收藏夹", source: "bookmark" },
  { text: "历史记录", source: "history" },
]);
```

空查询场景断言只有历史来源：

```ts
expect(option.querySelector(".history-search-source")?.textContent).toBe("历史记录");
expect(option.querySelector<HTMLElement>(".history-search-source")?.dataset.source).toBe("history");
```

- [ ] **Step 2：先写三列布局和两种胶囊 CSS 红灯测试**

在 `tests/sidepanel-css.test.ts` 锁定：

```ts
expect(css).toMatch(
  /\.history-search-option\s*{[^}]*grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)\s+auto/s,
);
expect(css).toMatch(
  /\.history-search-source\s*{[^}]*height:\s*18px[^}]*padding:\s*0\s+6px[^}]*border-radius:\s*9px[^}]*font-size:\s*11px/s,
);
expect(css).toMatch(/\.history-search-source\[data-source="bookmark"\]\s*{[^}]*background:[^}]*color:/s);
expect(css).toMatch(/\.history-search-source\[data-source="history"\]\s*{[^}]*background:[^}]*color:/s);
```

同时断言 `.history-search-title` 仍有 `min-width: 0` 和省略规则，来源胶囊包含 `white-space: nowrap` 与 `flex-shrink: 0` 等等价不压缩约束。

- [ ] **Step 3：运行测试确认红灯**

Run: `npm test -- --run tests/history-search.test.ts tests/sidepanel-css.test.ts`

Expected: FAIL，当前结果行只有 favicon 与标题两列，没有 `.history-search-source`。

- [ ] **Step 4：实现最小 DOM 与 CSS**

在 `createOption()` 追加静态来源 span：

```ts
const source = elements.document.createElement("span");
source.className = "history-search-source";
source.dataset.source = item.source;
source.textContent = item.source === "bookmark" ? "收藏夹" : "历史记录";
option.append(title, source);
```

CSS 使用自适应系统色混合，不新增图片或监听器：

```css
.history-search-option {
  grid-template-columns: 16px minmax(0, 1fr) auto;
}

.history-search-source {
  display: inline-grid;
  place-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.history-search-source[data-source="bookmark"] {
  background: color-mix(in srgb, #1a73e8 14%, Canvas);
  color: #1558b0;
}

.history-search-source[data-source="history"] {
  background: color-mix(in srgb, CanvasText 9%, Canvas);
  color: GrayText;
}
```

- [ ] **Step 5：验证并提交**

Run: `npm test -- --run tests/history-search.test.ts tests/sidepanel-css.test.ts`

Run: `npm run typecheck`

Expected: PASS；空查询不调用 bookmarks，混合结果数量和顺序不变。

提交前只暂存本任务四个文件，提交消息：`yyyyMMddHHmmss feat 新增搜索结果来源标签`。

### Task 2：组内 Tab 装饰模型与连续圆角边框

**Files:**
- Modify: `src/sidepanel/tab-list-model.ts`
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/tab-list-model.test.ts`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：定义预期装饰类型并写列表模型红灯测试**

测试按以下公共类型断言输出：

```ts
export type TabGroupDecoration = {
  groupId: number;
  color: TabGroupColor;
  position: "first" | "middle" | "last" | "single";
};

export type TabListItem =
  | { kind: "tab"; tab: TabViewModel; group?: TabGroupDecoration }
  | { kind: "group"; group: TabGroupViewModel };
```

测试三个成员：

```ts
expect(items.filter((item) => item.kind === "tab").map((item) => item.group)).toEqual([
  { groupId: 7, color: "blue", position: "first" },
  { groupId: 7, color: "blue", position: "middle" },
  { groupId: 7, color: "blue", position: "last" },
]);
```

另写单成员 `single`、折叠组无成员、未分组/固定 Tab 的 `group === undefined`、两个相邻分组各自独立计数和 500 标签线性读取测试。

- [ ] **Step 2：运行列表模型测试确认红灯**

Run: `npm test -- --run tests/tab-list-model.test.ts`

Expected: FAIL，`TabListItem` 尚无 `group` 装饰。

- [ ] **Step 3：用两次线性遍历实现装饰计算**

在排序后先统计展开组成员数量，再在现有构建遍历中维护 ordinal：

```ts
const memberCounts = new Map<number, number>();
for (const tab of orderedTabs) {
  const group = groupsById.get(tab.groupId);
  if (!tab.pinned && group && !group.collapsed) {
    memberCounts.set(group.id, (memberCounts.get(group.id) ?? 0) + 1);
  }
}

const emittedMembers = new Map<number, number>();
const memberIndex = emittedMembers.get(group.id) ?? 0;
const memberCount = memberCounts.get(group.id) ?? 0;
const position = memberCount === 1
  ? "single"
  : memberIndex === 0
    ? "first"
    : memberIndex === memberCount - 1
      ? "last"
      : "middle";
emittedMembers.set(group.id, memberIndex + 1);
items.push({
  kind: "tab",
  tab,
  group: { groupId: group.id, color: group.color, position },
});
```

不得在成员循环中使用 `tabs.filter()` 或为每个 Tab 扫描完整数组。

- [ ] **Step 4：写渲染器 dataset 红灯测试**

覆盖创建、patch、离组清理和节点复用：

```ts
expect(row.dataset).toMatchObject({
  groupId: "7",
  groupColor: "blue",
  groupPosition: "first",
});

renderer.render([{ kind: "tab", tab: movedTab }]);
expect(row.hasAttribute("data-group-id")).toBe(false);
expect(row.hasAttribute("data-group-color")).toBe(false);
expect(row.hasAttribute("data-group-position")).toBe(false);
expect(list.firstElementChild).toBe(row);
```

- [ ] **Step 5：实现渲染器最小 patch**

让 `updateTabRow()` 接收可选装饰并集中同步：

```ts
function updateGroupDecoration(
  row: HTMLElement,
  group: TabGroupDecoration | undefined,
): void {
  if (!group) {
    delete row.dataset.groupId;
    delete row.dataset.groupColor;
    delete row.dataset.groupPosition;
    return;
  }
  row.dataset.groupId = String(group.groupId);
  row.dataset.groupColor = group.color;
  row.dataset.groupPosition = group.position;
}
```

`render()` 传入 `preparedRow.item.group`，并且只有完整 `render(items)` 负责同步或清理分组装饰。`patchTab(tab)` 只更新标题、图标、激活态等 Tab 自身状态，必须保留该行现有的三个分组 dataset；结构性变化（`index`、`groupId`、`pinned`）继续走 Sidebar 既有的 `renderTabList()` 路径。测试必须同时锁定：`patchTab()` 保留当前装饰，随后 `render([{ kind: "tab", tab: movedTab }])` 清除离组后的全部装饰。

- [ ] **Step 6：写并实现连续容器 CSS**

测试锁定 8px 标题圆角、2px 边框、末行底边以及九色映射。实现建议：

```css
.tab-group-main {
  border-radius: 8px;
}

.tab-group-row[data-collapsed="false"] .tab-group-main {
  border-radius: 8px 8px 0 0;
}

.tab-row[data-group-id] {
  border-inline: 2px solid var(--member-group-color);
}

.tab-row[data-group-position="last"],
.tab-row[data-group-position="single"] {
  border-bottom: 2px solid var(--member-group-color);
  border-radius: 0 0 8px 8px;
}
```

为九种 `[data-group-color]` 设置 `--member-group-color`，与标题行当前浅色/深色映射完全一致。普通 `.tab-row` 高度仍为 `var(--tab-row-height)`；边框使用全局 `box-sizing: border-box`，不得增加布局高度。

标题自动对比色保持既定规则，不强制全部白字。强制色模式把成员边框映射为 `CanvasText` 或 `Highlight`，保证可见性。

- [ ] **Step 7：验证并提交**

Run: `npm test -- --run tests/tab-list-model.test.ts tests/tab-renderer.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts`

Run: `npm run typecheck`

Expected: PASS；500 行节点复用测试通过，普通标签无分组 dataset 残留。

提交前只暂存本任务六个文件，提交消息：`yyyyMMddHHmmss feat 优化标签组连续容器样式`。

### Task 3：分组整体重排纯模型与动作层

**Files:**
- Create: `src/sidepanel/tab-group-reorder-model.ts`
- Modify: `src/sidepanel/tab-group-actions.ts`
- Create: `tests/tab-group-reorder-model.test.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：写纯模型类型和行为红灯测试**

计划接口固定为：

```ts
export type GroupDropTarget =
  | { kind: "tab"; tabId: number; placement: "before" | "after" }
  | { kind: "group"; groupId: number; placement: "before" | "after" };

export type TabGroupReorderPlan = {
  groupId: number;
  targetIndex: number;
  windowId: number;
};

export function createTabGroupReorderPlan(
  tabs: readonly TabViewModel[],
  groups: readonly TabGroupViewModel[],
  sourceGroupId: number,
  target: GroupDropTarget,
): TabGroupReorderPlan | undefined;
```

至少覆盖：源组从目标前移到目标后、从后移到前、目标为未分组 Tab、目标为另组成员时归一化到完整目标组、折叠组、固定 Tab、跨窗口、源组成员、无成员、缺失目标和 no-op。

- [ ] **Step 2：加入 500 标签线性边界红灯测试**

使用 Proxy 统计数组索引读取，允许常数次完整遍历，不允许按成员数重复扫描：

```ts
expect(plan).toEqual({ groupId: 7, targetIndex: 500, windowId: 10 });
expect(indexReads).toBeLessThan(4000);
```

- [ ] **Step 3：运行模型测试确认模块缺失**

Run: `npm test -- --run tests/tab-group-reorder-model.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4：实现一次排序和线性块边界计算**

实现必须先按 `windowId/index/id` 构造同窗口有序标签，收集源成员 ID，并把目标归一化为未分组单 Tab 或目标分组完整成员块。删除源块后计算插入位置：

```ts
const insertionIndex = target.placement === "before"
  ? targetStartInRemaining
  : targetEndInRemaining + 1;

if (insertionIndex === sourceStartIndex) return undefined;
return { groupId: sourceGroupId, targetIndex: insertionIndex, windowId: source.windowId };
```

目标为 pinned、其他窗口、源组或源成员时返回 `undefined`。不要返回或缓存成员 ID 数组。

- [ ] **Step 5：写动作层红灯测试**

把 `createTabGroupActions()` 的 group API 扩为 `Pick<typeof chrome.tabGroups, "move" | "update">`，并断言：

```ts
await actions.move({ groupId: 7, targetIndex: 4, windowId: 10 });
expect(groupMove).toHaveBeenCalledOnce();
expect(groupMove).toHaveBeenCalledWith(7, { index: 4, windowId: 10 });
```

无效 groupId 在 API 前拒绝；API 失败抛出带 cause 的 `Error("无法移动标签组")`。

- [ ] **Step 6：实现单次 group move**

动作接口增加：

```ts
move(plan: TabGroupReorderPlan): Promise<void>;
```

实现：

```ts
async move(plan): Promise<void> {
  assertValidTabGroupId(plan.groupId);
  try {
    await groups.move(plan.groupId, {
      index: plan.targetIndex,
      windowId: plan.windowId,
    });
  } catch (cause) {
    throw new Error("无法移动标签组", { cause });
  }
}
```

- [ ] **Step 7：验证并提交**

Run: `npm test -- --run tests/tab-group-reorder-model.test.ts tests/tab-group-actions.test.ts`

Run: `npm run typecheck`

Expected: PASS；动作层不接触 Store、DOM 或 Chrome query。

提交前只暂存本任务四个文件，提交消息：`yyyyMMddHHmmss feat 新增标签组整体重排模型`。

### Task 4：拖动控制器支持分组源与块级目标

**Files:**
- Modify: `src/sidepanel/tab-drag-controller.ts`
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/tab-drag-controller.test.ts`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：写有判别拖动意图红灯测试**

把公开意图固定为联合类型：

```ts
export type TabDragIntent =
  | { kind: "tab"; sourceId: number; target: TabDropTarget }
  | { kind: "group"; sourceGroupId: number; target: GroupDropTarget };
```

新增 fixture：两个展开组、一个折叠组、未分组 Tab 和固定 Tab。拖动分组标题到另一组上/下半区分别断言：

```ts
expect(onDrop).toHaveBeenCalledWith({
  kind: "group",
  sourceGroupId: 7,
  target: { kind: "group", groupId: 8, placement: "after" },
});
```

拖到目标组成员时仍派发目标 `groupId: 8`，不得派发普通 tab 目标或合并命令。

- [ ] **Step 2：写拒绝与清理红灯测试**

覆盖固定 Tab、源组标题/成员、无效 ID、源移除、目标移除、dragend、drop、dragleave、真实父滚动容器、resize、cancel 和 destroy。所有路径最终：

```ts
expect(list.querySelector("[data-drag-source], [data-drop-placement], [data-drop-target]")).toBeNull();
```

并断言单标签拖动现有 `TabDropTarget` 语义不变。

- [ ] **Step 3：让 group row 可拖动并写红灯测试**

`tab-renderer` 的 `setDragEnabled()` 必须同时更新 group rows。测试：

```ts
expect(groupRow.draggable).toBe(true);
renderer.setDragEnabled(false);
expect(groupRow.draggable).toBe(false);
expect(tabRow.draggable).toBe(false);
```

不得把 `.tab-group-main` 设为单独 draggable；拖动源仍是 `.tab-group-row`。

- [ ] **Step 4：实现 source 联合类型和目标归一化**

把控制器构造接口固定为：

```ts
export function createTabDragController(
  { list, viewport }: { list: HTMLElement; viewport: Window },
  {
    canStartGroupDrag = () => true,
    onDrop,
  }: {
    canStartGroupDrag?(groupId: number): boolean;
    onDrop(intent: TabDragIntent): void;
  },
): TabDragController;
```

分组标题触发 `dragstart` 时先调用 `canStartGroupDrag(groupId)`；返回 `false` 时阻止拖动、清理反馈且不产生 drop intent。对应测试覆盖允许和拒绝两条路径。

控制器内部只保存：

```ts
type ActiveSource =
  | { kind: "tab"; id: number; row: HTMLElement }
  | { kind: "group"; id: number; row: HTMLElement };
```

分组源拖到带 `data-group-id` 的成员 Tab 时，目标归一化为该组；目标 placement 由当前 hover 行中点计算，但反馈线必须落在目标完整组的顶部或底部边界。分组源拖到未分组 Tab 时保留 tab 目标。固定 Tab 直接清除目标。

- [ ] **Step 5：实现分组整体反馈和真实环境清理**

分组开始拖动时，对标题和当前可见成员写 `data-drag-group-source="true"`；这些元素只作为当前拖动的临时引用保存，clear 后释放。监听 `list.parentElement ?? list` 的 scroll，并监听 `viewport.resize`：

```ts
const scrollContainer = list.parentElement ?? list;
scrollContainer.addEventListener("scroll", clear);
viewport.addEventListener("resize", clear);
```

destroy 必须从同一对象移除监听。

CSS 使用 opacity 和伪元素位置线，不设置 margin、padding、width 或 height：

```css
[data-drag-group-source="true"] { opacity: 0.55; }
.tab-group-row[data-drop-placement="before"]::before,
.tab-row[data-drop-placement="after"]::after { /* 复用现有 2px AccentColor 线 */ }
```

- [ ] **Step 6：运行专项测试并修正回归**

Run: `npm test -- --run tests/tab-drag-controller.test.ts tests/tab-renderer.test.ts tests/sidepanel-css.test.ts`

Run: `npm run typecheck`

Expected: PASS；旧的“group header never source”测试已替换为新行为，单标签拖动测试仍全部通过。

- [ ] **Step 7：提交**

先运行 `git diff --check`。只暂存本任务六个文件，提交消息：`yyyyMMddHHmmss feat 支持标签组整体拖动`。

### Task 5：Sidebar 集成、busy 互斥与有状态 Fake Chrome

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/helpers/fake-chrome.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：扩展 Fake Chrome 的 group move 红灯 fixture**

新增 `groupMove` spy，并在成功时把该组所有成员作为连续块移动，重写窗口内连续 index，返回更新后的 group：

```ts
const groupMove = vi.fn(async (
  groupId: number,
  properties: chrome.tabGroups.MoveProperties,
) => {
  moveGroupBlockInState(groupId, properties.index, properties.windowId);
  return groupState.find((group) => group.id === groupId);
});
```

暴露到 `fake.tabGroups.move` 和 `fake.methods.groupMove`。fixture 必须保持成员顺序和 groupId，不调用 fake tabs.move。

- [ ] **Step 2：写成功集成红灯测试**

初始化两个组和未分组 Tab，拖动组 7 到组 8 后，断言：

```ts
expect(fake.methods.groupMove).toHaveBeenCalledOnce();
expect(fake.methods.groupMove).toHaveBeenCalledWith(7, { index: expectedIndex, windowId: 10 });
expect(fake.methods.move).not.toHaveBeenCalled();
```

在 group/tabs 事件发出前，现有 DOM 顺序保持不变；发出真实 move 事件或重同步事件后，列表顺序才改变，证明成功路径没有提前 patch Store/DOM。

- [ ] **Step 3：写执行瞬间重算和折叠组红灯测试**

在 dragover 后、drop 前调用 `fake.setTabs()` 改变目标 index；drop 必须使用最新 Store 重新计算。折叠源组测试必须包含不可见成员，目标 index 仍基于完整 `tabStore.list()`。

- [ ] **Step 4：写 busy、失败和销毁红灯测试**

覆盖：

- `groupCommandBusy` 或 `groupToggleBusy` 中的源组不能开始/提交拖动。
- group move pending 时同组折叠和右键命令禁用；其他组菜单仍可用。
- 重复 drop 不会产生第二次 API 调用。
- `groupMove` 拒绝时显示“无法移动标签组”，只触发一次合并 resync。
- cleanup 后迟到 resolve/reject 不更新状态、不再次 resync。
- group removed、scroll、resize 会取消当前反馈。

- [ ] **Step 5：集成新的拖动 intent 分支**

保留现有 tab intent 分支；group intent 使用最新快照：

```ts
onDrop(intent) {
  if (intent.kind === "tab") {
    handleTabDrop(intent);
    return;
  }
  const plan = createTabGroupReorderPlan(
    tabStore.list(),
    groupStore.list(),
    intent.sourceGroupId,
    intent.target,
  );
  if (!plan) return;
  void executeGroupCommand(plan.groupId, () => groupActions.move(plan))
    .catch(() => undefined);
}
```

`isGroupBusy` 必须同时用于 renderer/drag/controller gate；不得只在 drop 后检查。向 Task 4 已定义的控制器接口传入 `canStartGroupDrag(groupId)`，由 Sidebar 检查 `groupCommandBusy`、`groupToggleBusy` 和组是否仍存在。

- [ ] **Step 6：保证拖动状态与渲染状态同步**

`updateDragEnabled()` 继续处理全局单标签 reorder busy，但不得用一个全局 group move lock 阻塞其他分组。组命令开始或结束时取消当前同组拖动反馈；Chrome group removed handler 调用 `dragController.cancelForGroup(groupId)` 或统一 `cancel()`。

成功后不调用 `tabStore.move()`、`groupStore.patch()` 或 `renderTabList()`；只由既有 Chrome 事件路径更新。

- [ ] **Step 7：运行集成测试和类型检查**

Run: `npm test -- --run tests/tab-group-reorder-model.test.ts tests/tab-drag-controller.test.ts tests/tab-group-actions.test.ts tests/sidebar.test.ts`

Run: `npm run typecheck`

Expected: PASS；`fake.methods.groupMove` 成功路径单次调用，失败路径单次 resync，工作区无意外文件。

- [ ] **Step 8：提交**

Run: `git diff --check`

只暂存 `src/sidepanel/sidebar.ts`、`tests/helpers/fake-chrome.ts`、`tests/sidebar.test.ts`，提交消息：`yyyyMMddHHmmss feat 集成标签组整体拖动`。

### Task 6：全量回归、性能与内存审计

**Files:**
- Modify only if a failing regression requires a scoped fix.

- [ ] **Step 1：运行完整检查**

Run: `npm run check`

Expected: TypeScript、全部 Vitest、构建和 14 文件 dist 审计通过。

- [ ] **Step 2：运行标签渲染基准**

Run: `npm run benchmark:tabs`

Expected: 100/500 标签节点数继续为 700/3500 附近既有线性关系；500 标签中位数和 P95 不出现数量级回归。记录 median、P95、DOM nodes 和 heapUsedMb。

- [ ] **Step 3：审计查询、轮询和常驻资源**

Run:

```powershell
rg -n "setInterval|setTimeout|chrome\.tabs\.query|chrome\.tabGroups\.query" `
  src/sidepanel/tab-group-reorder-model.ts `
  src/sidepanel/tab-drag-controller.ts `
  src/sidepanel/history-search.ts
```

Expected: 新模型和拖动控制器无匹配；history-search 只保留既有 100ms 输入防抖，不增加其他定时器或查询。

检查 Manifest 权限仍精确为 `sidePanel,tabs,tabGroups,storage,history,sessions,bookmarks`，没有 `contextMenus`、host permissions 或远程代码。

- [ ] **Step 4：运行清理和大数据专项测试**

Run: `npm test -- --run tests/tab-group-reorder-model.test.ts tests/tab-drag-controller.test.ts tests/tab-renderer.test.ts tests/sidebar.test.ts`

Expected: destroy、滚动、resize、group removal、迟到 Promise 和 500 标签测试全部通过。

- [ ] **Step 5：仅在发现回归时提交修复**

若无需修改，不创建空提交。若有修复，先新增能复现失败的测试，只暂存相关文件，提交消息：`yyyyMMddHHmmss fix 修复标签组拖动回归问题`。

### Task 7：升级 0.10.0 与中文发布资料

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `update.log`
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1：先写版本和当前日志段红灯测试**

把四处版本断言改为 `0.10.0`，README ZIP 断言改为：

```ts
expect(readme).toContain("release/sidetab-lite-0.10.0.zip");
```

截取 `update.log` 顶部当前版本段，断言包含：

```ts
for (const detail of [
  "收藏夹",
  "历史记录",
  "来源标签",
  "连续分组容器",
  "整体拖动",
  "chrome.tabGroups.move()",
  "执行瞬间重算",
  "无新增权限",
  "无新增查询",
  "无新增轮询",
  "0.10.0",
]) expect(currentRelease).toContain(detail);
```

- [ ] **Step 2：运行 smoke 确认版本红灯**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前仍为 0.9.0 且日志无 0.10.0 段。

- [ ] **Step 3：同步 npm 和 Manifest 版本**

Run: `npm version 0.10.0 --no-git-tag-version`

使用 `apply_patch` 把 `manifest.json` 版本改为 `0.10.0`。不得修改权限、CSP、最低 Chrome 版本或资源清单。

- [ ] **Step 4：更新中文 README、商店清单和 update.log**

README 增加来源胶囊、连续分组容器和整体拖动说明，ZIP 路径改为 `release/sidetab-lite-0.10.0.zip`。商店检查清单同步新版本文件名和人工验收项。

在 `update.log` 顶部插入完整 `0.10.0` 段，保留所有旧版本记录。明确一次 `chrome.tabGroups.move()`、事件驱动成功、失败一次重同步、O(n) 装饰计算、无新增权限/查询/轮询/长期缓存/远程代码。

- [ ] **Step 5：验证并提交**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Expected: PASS；dist 文件集合仍为 14 个审核文件。

只暂存本任务七个文件，提交消息：`yyyyMMddHHmmss feat 发布搜索与分组拖动功能0.10.0`。

### Task 8：生成 Chrome 安装包并最终验收

**Files:**
- Generated and ignored: `dist/**`
- Generated and ignored: `release/sidetab-lite-0.10.0.zip`

- [ ] **Step 1：执行正式打包**

Run: `npm run package`

Expected: 完整检查通过并生成 `release/sidetab-lite-0.10.0.zip`，不删除旧版本 ZIP。

- [ ] **Step 2：审计 ZIP 内容和 Manifest**

使用 PowerShell `System.IO.Compression.ZipFile` 读取 ZIP，断言：

- 精确包含 `scripts/release-files.mjs` 的 14 个 `EXPECTED_FILES`。
- 包内 Manifest 版本为 `0.10.0`。
- 权限仍为七项既有权限。
- 不含 `contextMenus`、host permissions、`.map`、`src`、`tests`、`docs`、package metadata 或远程代码。

- [ ] **Step 3：验证确定性打包**

连续执行两次 `npm run package`，每次运行：

```powershell
Get-FileHash 'release\sidetab-lite-0.10.0.zip' -Algorithm SHA256
```

Expected: 两次 SHA-256 和字节数完全一致。记录最终绝对路径、大小和哈希。

- [ ] **Step 4：真实 Chrome 与窄宽度视觉验收**

加载 `dist` 后检查：

- 180px、240px、常规宽度下来源胶囊完整，标题正确省略，无横向滚动。
- 展开组为连续同色圆角容器；折叠组标题四角圆角；九色浅色/深色/强制色可读。
- 单标签拖动行为不变。
- 展开与折叠分组都能整体前后移动，不能拖进固定区或合并进其他组。
- API 失败时显示稳定错误并恢复真实顺序。
- DevTools 无未处理异常；重复拖动、滚动、resize 和打开/关闭菜单后内存不持续增长。

如 Browser/Chrome 控制不可用，必须明确记录未执行项，不得把普通 HTTP 预览当作完整扩展验收。

- [ ] **Step 5：最终验证工作区**

Run: `npm run check`

Run: `npm run benchmark:tabs`

Run: `git diff --check`

Run: `git status --short`

Expected: 全部受控文件已提交，工作区干净；dist 和 release ZIP 被 `.gitignore` 排除；安装包版本为 `0.10.0`。
