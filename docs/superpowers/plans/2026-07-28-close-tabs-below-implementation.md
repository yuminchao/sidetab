# 关闭下方标签页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标签页右键菜单中增加高性能的“关闭下方标签页”，只批量关闭当前标签之后的普通标签，并发布 `0.5.0` 安装包。

**Architecture:** 新建纯函数模型，从 `TabStore.list()` 的当前显示顺序计算可关闭 ID；菜单通过布尔回调控制禁用状态并派发命令；动作层封装单次 `chrome.tabs.remove(ids)`；侧边栏在命令执行瞬间重新计算目标并沿用 Chrome 标签事件同步界面。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3、Vitest、JSDOM、Vite、PowerShell。

---

## 文件职责

- 新建 `src/sidepanel/tab-close-model.ts`：纯函数计算当前标签下方的普通标签 ID。
- 新建 `tests/tab-close-model.test.ts`：覆盖顺序、固定标签、缺失目标和空目标。
- 修改 `src/sidepanel/tab-actions.ts`：封装一次批量关闭及稳定错误文案。
- 修改 `tests/tab-actions.test.ts`：验证单次数组调用、空数组短路和失败映射。
- 修改 `src/sidepanel/tab-context-menu.ts`：新增菜单项、禁用状态、命令和跳过禁用项的键盘导航。
- 修改 `tests/tab-context-menu.test.ts`：验证菜单顺序、命令、禁用行为与键盘导航。
- 修改 `src/sidepanel/sidebar.ts`：以最新 `TabStore` 计算目标并调用批量动作。
- 修改 `tests/sidebar.test.ts`：覆盖普通/固定入口、最新顺序、失败、无目标和事件驱动更新。
- 修改 `manifest.json`、`package.json`、`package-lock.json`：发布版本升级为 `0.5.0`，权限保持不变。
- 修改 `README.md`、`docs/chrome-web-store-checklist.md`：补充中文功能说明与发布检查项。
- 修改 `tests/smoke.test.ts`：锁定 `0.5.0` 版本和发布包名称。

### Task 1: 关闭目标纯函数模型

**Files:**
- Create: `src/sidepanel/tab-close-model.ts`
- Create: `tests/tab-close-model.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试，明确输入采用当前显示顺序，不依赖 `index` 重新排序：

```ts
import { describe, expect, it } from "vitest";
import { getClosableTabsBelow } from "../src/sidepanel/tab-close-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

const tab = (id: number, pinned = false): TabViewModel => ({
  id,
  windowId: 1,
  index: id,
  title: String(id),
  url: `https://${id}.example/`,
  domain: `${id}.example`,
  active: false,
  pinned,
});

describe("getClosableTabsBelow", () => {
  it("returns only unpinned tabs after the current tab", () => {
    expect(getClosableTabsBelow([
      tab(1, true), tab(2), tab(3, true), tab(4), tab(5),
    ], 2)).toEqual([4, 5]);
  });

  it("returns an empty list for a missing or final target", () => {
    const tabs = [tab(1), tab(2)];
    expect(getClosableTabsBelow(tabs, 2)).toEqual([]);
    expect(getClosableTabsBelow(tabs, 99)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/tab-close-model.test.ts`

Expected: FAIL，提示无法解析 `tab-close-model` 或 `getClosableTabsBelow` 不存在。

- [ ] **Step 3: 写最小实现**

```ts
import type { TabViewModel } from "./tab-model";

export function getClosableTabsBelow(tabs: readonly TabViewModel[], tabId: number): number[] {
  const current = tabs.findIndex((tab) => tab.id === tabId);
  if (current < 0) return [];
  return tabs.slice(current + 1).filter((tab) => !tab.pinned).map((tab) => tab.id);
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/tab-close-model.test.ts`

Expected: 新增测试全部 PASS。

- [ ] **Step 5: 提交模型**

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，生成当前本地时间戳并提交：

```powershell
git add src/sidepanel/tab-close-model.ts tests/tab-close-model.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 新增关闭下方标签计算模型"
```

### Task 2: 批量标签关闭动作

**Files:**
- Modify: `src/sidepanel/tab-actions.ts`
- Modify: `tests/tab-actions.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/tab-actions.test.ts` 增加：

```ts
it("closes multiple tabs with one remove call", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  await createTabActions(tabApi({ remove })).closeMany([3, 4, 5]);
  expect(remove).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith([3, 4, 5]);
});

it("skips an empty bulk close", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const actions = createTabActions(tabApi({ remove }));
  await actions.closeMany([]);
  expect(remove).not.toHaveBeenCalled();
});

it("maps a bulk close failure", async () => {
  const remove = vi.fn().mockRejectedValue(new Error("chrome failure"));
  const actions = createTabActions(tabApi({ remove }));
  await expect(actions.closeMany([2, 3])).rejects.toThrow("无法关闭下方标签页");
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/tab-actions.test.ts`

Expected: FAIL，提示 `closeMany` 不存在。

- [ ] **Step 3: 写最小实现**

在 `createTabActions` 返回对象中增加：

```ts
async closeMany(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  try {
    await api.remove(tabIds);
  } catch {
    throw new Error("无法关闭下方标签页");
  }
},
```

- [ ] **Step 4: 运行动作层测试**

Run: `npm test -- --run tests/tab-actions.test.ts`

Expected: 全部 PASS，单标签 `close` 行为无回归。

- [ ] **Step 5: 提交动作层**

提交前读取 Git 规则并生成时间戳：

```powershell
git add src/sidepanel/tab-actions.ts tests/tab-actions.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 新增批量关闭标签动作"
```

### Task 3: 右键菜单命令和禁用导航

**Files:**
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1: 写菜单失败测试**

把菜单预期更新为四项，并增加 `canCloseBelow` 回调：

```ts
const callbacks = {
  getTab: (id: number) => tabs.find((tab) => tab.id === id),
  canCloseBelow: (id: number) => id === 1,
  onCommand,
};

expect(menuLabels()).toEqual([
  "复制标签页", "固定标签", "设为快捷网站", "关闭下方标签页",
]);

context(row(1));
closeBelowButton().click();
expect(onCommand).toHaveBeenCalledWith({ action: "close-below", tabId: 1 });

context(row(2));
expect(closeBelowButton().disabled).toBe(true);
closeBelowButton().click();
expect(onCommand).not.toHaveBeenCalledWith({ action: "close-below", tabId: 2 });
```

增加键盘断言：当第四项禁用时，从第三项按 `ArrowDown` 回到第一项；第四项可用时可被聚焦并通过 `Enter` 派发。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，缺少 `canCloseBelow`、第四菜单项或 `close-below` 命令。

- [ ] **Step 3: 实现菜单命令与可用状态**

扩展命令类型和回调：

```ts
export type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean }
  | { action: "add-shortcut"; tabId: number }
  | { action: "close-below"; tabId: number };

callbacks: {
  getTab(id: number): TabViewModel | undefined;
  canCloseBelow(id: number): boolean;
  onCommand(command: TabContextCommand): void;
}
```

创建并追加按钮，在 `open` 中执行 `closeBelow.disabled = !callbacks.canCloseBelow(tab.id)`，点击时派发 `{ action: "close-below", tabId: openTabId }`。

键盘导航每次读取：

```ts
const enabledItems = [duplicate, setPinned, addShortcut, closeBelow]
  .filter((item) => !item.disabled);
```

使用 `enabledItems` 计算当前项、上下方向循环和 `Enter`/空格点击，保证禁用项永远不会获得菜单键盘焦点。

- [ ] **Step 4: 运行菜单测试**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: 全部 PASS。

- [ ] **Step 5: 提交菜单层**

提交前读取 Git 规则并生成时间戳：

```powershell
git add src/sidepanel/tab-context-menu.ts tests/tab-context-menu.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 新增关闭下方标签菜单命令"
```

### Task 4: 侧边栏集成

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写集成失败测试**

增加一组混合固定状态标签，右键普通标签后执行命令：

```ts
const fake = createFakeChrome({ tabs: [
  fakeTab({ id: 1, index: 0, pinned: true }),
  fakeTab({ id: 2, index: 1, pinned: false }),
  fakeTab({ id: 3, index: 2, pinned: true }),
  fakeTab({ id: 4, index: 3, pinned: false }),
  fakeTab({ id: 5, index: 4, pinned: false }),
] });
const cleanup = await startSidebar(fake);
row(2).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
click(contextMenuItem("close-below"));
await flush();
expect(fake.methods.remove).toHaveBeenCalledOnce();
expect(fake.methods.remove).toHaveBeenCalledWith([4, 5]);
expect(rowIds()).toEqual([1, 3, 2, 4, 5]);
cleanup();
```

补充测试：

- 固定标签触发时保留后续固定标签。
- 最后一个普通标签的菜单项禁用，`remove` 不被调用。
- 菜单打开后触发 `onMoved`，点击命令使用移动后的最新顺序。
- `remove` 拒绝时状态区显示“无法关闭下方标签页”。
- 清理后异步拒绝不得改写状态。

- [ ] **Step 2: 运行集成测试并确认 RED**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，菜单构造缺少回调或未调用批量关闭动作。

- [ ] **Step 3: 接入最新状态计算**

导入模型：

```ts
import { getClosableTabsBelow } from "./tab-close-model";
```

在菜单回调中增加：

```ts
canCloseBelow: (id) => getClosableTabsBelow(tabStore.list(), id).length > 0,
```

在 `onCommand` 中优先处理批量关闭：

```ts
if (command.action === "close-below") {
  const ids = getClosableTabsBelow(tabStore.list(), command.tabId);
  runTabOperation(tabActions.closeMany(ids));
  return;
}
```

保持现有 `onRemoved` 事件作为唯一列表删除来源。

- [ ] **Step 4: 运行相关测试和类型检查**

Run: `npm test -- --run tests/tab-close-model.test.ts tests/tab-actions.test.ts tests/tab-context-menu.test.ts tests/sidebar.test.ts`

Expected: 全部 PASS。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交侧边栏集成**

提交前读取 Git 规则并生成时间戳：

```powershell
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 接入关闭下方标签页操作"
```

### Task 5: 发布 `0.5.0`

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1: 先更新发布测试并确认 RED**

把 `tests/smoke.test.ts` 的版本断言和 README 包名更新为 `0.5.0`：

```ts
expect(manifest.version).toBe("0.5.0");
expect(packageJson.version).toBe("0.5.0");
expect(packageLock.version).toBe("0.5.0");
expect(packageLock.packages[""].version).toBe("0.5.0");
expect(readme).toContain("release/sidetab-lite-0.5.0.zip");
```

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前元数据仍为 `0.4.0`。

- [ ] **Step 2: 升级版本和中文文档**

Run: `npm version 0.5.0 --no-git-tag-version`

修改 `manifest.json` 为 `0.5.0`；权限继续精确保持：

```json
["sidePanel", "tabs", "storage", "history"]
```

README 增加“右键关闭当前标签下方普通标签，保留固定标签”说明，并把包名改为 `release/sidetab-lite-0.5.0.zip`。商店清单增加菜单顺序、禁用状态、批量关闭边界和失败反馈检查项。

- [ ] **Step 3: 运行发布测试和完整打包**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: 全部 PASS。

Run: `npm run package`

Expected: 类型检查通过，全部测试通过，`dist` 审计通过，生成 `release/sidetab-lite-0.5.0.zip`。

- [ ] **Step 4: 审计 ZIP**

使用 PowerShell `System.IO.Compression.ZipFile` 检查 ZIP 根目录精确包含 11 个文件，`manifest.json` 版本为 `0.5.0`，权限为 `sidePanel,tabs,storage,history`，且无源码、source map、测试或预览 mock。计算 SHA-256。

- [ ] **Step 5: 浏览器视觉验收**

使用内置浏览器加载构建后的侧边栏预览，在常规宽度和浏览器可测最窄宽度验证：

- 四项右键菜单不溢出。
- “关闭下方标签页”有可关闭目标时可用，无目标时置灰。
- 方向键跳过置灰项。
- 控制台无相关错误或警告。

- [ ] **Step 6: 提交发布变更**

提交前读取 Git 规则并生成时间戳：

```powershell
git add manifest.json package.json package-lock.json README.md docs/chrome-web-store-checklist.md tests/smoke.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 发布关闭下方标签页 0.5.0"
```

### Task 6: 最终独立验证

**Files:**
- Verify only

- [ ] **Step 1: 从提交后状态重新打包**

Run: `npm run package`

Expected: 全部测试、类型检查、构建、`dist` 审计和 ZIP 自验通过。

- [ ] **Step 2: 检查提交与工作区**

Run: `git status --short`

Expected: 无输出。

Run: `git log -6 --oneline`

Expected: 包含模型、动作、菜单、侧边栏集成和 `0.5.0` 发布提交。

- [ ] **Step 3: 报告交付信息**

报告 ZIP 绝对路径、SHA-256、测试数量、版本、权限、视觉验收结果和仍需在真实 Chrome 中执行的“加载已解压扩展”冒烟检查。
