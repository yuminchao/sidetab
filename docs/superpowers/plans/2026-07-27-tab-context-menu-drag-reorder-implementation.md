# 标签右键菜单与拖动排序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 为当前窗口标签列表增加自定义右键菜单、同步 Chrome 的拖动排序和快捷入口分割线，并将发布版本从 `0.1.0` 提升到 `0.2.0`。

**架构：** 使用纯函数 `tab-reorder-model` 计算最终绝对索引，`tab-drag-controller` 只管理原生拖放状态，`tab-context-menu` 只管理菜单 DOM 与命令分发，所有 Chrome API 继续集中在 `tab-actions`。侧边栏协调这些模块，并继续以 Chrome 标签事件作为最终状态来源，不保存第二份排序。

**技术栈：** TypeScript、Chrome Extensions Manifest V3、DOM API、原生 HTML Drag and Drop、Vitest、jsdom、Vite、fflate。

**设计依据：** `docs/superpowers/specs/2026-07-27-tab-context-menu-drag-reorder-design.md`

---

## 文件结构

- 新建 `src/sidepanel/tab-reorder-model.ts`：纯函数计算拖动后的固定状态和绝对目标索引。
- 新建 `src/sidepanel/tab-drag-controller.ts`：委托式处理拖放事件和插入线状态。
- 新建 `src/sidepanel/tab-context-menu.ts`：创建唯一菜单、定位、键盘交互和命令分发。
- 修改 `src/sidepanel/tab-actions.ts`：增加复制、固定切换和排序动作。
- 修改 `src/sidepanel/tab-renderer.ts`：为标签行维护 `draggable`、搜索禁用提示和排序状态所需数据。
- 修改 `src/sidepanel/sidebar.ts`：协调菜单、拖动、动作、搜索状态和清理生命周期。
- 修改 `src/sidepanel/sidebar.css`：菜单、拖动源行、插入线、分割线及深色主题样式。
- 修改 `tests/helpers/fake-chrome.ts`：提供 `duplicate` 和 `move` 假实现。
- 新建对应测试 `tests/tab-reorder-model.test.ts`、`tests/tab-drag-controller.test.ts`、`tests/tab-context-menu.test.ts`。
- 修改 `tests/tab-actions.test.ts`、`tests/tab-renderer.test.ts`、`tests/sidebar.test.ts`、`tests/sidepanel-css.test.ts`、`tests/smoke.test.ts` 和 `tests/release-scripts.test.ts`。
- 修改 `package.json`、`package-lock.json`、`manifest.json` 和 `docs/chrome-web-store-checklist.md`：发布 `0.2.0` 并补充人工验收项。

### Task 1：实现排序计划纯模型

**文件：**
- 新建：`src/sidepanel/tab-reorder-model.ts`
- 新建：`tests/tab-reorder-model.test.ts`

- [ ] **Step 1：编写失败测试，覆盖同组、跨组和边界索引**

```ts
import { describe, expect, it } from "vitest";
import { createTabReorderPlan } from "../src/sidepanel/tab-reorder-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function fakeTabModel(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "标签",
    url: "https://example.com/",
    domain: "example.com",
    active: false,
    pinned: false,
    ...overrides,
  };
}

describe("tab reorder model", () => {
  it("moves an ordinary tab before another ordinary tab", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0 }),
      fakeTabModel({ id: 2, index: 1 }),
      fakeTabModel({ id: 3, index: 2 }),
    ];
    expect(createTabReorderPlan(tabs, 3, 2, "before")).toEqual({
      tabId: 3,
      targetIndex: 1,
      targetPinned: false,
      pinnedChanged: false,
    });
  });

  it("pins an ordinary tab dropped after a pinned target", () => {
    const tabs = [
      fakeTabModel({ id: 1, index: 0, pinned: true }),
      fakeTabModel({ id: 2, index: 1, pinned: false }),
    ];
    expect(createTabReorderPlan(tabs, 2, 1, "after")).toEqual({
      tabId: 2,
      targetIndex: 1,
      targetPinned: true,
      pinnedChanged: true,
    });
  });

  it("returns undefined for an unchanged or invalid drop", () => {
    const tabs = [fakeTabModel({ id: 1, index: 0 })];
    expect(createTabReorderPlan(tabs, 1, 1, "before")).toBeUndefined();
    expect(createTabReorderPlan(tabs, 99, 1, "before")).toBeUndefined();
  });
});
```

- [ ] **Step 2：运行测试确认 RED**

运行：`npm test -- --run tests/tab-reorder-model.test.ts`

预期：失败，提示无法导入 `tab-reorder-model`。

- [ ] **Step 3：实现最小纯函数**

```ts
import type { TabViewModel } from "./tab-model";

export type DropPlacement = "before" | "after";

export type TabReorderPlan = {
  tabId: number;
  targetIndex: number;
  targetPinned: boolean;
  pinnedChanged: boolean;
};

export function createTabReorderPlan(
  tabs: readonly TabViewModel[],
  sourceId: number,
  targetId: number,
  placement: DropPlacement,
): TabReorderPlan | undefined {
  if (sourceId === targetId) return undefined;
  const ordered = [...tabs].sort((a, b) => a.index - b.index || a.id - b.id);
  const source = ordered.find((tab) => tab.id === sourceId);
  const target = ordered.find((tab) => tab.id === targetId);
  if (!source || !target) return undefined;

  const remaining = ordered.filter((tab) => tab.id !== sourceId);
  const targetPosition = remaining.findIndex((tab) => tab.id === targetId);
  const insertion = targetPosition + (placement === "after" ? 1 : 0);
  const finalOrder = [...remaining];
  finalOrder.splice(insertion, 0, { ...source, pinned: target.pinned });
  const targetIndex = finalOrder.findIndex((tab) => tab.id === sourceId);
  if (source.index === targetIndex && source.pinned === target.pinned) return undefined;
  return {
    tabId: source.id,
    targetIndex,
    targetPinned: target.pinned,
    pinnedChanged: source.pinned !== target.pinned,
  };
}
```

- [ ] **Step 4：补齐向上、向下、首尾、固定转普通、交界两侧和非连续输入索引测试**

测试必须断言：放在最后一个固定标签之后仍固定；放在第一个普通标签之前变为普通；输入数组不被修改。

- [ ] **Step 5：运行测试并提交**

运行：`npm test -- --run tests/tab-reorder-model.test.ts && npm run typecheck`

预期：全部通过。

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，使用当时本地时间生成消息：

```text
yyyyMMddHHmmss feat 新增标签拖动排序计划模型
```

### Task 2：扩展 Chrome 标签动作

**文件：**
- 修改：`src/sidepanel/tab-actions.ts`
- 修改：`tests/tab-actions.test.ts`
- 修改：`tests/helpers/fake-chrome.ts`

- [ ] **Step 1：为复制、固定和排序写失败测试**

```ts
const api = {
  update: vi.fn().mockResolvedValue(tab),
  remove: vi.fn().mockResolvedValue(undefined),
  duplicate: vi.fn().mockResolvedValue(tab),
  move: vi.fn().mockResolvedValue(tab),
};
const actions = createTabActions(api);

await actions.duplicate(7);
expect(api.duplicate).toHaveBeenCalledWith(7);

await actions.setPinned(7, true);
expect(api.update).toHaveBeenCalledWith(7, { pinned: true });

await actions.reorder({
  tabId: 7,
  targetIndex: 2,
  targetPinned: true,
  pinnedChanged: true,
});
expect(api.update).toHaveBeenCalledWith(7, { pinned: true });
expect(api.move).toHaveBeenCalledWith(7, { index: 2 });
expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(api.move.mock.invocationCallOrder[0]);
```

另写拒绝测试，分别断言“无法复制该标签页”“无法更新标签固定状态”“无法移动该标签页”，以及跨组第一步失败后 `move` 未调用。

- [ ] **Step 2：运行测试确认 RED**

运行：`npm test -- --run tests/tab-actions.test.ts`

预期：失败，提示动作或 API 依赖缺失。

- [ ] **Step 3：实现动作并扩展假 Chrome**

```ts
export type TabsActionApi = Pick<
  typeof chrome.tabs,
  "update" | "remove" | "duplicate" | "move"
>;

async duplicate(tabId: number): Promise<void> {
  try { await api.duplicate(tabId); }
  catch { throw new Error("无法复制该标签页"); }
},

async setPinned(tabId: number, pinned: boolean): Promise<void> {
  try { await api.update(tabId, { pinned }); }
  catch { throw new Error("无法更新标签固定状态"); }
},

async reorder(plan: TabReorderPlan): Promise<void> {
  if (plan.pinnedChanged) {
    try { await api.update(plan.tabId, { pinned: plan.targetPinned }); }
    catch { throw new Error("无法更新标签固定状态"); }
  }
  try { await api.move(plan.tabId, { index: plan.targetIndex }); }
  catch { throw new Error("无法移动该标签页"); }
},
```

在 `createFakeChrome` 中新增 `duplicate`、`move` mock，并同时暴露到 `tabs` 和 `methods`。

- [ ] **Step 4：运行测试并提交**

运行：`npm test -- --run tests/tab-actions.test.ts tests/sidebar.test.ts && npm run typecheck`

预期：全部通过，现有激活与关闭行为不回退。

提交消息：`yyyyMMddHHmmss feat 扩展标签复制固定与排序动作`

### Task 3：实现拖动控制器和标签可拖状态

**文件：**
- 新建：`src/sidepanel/tab-drag-controller.ts`
- 新建：`tests/tab-drag-controller.test.ts`
- 修改：`src/sidepanel/tab-renderer.ts`
- 修改：`tests/tab-renderer.test.ts`

- [ ] **Step 1：编写控制器失败测试**

```ts
const intents: unknown[] = [];
const controller = createTabDragController(
  { list },
  { onDrop: (intent) => intents.push(intent) },
);

dispatchDrag(row(3), "dragstart");
dispatchDrag(row(2), "dragover", { clientY: row(2).getBoundingClientRect().top + 1 });
expect(row(2).dataset.dropPlacement).toBe("before");
dispatchDrag(row(2), "drop");
expect(intents).toEqual([{ sourceId: 3, targetId: 2, placement: "before" }]);
expect(list.querySelector("[data-drop-placement]")).toBeNull();
```

补充测试：目标下半区产生 `after`；关闭按钮起拖被阻止；同一行、无目标、取消和销毁不分发；`dragover` 多次只更新状态且不调用动作。

- [ ] **Step 2：为渲染器的搜索禁拖写失败测试**

```ts
renderer.render([tab]);
expect(row(tab.id).draggable).toBe(true);
renderer.setDragEnabled(false);
expect(row(tab.id).draggable).toBe(false);
expect(row(tab.id).title).toBe("清空搜索后可排序");
renderer.render([tab]);
expect(row(tab.id).draggable).toBe(false);
renderer.setDragEnabled(true);
expect(row(tab.id).title).toBe("");
```

- [ ] **Step 3：运行测试确认 RED**

运行：`npm test -- --run tests/tab-drag-controller.test.ts tests/tab-renderer.test.ts`

预期：失败，提示控制器和 `setDragEnabled` 不存在。

- [ ] **Step 4：实现委托式拖动控制器**

```ts
export type TabDropIntent = {
  sourceId: number;
  targetId: number;
  placement: DropPlacement;
};

export function createTabDragController(
  { list }: { list: HTMLElement },
  { onDrop }: { onDrop(intent: TabDropIntent): void },
) {
  let sourceId: number | undefined;
  let targetRow: HTMLElement | undefined;

  const rowFrom = (target: EventTarget | null): HTMLElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(".tab-row[data-tab-id]");
    return row && list.contains(row) ? row : undefined;
  };

  const idFrom = (row: HTMLElement): number | undefined => {
    const id = Number(row.dataset.tabId);
    return Number.isInteger(id) ? id : undefined;
  };

  const clear = () => {
    targetRow?.removeAttribute("data-drop-placement");
    findRow(list, sourceId)?.removeAttribute("data-drag-source");
    sourceId = undefined;
    targetRow = undefined;
  };

  const onDragStart = (event: DragEvent): void => {
    const row = rowFrom(event.target);
    if (!row?.draggable || (event.target instanceof Element && event.target.closest(".tab-close"))) {
      event.preventDefault();
      return;
    }
    sourceId = idFrom(row);
    if (sourceId === undefined) return;
    row.dataset.dragSource = "true";
    event.dataTransfer?.setData("text/plain", String(sourceId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (event: DragEvent): void => {
    const row = rowFrom(event.target);
    const targetId = row ? idFrom(row) : undefined;
    if (sourceId === undefined || !row || targetId === undefined || targetId === sourceId) return;
    event.preventDefault();
    if (targetRow !== row) targetRow?.removeAttribute("data-drop-placement");
    targetRow = row;
    const placement: DropPlacement = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
      ? "before"
      : "after";
    row.dataset.dropPlacement = placement;
  };

  const onDropEvent = (event: DragEvent): void => {
    const row = rowFrom(event.target);
    const targetId = row ? idFrom(row) : undefined;
    const placement = row?.dataset.dropPlacement;
    if (sourceId !== undefined && targetId !== undefined && sourceId !== targetId && (placement === "before" || placement === "after")) {
      event.preventDefault();
      onDrop({ sourceId, targetId, placement });
    }
    clear();
  };

  const onDragEnd = (): void => clear();
  list.addEventListener("dragstart", onDragStart);
  list.addEventListener("dragover", onDragOver);
  list.addEventListener("drop", onDropEvent);
  list.addEventListener("dragend", onDragEnd);

  return {
    cancel: clear,
    destroy() {
      clear();
      list.removeEventListener("dragstart", onDragStart);
      list.removeEventListener("dragover", onDragOver);
      list.removeEventListener("drop", onDropEvent);
      list.removeEventListener("dragend", onDragEnd);
    },
  };
}
```

`tab-renderer` 增加内部 `dragEnabled` 状态和 `setDragEnabled(enabled)`；渲染或 patch 行时同步 `row.draggable` 与搜索禁用提示。

- [ ] **Step 5：运行测试并提交**

运行：`npm test -- --run tests/tab-drag-controller.test.ts tests/tab-renderer.test.ts && npm run typecheck`

预期：全部通过。

提交消息：`yyyyMMddHHmmss feat 新增标签拖动交互控制器`

### Task 4：实现自定义右键菜单

**文件：**
- 新建：`src/sidepanel/tab-context-menu.ts`
- 新建：`tests/tab-context-menu.test.ts`

- [ ] **Step 1：编写菜单生命周期和命令失败测试**

```ts
const commands: unknown[] = [];
const menu = createTabContextMenu(
  { document, list, viewport: window },
  {
    getTab: (id) => tabs.find((tab) => tab.id === id),
    onCommand: (command) => commands.push(command),
  },
);

dispatchContextMenu(row(7), { clientX: 170, clientY: 700 });
const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
expect(popup.hidden).toBe(false);
expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
expect(popup.textContent).toContain("复制标签页");
expect(popup.textContent).toContain("固定标签");

click(menuItem("duplicate"));
expect(commands).toEqual([{ action: "duplicate", tabId: 7 }]);
```

补充测试：固定标签显示“取消固定”；`Shift+F10` 打开；方向键循环焦点；`Enter`、空格执行；`Esc`、外部点击、列表滚动、resize、`closeForTab` 和 destroy 关闭；全程只存在一个菜单节点。

- [ ] **Step 2：运行测试确认 RED**

运行：`npm test -- --run tests/tab-context-menu.test.ts`

预期：失败，提示模块不存在。

- [ ] **Step 3：实现菜单模块**

```ts
export type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean };

export function createTabContextMenu(
  elements: { document: Document; list: HTMLElement; viewport: Window },
  callbacks: {
    getTab(id: number): TabViewModel | undefined;
    onCommand(command: TabContextCommand): void;
  },
) {
  const menu = elements.document.createElement("div");
  menu.className = "tab-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  elements.document.body.append(menu);
  let openTabId: number | undefined;

  const duplicate = createItem("duplicate", "复制标签页");
  const pinned = createItem("set-pinned", "固定标签");
  menu.append(duplicate, pinned);

  function createItem(action: string, label: string): HTMLButtonElement {
    const button = elements.document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.dataset.menuAction = action;
    button.textContent = label;
    return button;
  }

  function close(): void {
    menu.hidden = true;
    openTabId = undefined;
  }

  function open(tab: TabViewModel, x: number, y: number): void {
    openTabId = tab.id;
    pinned.textContent = tab.pinned ? "取消固定" : "固定标签";
    pinned.dataset.nextPinned = String(!tab.pinned);
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, elements.viewport.innerWidth - rect.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, elements.viewport.innerHeight - rect.height))}px`;
    duplicate.focus();
  }

  function closeForTab(tabId: number): void {
    if (openTabId === tabId) close();
  }

  const onMenuClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-menu-action]")
      : null;
    if (!button || openTabId === undefined) return;
    const command: TabContextCommand = button.dataset.menuAction === "duplicate"
      ? { action: "duplicate", tabId: openTabId }
      : { action: "set-pinned", tabId: openTabId, pinned: button.dataset.nextPinned === "true" };
    close();
    callbacks.onCommand(command);
  };

  const onContextMenu = (event: MouseEvent): void => {
    const row = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".tab-row[data-tab-id]")
      : null;
    const tabId = Number(row?.dataset.tabId);
    const tab = Number.isInteger(tabId) ? callbacks.getTab(tabId) : undefined;
    if (!row || !tab || !elements.list.contains(row)) return;
    event.preventDefault();
    open(tab, event.clientX, event.clientY);
  };

  menu.addEventListener("click", onMenuClick);
  elements.list.addEventListener("contextmenu", onContextMenu);

  return {
    close,
    closeForTab,
    destroy() {
      close();
      menu.removeEventListener("click", onMenuClick);
      elements.list.removeEventListener("contextmenu", onContextMenu);
      menu.remove();
    },
  };
}
```

在同一实现步骤中加入文档级 `pointerdown`、列表 `scroll`、窗口 `resize` 和菜单 `keydown` 监听器；`keydown` 明确处理方向键循环、`Enter`、空格和 `Esc`，并在 `destroy` 中逐一移除。列表 `keydown` 处理 `Shift+F10`，锚点使用目标行矩形左下角。

- [ ] **Step 4：运行测试并提交**

运行：`npm test -- --run tests/tab-context-menu.test.ts && npm run typecheck`

预期：全部通过。

提交消息：`yyyyMMddHHmmss feat 新增标签右键操作菜单`

### Task 5：集成侧边栏、样式和快捷入口分割线

**文件：**
- 修改：`src/sidepanel/sidebar.ts`
- 修改：`src/sidepanel/sidebar.css`
- 修改：`tests/sidebar.test.ts`
- 修改：`tests/sidepanel-css.test.ts`

- [ ] **Step 1：编写集成失败测试**

新增测试验证：

```ts
contextMenu(row(7));
click(document.querySelector("[data-menu-action='duplicate']")!);
await flush();
expect(fake.methods.duplicate).toHaveBeenCalledWith(7);

contextMenu(row(7));
click(document.querySelector("[data-menu-action='set-pinned']")!);
await flush();
expect(fake.methods.update).toHaveBeenCalledWith(7, { pinned: true });

dispatchDrop({ sourceId: 3, targetId: 1, placement: "after" });
await flush();
expect(fake.methods.update).toHaveBeenCalledWith(3, { pinned: true });
expect(fake.methods.move).toHaveBeenCalledWith(3, { index: 1 });
```

补充断言：搜索输入立即把行设为不可拖；清空并完成 debounce 后恢复；排序进行中拒绝第二次拖动；失败文本正确；移除目标标签关闭菜单；cleanup 移除菜单和拖动监听器。

- [ ] **Step 2：编写 CSS 失败测试**

```ts
expect(css).toMatch(/\.shortcut-strip[^}]*border-bottom:\s*1px solid/s);
expect(css).toMatch(/\.tab-context-menu\s*\{/);
expect(css).toMatch(/\[data-drop-placement="before"\]/);
expect(css).toMatch(/\[data-drop-placement="after"\]/);
expect(css).toMatch(/\[data-drag-source="true"\]/);
```

同时断言快捷入口 `[hidden]` 规则优先，关闭时不保留边框空间。

- [ ] **Step 3：运行测试确认 RED**

运行：`npm test -- --run tests/sidebar.test.ts tests/sidepanel-css.test.ts`

预期：失败，菜单和拖动尚未接入侧边栏，CSS 规则不存在。

- [ ] **Step 4：接入模块和异步状态**

```ts
const contextMenu = createTabContextMenu(
  { document: deps.document, list: elements.list, viewport: deps.document.defaultView! },
  {
    getTab: (id) => tabStore.list().find((tab) => tab.id === id),
    onCommand: (command) => {
      const operation = command.action === "duplicate"
        ? tabActions.duplicate(command.tabId)
        : tabActions.setPinned(command.tabId, command.pinned);
      runOperation(operation);
    },
  },
);

const dragController = createTabDragController(
  { list: elements.list },
  {
    onDrop(intent) {
      const plan = createTabReorderPlan(
        tabStore.list(), intent.sourceId, intent.targetId, intent.placement,
      );
      if (plan) runReorder(plan);
    },
  },
);
```

抽取现有操作代次处理为小型内部函数，保留“较新操作覆盖较旧状态”的行为。排序开始时设置 busy 并禁拖，`finally` 恢复；搜索输入时立即调用 `tabRenderer.setDragEnabled(elements.search.value.trim() === "" && !reorderBusy)`。

- [ ] **Step 5：添加样式**

```css
.shortcut-strip {
  border-bottom: 1px solid var(--divider-color);
}

.shortcut-strip[hidden] {
  display: none;
}

.tab-context-menu {
  position: fixed;
  z-index: 20;
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.tab-row[data-drop-placement="before"]::before,
.tab-row[data-drop-placement="after"]::after {
  content: "";
  position: absolute;
  inset-inline: 4px;
  height: 2px;
  background: var(--accent-color);
}

.tab-row[data-drag-source="true"] {
  opacity: 0.55;
}
```

分割线和菜单边框使用系统色 `ButtonBorder`，插入线使用 `AccentColor`，菜单背景使用 `Canvas`，因此无需新增颜色变量；深色模式由 `color-scheme` 和系统色自动适配。

- [ ] **Step 6：运行集成和全量测试并提交**

运行：`npm test -- --run tests/sidebar.test.ts tests/sidepanel-css.test.ts tests/tab-context-menu.test.ts tests/tab-drag-controller.test.ts && npm run typecheck`

预期：全部通过。

提交消息：`yyyyMMddHHmmss feat 集成标签菜单拖动与快捷区分割线`

### Task 6：提升版本、更新发布检查并生成 0.2.0 包

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`manifest.json`
- 修改：`tests/smoke.test.ts`
- 修改：`tests/release-scripts.test.ts`
- 修改：`docs/chrome-web-store-checklist.md`
- 生成（忽略）：`dist/**`
- 生成（忽略）：`release/sidetab-lite-0.2.0.zip`

- [ ] **Step 1：编写版本一致性失败测试**

```ts
it("keeps the npm and extension release versions aligned at 0.2.0", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.version).toBe("0.2.0");
  expect(packageJson.version).toBe("0.2.0");
  expect(packageLock.version).toBe("0.2.0");
  expect(packageLock.packages[""].version).toBe("0.2.0");
});
```

发布脚本测试使用 `0.2.0` fixture，并断言 `packageDist` 生成 `sidetab-lite-0.2.0.zip`。

- [ ] **Step 2：运行测试确认 RED**

运行：`npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

预期：失败，当前版本仍为 `0.1.0`。

- [ ] **Step 3：将所有发布版本提升到 0.2.0**

使用 `npm version 0.2.0 --no-git-tag-version` 同步 `package.json` 和 `package-lock.json`，再将 `manifest.json` 的 `version` 改为 `0.2.0`。不得创建 npm Git tag。

- [ ] **Step 4：更新中文发布检查清单**

新增人工检查项：

- 右键菜单的复制、固定、取消固定及键盘关闭。
- 同组和跨组拖动、搜索时禁拖、Chrome 顶部真实顺序同步。
- 快捷入口开启时的通栏分割线及关闭时零占位。
- 180px 下菜单不溢出，浅色和深色插入线可辨识。
- 权限仍只有 `sidePanel`、`tabs`、`storage`。

- [ ] **Step 5：运行完整验证和打包**

运行：

```powershell
npm run package
git diff --check
Get-FileHash -Algorithm SHA256 release\sidetab-lite-0.2.0.zip
```

预期：类型检查、全部测试、构建、dist 审计和 ZIP 自验通过；`dist` 与 ZIP 仍精确包含 11 个审核文件；生成 `release/sidetab-lite-0.2.0.zip`。

- [ ] **Step 6：执行浏览器视觉和交互验收**

在 180、240、300、360px 宽度及浅色、深色主题下验证：菜单视口约束、复制标签、固定切换、同组/跨组拖动、插入线、搜索禁拖、分割线和底栏固定。记录控制台错误；若 Chrome 扩展后端不可用，明确记录原因并使用带 Chrome API fixture 的 Playwright 回退。

- [ ] **Step 7：提交发布变更**

提交前重新读取 Git 规则，提交消息：

```text
yyyyMMddHHmmss feat 发布标签菜单与拖动排序 0.2.0
```

### Task 7：最终独立审查与分支收尾

**文件：**
- 审查：`f30cd25..HEAD`
- 验证：所有本次修改和生成包

- [ ] **Step 1：独立审查规格符合性**

逐条核对右键菜单、跨组语义、搜索禁拖、性能调用上限、分割线、权限不扩张和版本 `0.2.0`。发现问题必须先补失败测试再修复。

- [ ] **Step 2：独立审查代码质量**

重点检查事件监听器清理、菜单焦点、拖动取消、标签事件竞态、索引计算、500 标签性能、错误状态代次和发布包确定性。

- [ ] **Step 3：执行最终新鲜验证**

运行：`npm run package`、`git diff --check`、ZIP 条目与 dist 逐字节比较、`git status --short`。

预期：所有命令成功，工作树干净，最终包为 `release/sidetab-lite-0.2.0.zip`。

- [ ] **Step 4：按 finishing-a-development-branch 流程交付**

确认分支基线后，向用户提供本地合并、推送 PR、保留分支或放弃四个选项；未经选择不自动合并或删除 worktree。
