# 分组右键菜单新增“关闭分组” Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在分组标题行右键菜单“解散分组”下方新增“关闭分组”菜单项，一次批量关闭组内全部标签；组内无标签时菜单项禁用。

**Architecture:** 沿用现有分组右键菜单的命令分派、busy 门禁与错误重同步机制：菜单层新增 `close` 命令项与空组禁用回调，操作层新增 `groupActions.close`（`chrome.tabs.remove` 单次批量），sidebar 集成层复用 `executeGroupCommand`。不新增权限、不新增确认对话框。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3 API、原生 DOM、Vitest、JSDOM、esbuild

---

## 实施前约束

- 工作目录：`E:\java\sidebar`（master 分支，代码已合入；测试依赖在 `.worktrees\feature-side-panel-tabs`，源码改动后同步过去运行）。
- 开始编码前重新读取 `AGENTS.md`，并检查仓库内适用的 `docs/agents/` 文档。
- 当前工作树包含用户已有修改（P1 性能优化未提交）；不得回滚、覆盖或顺手整理范围外差异。
- 用户尚未授权 Git 提交。本计划各任务只执行测试和 `git diff --check`；若后续明确授权提交，再只提交对应任务文件。
- 本计划不升级版本、不写 `update.log`、不生成 ZIP。只有用户后续明确要求打包时，才按仓库规则进行敏感信息检查、版本升级、更新日志和打包验证。

## Task 1：操作层 groupActions.close

**Files:**

- Modify: `src/sidepanel/tab-group-actions.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/tab-group-actions.test.ts` 增加：

```ts
it("closes all group tab IDs in a single remove call", async () => {
  // 断言 tabs.remove 被调用一次，参数为 [1, 2, 3]
});

it("returns early for an empty group", async () => {
  // 空数组时不调用 tabs.remove
});

it("reports a stable error when removing fails", async () => {
  // remove 拒绝时抛出"无法关闭标签组"
});
```

- [ ] **Step 2：实现**

`TabGroupActions` 类型与实现增加：

```ts
close(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  try {
    await tabs.remove(tabIds);
  } catch (cause) {
    throw new Error("无法关闭标签组", { cause });
  }
}
```

- [ ] **Step 3：验证**

```powershell
npm run typecheck
npm test -- --run tests/tab-group-actions.test.ts
```

## Task 2：菜单层 close 命令项与空组禁用

**Files:**

- Modify: `src/sidepanel/tab-group-context-menu.ts`
- Modify: `tests/tab-group-context-menu.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/tab-group-context-menu.test.ts` 更新/增加：

- 菜单顺序断言更新为 `new-tab, rename, set-color, separator, dissolve, close`，文案含“关闭分组”。
- `dispatchMainCommand` 分派 `{ action: "close", groupId: 7 }`。
- `canCloseGroup` 返回 false 时 `close` 禁用，点击不触发命令。
- busy 时 `close` 与其他菜单项一起禁用。

- [ ] **Step 2：实现**

- `TabGroupContextCommand` 增加 `| { action: "close"; groupId: number }`。
- 创建 `close` 菜单项，追加在 `dissolve` 之后；`menu.append(..., dissolve, close)`。
- callbacks 增加 `canCloseGroup?(groupId): boolean`（默认 true）。
- `open` 中 `close.disabled = busy || !callbacks.canCloseGroup?.(group.id)`。
- `dispatchMainCommand` 允许 `close` action。

- [ ] **Step 3：验证**

```powershell
npm run typecheck
npm test -- --run tests/tab-group-context-menu.test.ts
```

## Task 3：sidebar 集成

**Files:**

- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/sidebar.test.ts` 增加：

```ts
it("closes all member tabs of a group from its context menu", async () => {
  // 右键分组 → 点击 close → 断言 tabs.remove 一次，参数为组内全部 ID
});

it("disables close-group when the group has no members", async () => {
  // 组内无标签时菜单项禁用
});

it("resyncs once and shows an error when closing a group fails", async () => {
  // remove 拒绝 → 错误消息 + 一次重同步
});
```

- [ ] **Step 2：实现**

`groupContextMenu` 回调：

- `canCloseGroup: (groupId) => tabStore.list().some((tab) => tab.groupId === groupId)`
- `onCommand` 增加 `close` 分支：取组内标签 ID，`executeGroupCommand(group.id, () => groupActions.close(tabIds))`。

- [ ] **Step 3：验证**

```powershell
npm run typecheck
npm test -- --run tests/sidebar.test.ts tests/tab-group-context-menu.test.ts tests/tab-group-actions.test.ts
```

## Task 4：全量回归

- [ ] 同步全部改动到 `.worktrees\feature-side-panel-tabs`。
- [ ] 运行：

```powershell
npm run check
```

- [ ] 基准 `node scripts/benchmark-tab-renderer.mjs` 无劣化。

## 验证矩阵

| 场景 | 预期 |
| --- | --- |
| 右键分组 → 关闭分组 | `tabs.remove` 一次，组内全部标签关闭 |
| 组内无标签 | “关闭分组”禁用 |
| 组 busy 期间 | “关闭分组”与其他菜单项一起禁用 |
| 关闭失败 | 稳定错误消息 + 一次完整重同步 |
| `npm run check` | 全绿 |
