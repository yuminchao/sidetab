# 标签树拖放反馈简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将标签树拖放简化为两种明确意图：定位线把拖动节点移动为目标同级，整行高亮把拖动节点创建为目标的直接子节点，并完整覆盖 Root/Child 四种来源与目标组合。

**Architecture:** `tab-tree-drop-model` 在拖动开始时用一次 O(n) 快照预计算父节点、深度和子树末端，并把“同级”或“子节点”请求解析为可执行的 `TabDropTarget`；`tab-drag-controller` 只负责标签行 25%/50%/25% 的纵向命中和互斥反馈，不再读取横向坐标或吸附深度。`sidebar` 在 drop 前用最新 Store 快照重新解析同一请求，现有 Chrome 排序事务和 `storage.session` 父关系事务继续负责提交、回滚与重同步。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM Drag and Drop、Chrome `tabs/storage.session` API、Vitest、jsdom、CSS。

---

## 前置条件

- 工作目录：`E:\java\sidebar\.worktrees\feature-side-panel-tabs`。
- 设计依据：已确认的规则“定位线成为目标同级，整行高亮成为目标子节点”。
- 执行前必须读取 `C:\Users\NUC\.codex\rules\coding.md`；只有用户明确授权 Git 提交时，才读取 `C:\Users\NUC\.codex\rules\git-commit.md` 并执行本计划中的提交命令。
- 当前工作树包含未提交的既有功能，且与本任务会修改的 `sidebar.ts`、`sidebar.css` 和测试文件重叠。不得还原、覆盖或把无关改动混入提交；未获得提交授权时，用 `git diff --check` 和聚焦测试作为每个任务的检查点。
- 本计划不打包、不升级版本、不修改 `package.json`、`package-lock.json`、`manifest.json` 或 `update.log`。后续收到打包请求时再按仓库规则检查敏感信息并记录新版本。
- Codegraph 已确认主要影响链为 `tab-tree-drop-model` → `tab-drag-controller` → `sidebar`；执行时若 Codegraph 提示工作树索引陈旧，以当前工作树文件为准。

## 行为定义

- 标签行上方 25%：显示定位线，拖动节点成为目标节点的同级并插入目标之前。
- 标签行中间 50%：高亮整行，拖动节点成为目标节点的最后一个直接子节点。
- 标签行下方 25%：显示定位线，拖动节点成为目标节点的同级并插入目标完整子树之后。
- 定位线会按目标现有深度缩进，但不再随 `clientX` 改变；横向坐标不参与目标解析。
- 拖动父节点时移动完整子树，只改变子树根节点的父关系，内部顺序和相对层级不变。
- Root → Root、Root → Child、Child → Child、Child → Root 均遵循同一规则。
- 子节点目标属于拖动源子树、结果超过四级、固定标签、Chrome 原生标签组、跨窗口或最新状态已变化时，取消投放且不保留反馈。
- 原生标签组标题与分组整体拖动继续使用现有语义，不进入树形“同级/子节点”解析。

## 文件映射

- Modify: `src/sidepanel/tab-reorder-model.ts`：给临时树投放结果增加 `relation` 和 `referenceId`，保留现有排序计划接口。
- Modify: `src/sidepanel/tab-tree-drop-model.ts`：将横向深度解析器替换为同级/子节点请求解析器，并在拖动开始时预计算 O(1) 热路径索引。
- Modify: `tests/tab-tree-drop-model.test.ts`：覆盖四种 Root/Child 组合、完整子树末端、四级上限、循环、原生边界和无操作。
- Modify: `src/sidepanel/tab-drag-controller.ts`：实现 25%/50%/25% 命中、行高亮与定位线互斥，删除横向几何状态。
- Modify: `tests/tab-drag-controller.test.ts`：验证三段命中、间距、末尾、目标稳定性、清理和 500 行热路径。
- Modify: `src/sidepanel/sidebar.css`：增加不改变布局的子节点高亮，保留按结果深度缩进的定位线。
- Modify: `tests/sidepanel-css.test.ts`：锁定高亮、定位线、深色和强制颜色行为。
- Modify: `src/sidepanel/sidebar.ts`：接入新请求接口、drop 前按最新状态重验，并复用现有排序和会话事务。
- Modify: `tests/sidebar.test.ts`：覆盖四种关系组合、折叠展开、父节点消失、Chrome 失败和 session 写失败。
- Modify: `docs/superpowers/specs/2026-08-09-tab-tree-depth-drag-collapse-design.md`：用新交互替换横向档位设计。
- Modify: `docs/adr/0002-tab-tree-manual-parent-overrides.md`：把显式父关系来源改为高亮投放和同级投放。
- Modify: `docs/chrome-web-store-checklist.md`：更新人工拖放验收项。

### Task 1：定义同级与子节点投放协议

**Files:**
- Modify: `src/sidepanel/tab-reorder-model.ts`
- Modify: `src/sidepanel/tab-tree-drop-model.ts`
- Test: `tests/tab-tree-drop-model.test.ts`

- [ ] **Step 1：写四种关系组合的失败测试**

把旧的 `requestedDepth` 用例替换为请求对象，并增加以下表驱动断言：

```ts
it.each([
  {
    name: "Root → Root 同级",
    sourceId: 5,
    request: {
      relation: "sibling" as const,
      target: { kind: "tab" as const, tabId: 1, placement: "before" as const },
    },
    expected: {
      kind: "tab",
      tabId: 1,
      placement: "before",
      tree: { relation: "sibling", referenceId: 1, depth: 0 },
    },
  },
  {
    name: "Root → Child 子节点",
    sourceId: 5,
    request: { relation: "child" as const, parentId: 2 },
    expected: {
      kind: "tab",
      tabId: 3,
      placement: "after",
      tree: { relation: "child", referenceId: 2, depth: 2, parentId: 2 },
    },
  },
  {
    name: "Child → Child 同级",
    sourceId: 4,
    request: {
      relation: "sibling" as const,
      target: { kind: "tab" as const, tabId: 2, placement: "after" as const },
    },
    expected: {
      kind: "tab",
      tabId: 3,
      placement: "after",
      tree: { relation: "sibling", referenceId: 2, depth: 1, parentId: 1 },
    },
  },
  {
    name: "Child → Root 同级",
    sourceId: 4,
    request: {
      relation: "sibling" as const,
      target: { kind: "tab" as const, tabId: 5, placement: "before" as const },
    },
    expected: {
      kind: "tab",
      tabId: 5,
      placement: "before",
      tree: { relation: "sibling", referenceId: 5, depth: 0 },
    },
  },
])("resolves $name", ({ sourceId, request, expected }) => {
  expect(createTabTreeDropResolver(tabs, sourceId)(request)).toEqual(expected);
});
```

再补齐每种来源/目标组合的另一种反馈语义，使模型层总计覆盖八种投放：

```ts
it.each([
  {
    name: "Root → Root 子节点",
    sourceId: 5,
    request: { relation: "child" as const, parentId: 1 },
    expectedTree: { relation: "child", referenceId: 1, depth: 1, parentId: 1 },
  },
  {
    name: "Root → Child 同级",
    sourceId: 5,
    request: {
      relation: "sibling" as const,
      target: { kind: "tab" as const, tabId: 2, placement: "after" as const },
    },
    expectedTree: { relation: "sibling", referenceId: 2, depth: 1, parentId: 1 },
  },
  {
    name: "Child → Child 子节点",
    sourceId: 4,
    request: { relation: "child" as const, parentId: 2 },
    expectedTree: { relation: "child", referenceId: 2, depth: 2, parentId: 2 },
  },
  {
    name: "Child → Root 子节点",
    sourceId: 4,
    request: { relation: "child" as const, parentId: 5 },
    expectedTree: { relation: "child", referenceId: 5, depth: 1, parentId: 5 },
  },
])("resolves $name", ({ sourceId, request, expectedTree }) => {
  expect(createTabTreeDropResolver(tabs, sourceId)(request)).toMatchObject({
    tree: expectedTree,
  });
});
```

其中标签关系保持现有 fixture：`1` 为 Root，`2` 是 `1` 的 Child，`3` 是 `2` 的 Child，`4` 是 `1` 的 Child，`5` 为 Root。

- [ ] **Step 2：写子树末端、四级上限和无效目标测试**

增加以下精确断言：

```ts
it("places a new child after every existing descendant", () => {
  expect(createTabTreeDropResolver(tabs, 5)({
    relation: "child",
    parentId: 1,
  })).toMatchObject({
    kind: "tab",
    tabId: 4,
    placement: "after",
    tree: { relation: "child", referenceId: 1, depth: 1, parentId: 1 },
  });
});

it("rejects child attachment into the source subtree or beyond depth four", () => {
  expect(createTabTreeDropResolver(tabs, 1)({
    relation: "child",
    parentId: 3,
  })).toBeUndefined();

  const deepSource = [
    tab({ id: 10, index: 0 }),
    tab({ id: 11, index: 1, openerTabId: 10 }),
    tab({ id: 12, index: 2 }),
    tab({ id: 13, index: 3, openerTabId: 12 }),
    tab({ id: 14, index: 4, openerTabId: 13 }),
    tab({ id: 15, index: 5, openerTabId: 14 }),
  ];
  expect(createTabTreeDropResolver(deepSource, 12)({
    relation: "child",
    parentId: 11,
  })).toBeUndefined();
});
```

保留并改写固定标签、原生分组、列表末尾 Root、跨原生边界和“顺序与父关系都不变”的测试，使其调用新请求接口。

- [ ] **Step 3：运行模型测试并确认红灯**

Run: `npx vitest run tests/tab-tree-drop-model.test.ts`

Expected: FAIL，原因是解析器仍要求第二个 `requestedDepth` 参数，且结果没有 `relation`、`referenceId` 或子节点请求协议；失败不得来自 fixture 类型错误。

- [ ] **Step 4：定义临时投放结果与请求类型**

在 `src/sidepanel/tab-reorder-model.ts` 中把树投放结果改为：

```ts
export type TabTreeDropRelation = "sibling" | "child";

export type TabTreeDropPlacement =
  | {
      relation: "sibling";
      referenceId?: number;
      depth: number;
      parentId?: number;
    }
  | {
      relation: "child";
      referenceId: number;
      depth: number;
      parentId: number;
    };
```

在 `src/sidepanel/tab-tree-drop-model.ts` 中定义：

```ts
export type TabTreeDropRequest =
  | {
      relation: "sibling";
      target: Exclude<TabDropTarget, { kind: "group" }>;
    }
  | { relation: "child"; parentId: number };

export type TabTreeDropResolver = (
  request: TabTreeDropRequest,
) => TabDropTarget | undefined;
```

`referenceId` 只存在于当前拖放意图，不写入 `storage.session`；它让 Sidebar 能在 drop 时用最新快照重建同一请求。`depth` 只用于定位线缩进和四级校验，不再来自鼠标横坐标。

- [ ] **Step 5：运行类型检查并记录预期红灯**

Run: `npm run typecheck`

Expected: FAIL，调用方仍使用 `(target, requestedDepth)`，控制器和 Sidebar 尚未迁移；错误应集中在 `tab-drag-controller.ts`、`sidebar.ts` 和相关测试。

- [ ] **Step 6：记录检查点**

Run: `git diff --check -- src/sidepanel/tab-reorder-model.ts src/sidepanel/tab-tree-drop-model.ts tests/tab-tree-drop-model.test.ts`

Expected: PASS。只有用户明确授权提交且暂存区只包含这三个文件时，才执行：

```powershell
Get-Content C:\Users\NUC\.codex\rules\git-commit.md -Encoding utf8
$stamp = Get-Date -Format yyyyMMddHHmmss
git add src/sidepanel/tab-reorder-model.ts src/sidepanel/tab-tree-drop-model.ts tests/tab-tree-drop-model.test.ts
git commit -m "$stamp refactor 定义标签树同级与子节点投放协议"
```

### Task 2：实现 O(1) 热路径的树关系解析器

**Files:**
- Modify: `src/sidepanel/tab-tree-drop-model.ts`
- Test: `tests/tab-tree-drop-model.test.ts`

- [ ] **Step 1：在解析器创建阶段建立树索引**

先用原始快照计算 `sourceIds` 和 `sourceSubtreeMaxDepth`，再从排除完整拖动子树后的普通非固定标签建立 `remainingForest`。使用 `remainingForest` 和显式 enter/exit 栈，一次遍历建立 `parentById`、`depthById` 和 `subtreeEndById`，避免为每次 `dragover` 调用 `getTabSubtreeIds()`，也避免把 source 自身误当作目标子树末端：

先把类型导入补齐：

```ts
import {
  buildTabForest,
  getTabSubtreeIds,
  getTabSubtreeMaxDepth,
  getTabTreeParentId,
  type TabTreeNode,
} from "./tab-tree-model";
```

```ts
type TreeFrame = {
  node: TabTreeNode;
  depth: number;
  parentId?: number;
  exiting: boolean;
};

const parentById = new Map<number, number>();
const depthById = new Map<number, number>();
const subtreeEndById = new Map<number, number>();
let lastVisitedId: number | undefined;
const remainingForest = buildTabForest(
  tabs.filter((tab) =>
    !sourceIds.has(tab.id) && !tab.pinned && tab.groupId < 0),
  detachedTabIds,
  attachedTabParentIds,
);
const stack: TreeFrame[] = remainingForest
  .slice()
  .reverse()
  .map((node) => ({ node, depth: 0, exiting: false }));

while (stack.length > 0) {
  const frame = stack.pop()!;
  const id = frame.node.tab.id;
  if (frame.exiting) {
    subtreeEndById.set(id, lastVisitedId ?? id);
    continue;
  }
  depthById.set(id, frame.depth);
  if (frame.parentId !== undefined) parentById.set(id, frame.parentId);
  lastVisitedId = id;
  stack.push({ ...frame, exiting: true });
  for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
    stack.push({
      node: frame.node.children[index]!,
      depth: frame.depth + 1,
      parentId: id,
      exiting: false,
    });
  }
}
```

保留现有 `orderedIndexById`、原生边界前缀计数、source 子树 ID 集合、source 子树最大相对深度和无操作判断。所有索引只在 `createTabTreeDropResolver()` 时建立一次。

- [ ] **Step 2：实现同级解析**

同级请求以参考标签的父节点和深度为最终关系；`after` 使用参考标签完整子树的末端作为真实排序锚点：

```ts
const resolveSibling = (
  target: Extract<TabDropTarget, { kind: "tab" }>,
): TabDropTarget | undefined => {
  if (sourceIds.has(target.tabId)) return undefined;
  const reference = tabsById.get(target.tabId);
  const depth = depthById.get(target.tabId);
  if (!reference || depth === undefined || reference.pinned || reference.groupId >= 0) {
    return undefined;
  }
  const parentId = parentById.get(target.tabId);
  const anchorId = target.placement === "after"
    ? subtreeEndById.get(target.tabId) ?? target.tabId
    : target.tabId;
  return finish(
    { kind: "tab", tabId: anchorId, placement: target.placement },
    {
      relation: "sibling",
      referenceId: target.tabId,
      depth,
      ...(parentId === undefined ? {} : { parentId }),
    },
  );
};
```

列表末尾请求始终解析为 Root 同级：

```ts
if (request.relation === "sibling" && request.target.kind === "end") {
  return finish({ kind: "end" }, { relation: "sibling", depth: 0 });
}
```

- [ ] **Step 3：实现子节点解析**

子节点请求把目标作为直接父节点，并把真实排序锚点放到目标完整子树末端：

```ts
const resolveChild = (parentId: number): TabDropTarget | undefined => {
  if (sourceIds.has(parentId)) return undefined;
  const parent = tabsById.get(parentId);
  const parentDepth = depthById.get(parentId);
  if (!parent || parentDepth === undefined || parent.pinned || parent.groupId >= 0) {
    return undefined;
  }
  const depth = parentDepth + 1;
  if (depth + sourceSubtreeMaxDepth > 4) return undefined;
  const anchorId = subtreeEndById.get(parentId) ?? parentId;
  if (crossesNativeBoundary(parentId, anchorId)) return undefined;
  return finish(
    { kind: "tab", tabId: anchorId, placement: "after" },
    { relation: "child", referenceId: parentId, depth, parentId },
  );
};
```

`finish()` 使用排除 source 子树后的真实锚点比较插入索引和 `currentParentId`；只有顺序或父关系至少一项变化时才返回结果：

```ts
const finish = (
  target: Exclude<TabDropTarget, { kind: "group" }>,
  tree: TabTreeDropPlacement,
): TabDropTarget | undefined => {
  if (!orderChanges(target) && tree.parentId === currentParentId) return undefined;
  return { ...target, tree };
};
```

Root/Child 的关系变化通过 `tree.parentId` 判断，不通过 `relation` 猜测。

- [ ] **Step 4：运行模型测试和类型检查**

Run: `npx vitest run tests/tab-tree-drop-model.test.ts && npm run typecheck`

Expected: 模型测试 PASS；类型检查仍只因控制器和 Sidebar 使用旧回调签名而 FAIL。

- [ ] **Step 5：记录检查点**

Run: `git diff --check -- src/sidepanel/tab-tree-drop-model.ts tests/tab-tree-drop-model.test.ts`

Expected: PASS。

### Task 3：将控制器改为定位线与整行高亮两种反馈

**Files:**
- Modify: `src/sidepanel/tab-drag-controller.ts`
- Test: `tests/tab-drag-controller.test.ts`

- [ ] **Step 1：写 25%/50%/25% 命中的失败测试**

对 40px 高的目标行使用 `clientY` 位置 5、20、35，分别断言 before 线、child 高亮、after 线：

```ts
it.each([
  { clientY: 5, relation: "sibling", placement: "before", highlighted: false },
  { clientY: 20, relation: "child", placement: undefined, highlighted: true },
  { clientY: 35, relation: "sibling", placement: "after", highlighted: false },
])("resolves the vertical drop zone at y=$clientY", ({
  clientY,
  relation,
  placement,
  highlighted,
}) => {
  const prepareTabDrag = vi.fn(() => (request: TabTreeDropRequest): TabDropTarget =>
    request.relation === "child"
      ? {
          kind: "tab",
          tabId: 6,
          placement: "after",
          tree: { relation: "child", referenceId: 6, depth: 1, parentId: 6 },
        }
      : {
          ...request.target,
          tree: { relation: "sibling", referenceId: 6, depth: 0 },
        });
  const { onDrop, controller } = create(vi.fn(), undefined, prepareTabDrag);

  drag(tabs.get(3)!, "dragstart");
  drag(tabs.get(6)!, "dragover", clientY, undefined, 180);

  expect(tabs.get(6)!.dataset.dropRelation).toBe(relation);
  expect(tabs.get(6)!.dataset.dropPlacement).toBe(placement);
  expect(tabs.get(6)!.dataset.dropChildTarget === "true").toBe(highlighted);

  drag(tabs.get(6)!, "drop", clientY, undefined, 8);
  expect(onDrop).toHaveBeenCalledOnce();
  controller.destroy();
});
```

测试刻意让 `dragover` 与 `drop` 的 `clientX` 不同，证明横向位置不再改变意图。

- [ ] **Step 2：增加反馈互斥、间距和清理测试**

增加以下断言：

```ts
drag(tabs.get(6)!, "dragover", 20);
expect(tabs.get(6)!.dataset.dropChildTarget).toBe("true");
expect(tabs.get(6)!.dataset.dropPlacement).toBeUndefined();

drag(tabs.get(6)!, "dragover", 5);
expect(tabs.get(6)!.dataset.dropChildTarget).toBeUndefined();
expect(tabs.get(6)!.dataset.dropPlacement).toBe("before");

controller.cancel();
expect(list.querySelector('[data-drop-relation], [data-drop-child-target]')).toBeNull();
```

保留行间距二分查找测试，并断言间距只能产生 `relation: "sibling"`。列表末尾超过 4px 和新增标签按钮区域继续产生 Root 同级定位线，不得产生高亮。

- [ ] **Step 3：运行控制器测试并确认红灯**

Run: `npx vitest run tests/tab-drag-controller.test.ts`

Expected: FAIL，旧控制器按行中点二分 before/after、读取 `clientX` 并设置 `data-drop-depth`，尚无中间高亮。

- [ ] **Step 4：替换回调签名并删除横向状态**

将 handler 改为：

```ts
type GroupDragHandlers = {
  canStartGroupDrag?(groupId: number): boolean;
  canDropTab?(sourceId: number, target: TabDropTarget): boolean;
  prepareTabDrag?(sourceId: number): (
    request: TabTreeDropRequest,
  ) => TabDropTarget | undefined;
  onDrop(intent: TabDragIntent): void;
};
```

删除 `dragListBounds`、`dragDirection`、`requestedDepthFrom()` 和所有依赖 `clientX` 的准备逻辑。`onDragStart` 不再读取列表矩形或 CSS direction。

- [ ] **Step 5：实现标签行三段命中**

新增纯局部函数：

```ts
type TabHoverIntent =
  | { relation: "sibling"; placement: "before" | "after" }
  | { relation: "child" };

const tabHoverIntentFrom = (
  row: HTMLElement,
  clientY: number,
  placementOverride?: "before" | "after",
): TabHoverIntent => {
  if (placementOverride) return { relation: "sibling", placement: placementOverride };
  const bounds = row.getBoundingClientRect();
  const offset = clientY - bounds.top;
  if (offset < bounds.height * 0.25) {
    return { relation: "sibling", placement: "before" };
  }
  if (offset > bounds.height * 0.75) {
    return { relation: "sibling", placement: "after" };
  }
  return { relation: "child" };
};
```

标签源命中标签行时构造请求：

```ts
const hoverIntent = tabHoverIntentFrom(
  tabRow,
  event.clientY,
  hoverTarget.placement,
);
const request: TabTreeDropRequest = hoverIntent.relation === "child"
  ? { relation: "child", parentId: tabId }
  : {
      relation: "sibling",
      target: {
        kind: "tab",
        tabId,
        placement: hoverIntent.placement,
      },
    };
const intentTarget = resolvePreparedTabTarget?.(request);
```

非树模式仍把 sibling 请求中的 `target` 原样返回；child 请求在树未启用时返回 `undefined`，避免平铺模式意外建立关系。

- [ ] **Step 6：实现互斥反馈和正确定位线锚点**

`clearTarget()` 必须移除全部临时属性：

```ts
target?.feedback.removeAttribute("data-drop-placement");
target?.feedback.removeAttribute("data-drop-depth");
target?.feedback.removeAttribute("data-drop-relation");
target?.feedback.removeAttribute("data-drop-child-target");
target?.feedback.style.removeProperty("--drop-depth-indent");
```

`setTarget()` 按关系设置一种反馈：

```ts
const tree = "tree" in next.intentTarget ? next.intentTarget.tree : undefined;
if (next.groupMarker) {
  next.groupMarker.dataset.dropTarget = "true";
  if ("placement" in next.intentTarget) {
    next.feedback.dataset.dropPlacement = next.intentTarget.placement;
  }
} else if (tree?.relation === "child") {
  next.feedback.dataset.dropRelation = "child";
  next.feedback.dataset.dropChildTarget = "true";
} else {
  next.feedback.dataset.dropRelation = "sibling";
  next.feedback.dataset.dropPlacement = next.intentTarget.kind === "end"
    ? "after"
    : next.intentTarget.placement;
  const depth = tree?.depth ?? 0;
  next.feedback.dataset.dropDepth = String(depth);
  next.feedback.style.setProperty("--drop-depth-indent", `${4 + depth * 12}px`);
}
```

tab source 拖到原生 group 时只有 `data-drop-target`，不读取不存在的 placement。列表末尾准备请求固定为：

```ts
const intentTarget = resolvePreparedTabTarget?.({
  relation: "sibling",
  target: { kind: "end" },
});
```

child 反馈始终使用用户悬停的 `referenceId` 行；sibling `after` 反馈优先使用解析结果 `tabId` 对应的可见末端行，以便父节点已有展开子树时把线画在完整子树之后。折叠后代没有 DOM 时，回退到悬停父行。将最终 `feedback` 加入 `ActiveTarget.elements`，确保可见锚点在 drop 前消失时立即取消。

- [ ] **Step 7：保持 drop 前目标稳定比较**

`sameIntentTarget()` 除现有 tabId、placement、depth、parentId 外，继续比较：

```ts
leftTree?.relation === rightTree?.relation
  && leftTree?.referenceId === rightTree?.referenceId
```

父节点或反馈锚点从 DOM 移除时继续取消；Store 状态变化由 `canDropTab()` 在 dispatch 前拒绝。

- [ ] **Step 8：运行控制器测试**

Run: `npx vitest run tests/tab-drag-controller.test.ts`

Expected: PASS；旧的“横向深度预览”测试已被三段命中测试替换，分组拖动测试保持通过。

### Task 4：增加不改变布局的子节点高亮

**Files:**
- Modify: `src/sidepanel/sidebar.css`
- Test: `tests/sidepanel-css.test.ts`

- [ ] **Step 1：写 CSS 契约失败测试**

增加：

```ts
it("uses mutually exclusive line and child drop feedback without layout shifts", () => {
  expect(css).toMatch(
    /\.tab-row\[data-drop-child-target="true"\]\s*\{[^}]*background:\s*color-mix\(in\s+srgb,\s*AccentColor\s+14%,\s*Canvas\)[^}]*outline:\s*2px\s+solid\s+AccentColor[^}]*outline-offset:\s*-2px/s,
  );
  const childRule = css.match(
    /\.tab-row\[data-drop-child-target="true"\]\s*\{[^}]*}/s,
  )?.[0] ?? "";
  expect(childRule).not.toMatch(/(?:margin|padding|width|height|border):/);
  expect(css).toMatch(/\[data-drop-placement="before"\]::before/s);
  expect(css).toMatch(/inset-inline-start:\s*var\(--drop-depth-indent,\s*4px\)/s);
});
```

强制颜色断言：

```ts
expect(forcedColors).toMatch(
  /\.tab-row\[data-drop-child-target="true"\]\s*\{[^}]*background:\s*Highlight[^}]*color:\s*HighlightText[^}]*outline-color:\s*Highlight/s,
);
```

- [ ] **Step 2：运行 CSS 测试并确认红灯**

Run: `npx vitest run tests/sidepanel-css.test.ts`

Expected: FAIL，当前没有 `data-drop-child-target` 样式。

- [ ] **Step 3：实现浅色、深色和强制颜色反馈**

在现有 active、context-selected 和 hover 规则之后加入，保证拖动高亮不会被活动标签淡黄色或 hover 背景覆盖：

```css
.tab-row[data-drop-child-target="true"] {
  background: color-mix(in srgb, AccentColor 14%, Canvas);
  outline: 2px solid AccentColor;
  outline-offset: -2px;
}
```

在深色主题中提高背景比例但不改变 outline：

```css
@media (prefers-color-scheme: dark) {
  .tab-row[data-drop-child-target="true"] {
    background: color-mix(in srgb, AccentColor 22%, Canvas);
  }
}
```

在现有 forced-colors 媒体查询中加入：

```css
.tab-row[data-drop-child-target="true"] {
  background: Highlight;
  color: HighlightText;
  outline-color: Highlight;
}
```

高亮优先于 active/hover 背景；属性清理后恢复原活动淡黄色。不得增加 transition、border、尺寸、margin 或 padding。

- [ ] **Step 4：运行 CSS 与控制器测试**

Run: `npx vitest run tests/sidepanel-css.test.ts tests/tab-drag-controller.test.ts`

Expected: PASS。

- [ ] **Step 5：记录检查点**

Run: `git diff --check -- src/sidepanel/sidebar.css tests/sidepanel-css.test.ts src/sidepanel/tab-drag-controller.ts tests/tab-drag-controller.test.ts`

Expected: PASS。

### Task 5：接入 Sidebar 最新状态重验和树事务

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Test: `tests/sidebar.test.ts`

- [ ] **Step 1：写四种 Root/Child 集成失败测试**

使用启用 child 模式的 storage fixture，为四种来源/目标组合的定位线和高亮各写一个测试，共八个集成测试：

```ts
const childSettings = {
  shortcutSettings: {
    ...createDefaultShortcutSettings(),
    newTabBehavior: "child" as const,
  },
};
```

断言矩阵：

```ts
// Root → Root：目标上缘/下缘后仍无 parent override。
expect(savedTreeState.attachedTabParentIds).not.toContainEqual([sourceId, targetId]);

// Root → Child：目标中间高亮后 source 的 parentId 是 childTargetId。
expect(savedTreeState.attachedTabParentIds).toContainEqual([sourceId, childTargetId]);

// Child → Child：定位线后 source 与 target 共享 target 的 parentId。
expect(savedTreeState.attachedTabParentIds).toContainEqual([sourceId, targetParentId]);

// Child → Root：定位线后 source 被记录为 detached root。
expect(savedTreeState.detachedTabIds).toContain(sourceId);

// Root → Root：高亮后 source 直接挂到目标 Root。
expect(savedTreeState.attachedTabParentIds).toContainEqual([5, 1]);

// Root → Child：定位线后 source 与目标 Child 共享其父节点。
expect(savedTreeState.attachedTabParentIds).toContainEqual([5, 1]);

// Child → Child：高亮后 source 直接挂到目标 Child。
expect(savedTreeState.attachedTabParentIds).toContainEqual([4, 2]);

// Child → Root：高亮后 source 直接挂到目标 Root。
expect(savedTreeState.attachedTabParentIds).toContainEqual([4, 5]);
```

fixture 固定使用 `1` 为 Root、`2` 为 `1` 的 Child、`4` 为另一个 Child、`5` 为 Root。每个测试同时断言 `tabs.move()` 的索引以目标完整子树为边界，父节点拖动时 `tabs.move()` 接收完整 subtree ID 数组。

- [ ] **Step 2：写最新状态变化和失败恢复测试**

保留现有“目标父节点变为 pinned”“父节点在 Chrome move 期间被移除”“session 保存失败回滚”和 revision 防旧失败覆盖测试，并增加：

```ts
it("cancels a highlighted child drop when the latest target becomes grouped", async () => {
  // dragover 中间区域先得到 child 高亮。
  // drop 前通过 tab update 让目标进入原生 group。
  // 断言 tabs.move、storage.session.set 均未调用，反馈已清理。
});
```

不得在测试中直接修改生产集合；通过 fake Chrome 事件更新 `TabStore`。

- [ ] **Step 3：运行 Sidebar 树测试并确认红灯**

Run: `npx vitest run tests/sidebar.test.ts -t "Root|Child|highlighted child drop|attaches a root tab|tree session"`

Expected: 新测试 FAIL，旧 Sidebar 仍以 `requestedDepth` 重建目标，无法区分 sibling 与 child 请求。

- [ ] **Step 4：更新 prepareTabDrag 接线**

树启用时直接返回新 resolver；树未启用时只允许 sibling：

```ts
prepareTabDrag: (sourceId) => {
  if (!isTreeEnabled()) {
    return (request) => request.relation === "sibling"
      ? request.target
      : undefined;
  }
  const tabs = tabStore.list();
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source || source.pinned || source.groupId >= 0) {
    return (request) => request.relation === "sibling"
      ? request.target
      : undefined;
  }
  return createTabTreeDropResolver(
    tabs,
    sourceId,
    collapsedTabIds,
    detachedTabIds,
    attachedTabParentIds,
  );
},
```

- [ ] **Step 5：按 referenceId 重建最新请求**

新增局部转换函数：

```ts
const requestFromResolvedTarget = (
  target: Exclude<TabDropTarget, { kind: "group" }>,
): TabTreeDropRequest | undefined => {
  const tree = target.tree;
  if (!tree) return undefined;
  if (tree.relation === "child") {
    return tree.referenceId === undefined
      ? undefined
      : { relation: "child", parentId: tree.referenceId };
  }
  if (target.kind === "end") {
    return { relation: "sibling", target: { kind: "end" } };
  }
  return tree.referenceId === undefined
    ? undefined
    : {
        relation: "sibling",
        target: {
          kind: "tab",
          tabId: tree.referenceId,
          placement: target.placement,
        },
      };
};
```

`canDropTab()` 用最新 `tabStore.list()` 创建 resolver，解析该请求，并精确比较 `kind`、真实 `tabId`、`placement`、`relation`、`referenceId`、`depth` 和 `parentId`。任何字段变化都在 Chrome API 调用前返回 `false`。

- [ ] **Step 6：复用现有提交与回滚事务**

保留 `attachmentParentId = treePlacement?.parentId`、`shouldAttach`、`shouldDetach`、`shouldExpandParent`、`applyTreeMutation()`、`treeSessionRevision` 和失败重同步。只增加以下关系约束：

```ts
const movesToNativeGroup = intent.target.kind === "group";
const hasExplicitTreePlacement = isTreeEnabled()
  && (treePlacement !== undefined || movesToNativeGroup);
const shouldExpandParent = treePlacement?.relation === "child"
  && attachmentParentId !== undefined
  && collapsedTabIds.has(attachmentParentId);
```

sibling 投放到折叠节点旁不展开该节点；只有整行高亮创建 child 成功后才展开新父节点。原生 group target 继续走现有分组逻辑，不伪造 tree relation，但 Child 拖入原生 group 时仍通过 `movesToNativeGroup` 解除旧树父关系。

- [ ] **Step 7：运行 Sidebar、模型和控制器测试**

Run: `npx vitest run tests/tab-tree-drop-model.test.ts tests/tab-drag-controller.test.ts tests/sidebar.test.ts`

Expected: PASS；Root/Child 四种组合、最新状态重验、完整子树移动和 session 回滚全部通过。

- [ ] **Step 8：运行类型检查**

Run: `npm run typecheck`

Expected: PASS，不再存在 `(target, requestedDepth)` 调用或未使用的横向几何变量。

### Task 6：更新领域文档并完成全量回归

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-tab-tree-depth-drag-collapse-design.md`
- Modify: `docs/adr/0002-tab-tree-manual-parent-overrides.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Verify: all modified source and test files

- [ ] **Step 1：更新中文设计文档**

将“纵向排序”“横向层级”“定位线”相关段落替换为以下规则，删除横向 12px 档位、RTL 横坐标和 `requestedDepth` 描述：

```markdown
### 纵向命中与关系

- 标签行上方 25% 显示 before 定位线；下方 25% 显示 after 定位线。
- 标签行中间 50% 高亮整行，表示成为目标的最后一个直接子节点。
- 定位线表示成为目标同级；线的缩进只反映目标现有深度，不接受横向输入。
- after 同级投放位于目标完整子树之后，child 投放位于目标现有完整子树之后。
- 行间距和列表末尾只产生同级定位线，不产生子节点高亮。
```

保留四级上限、循环检测、整树移动、折叠成功后展开、原生分组边界、500 标签性能和失败恢复章节。

- [ ] **Step 2：更新 ADR 和商店验收项**

ADR 中把“纵向位置选择排序、横向位置选择层级”改为：

```markdown
用户通过标签边缘的定位线把节点移动为目标同级，通过标签中间的整行高亮把节点创建为目标的直接子节点。两种操作都只为被拖子树根节点记录会话级父关系覆盖，后代关系保持不变。
```

商店检查清单加入四种组合与反馈互斥验收：

```markdown
- [ ] Root → Root、Root → Child、Child → Child、Child → Root 的定位线投放均成为目标同级；整行高亮投放均成为目标直接子节点。
- [ ] 标签上方/下方只显示定位线，中间只显示整行高亮；横向移动鼠标不会改变关系或定位线深度。
- [ ] after 定位线和 child 高亮均把拖动子树放到目标完整子树之后；折叠目标仅在 child 投放成功后展开。
```

- [ ] **Step 3：扫描旧语义残留**

Run:

```powershell
rg -n "requestedDepth|requestedDepthFrom|dragListBounds|横向位置.*层级|横向吸附|12px 档位" src tests docs\adr docs\chrome-web-store-checklist.md docs\superpowers\specs\2026-08-09-tab-tree-depth-drag-collapse-design.md
```

Expected: 没有生产代码或当前设计文档命中；历史实施计划允许保留历史描述，不在本次修改范围内。

- [ ] **Step 4：运行聚焦回归**

Run:

```powershell
npx vitest run tests/tab-tree-drop-model.test.ts tests/tab-drag-controller.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts tests/tab-reorder-model.test.ts
```

Expected: PASS。

- [ ] **Step 5：运行完整检查**

Run: `npm run check`

Expected: typecheck、全部 Vitest 测试、build 和 `dist` 审计全部 PASS；不生成 ZIP。

- [ ] **Step 6：执行性能与 DOM 热路径检查**

确认 500 行控制器测试包含 child 中间命中，并断言一次 `dragover` 不调用 `querySelectorAll()`、Chrome API 或完整 resolver 重建。Run:

```powershell
npx vitest run tests/tab-drag-controller.test.ts -t "five hundred|O(1)|child"
npm run benchmark:tabs
```

Expected: 测试 PASS；benchmark 输出 100 和 500 标签 JSON 指标且进程退出码为 0。

- [ ] **Step 7：执行人工视觉验收**

在加载 `dist` 的 Chrome 中验证：

1. 标签上方和下方显示 2px 定位线，中间显示整行高亮，两者不同时出现。
2. 在同一纵向位置左右移动鼠标，反馈和最终关系不变化。
3. Root/Child 四种组合分别测试定位线和高亮，共八次投放。
4. 父节点有展开或折叠后代时，after 线位于完整子树末端；child 成功后目标展开。
5. 浅色、深色、强制颜色以及 180、240、300、360px 宽度下，无行高变化、横向滚动、文字遮挡或反馈残留。
6. 拖动取消、滚动、窗口 resize、目标关闭和 drop 失败后反馈全部清除。

- [ ] **Step 8：最终差异检查**

Run:

```powershell
git diff --check
git status --short
git diff -- src/sidepanel/tab-reorder-model.ts src/sidepanel/tab-tree-drop-model.ts src/sidepanel/tab-drag-controller.ts src/sidepanel/sidebar.css src/sidepanel/sidebar.ts tests/tab-tree-drop-model.test.ts tests/tab-drag-controller.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts docs/superpowers/specs/2026-08-09-tab-tree-depth-drag-collapse-design.md docs/adr/0002-tab-tree-manual-parent-overrides.md docs/chrome-web-store-checklist.md
```

Expected: `git diff --check` PASS；差异只包含本计划行为和执行前已存在的用户改动，没有版本升级、打包产物或无关重构。

## 完成标准

- 定位线唯一表达“成为目标同级”，整行高亮唯一表达“成为目标直接子节点”。
- Root/Child 四种来源与目标组合均有模型和 Sidebar 集成测试。
- 横向坐标、12px 吸附和 requested depth 从当前实现与当前设计文档中删除。
- after 与 child 均使用目标完整子树末端作为真实 Chrome 排序锚点。
- 完整子树移动、四级上限、循环拒绝、固定标签、原生分组、跨窗口和失败恢复保持有效。
- `dragover` 热路径不新增 Chrome 查询、完整 DOM 扫描或完整树重建。
- 完整 `npm run check` 通过；本计划不生成 ZIP。
