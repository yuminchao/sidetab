# 标签存储性能与内存优化 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复侧边栏在大量标签场景下的三个技术问题：`TabStore.list()` 高频全量拷贝与排序、`onUpdated` 事件高频全量处理、`replacementTabIds` 无界增长。不改变任何用户可见行为。

**Architecture:** 保持现有"Chrome 事件为事实来源 + 内存快照 + 增量渲染"架构。方案 1 在 `TabStore` 内部增加有序缓存与零拷贝只读快照，事件路径改为 O(1) 查询；方案 2 针对 `onUpdated` 引入微任务合并窗口，渲染与 favicon 同步降频；方案 3 让 `replacementTabIds` 消费即删、树关闭清空，保证有界。每个方案独立实施、独立验证。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3 API、原生 DOM、Vitest、JSDOM、esbuild

---

## 实施前约束

- 工作目录：`E:\java\sidebar`（master 分支，代码已合入）。
- 开始编码前重新读取 `AGENTS.md`，并检查仓库内适用的 `docs/agents/` 文档。
- 当前工作树包含用户已有修改；不得回滚、覆盖或顺手整理范围外差异。
- 用户尚未授权 Git 提交。本计划各任务只执行测试和 `git diff --check`；若后续明确授权提交，再只提交对应任务文件。
- 本计划不升级版本、不写 `update.log`、不生成 ZIP。只有用户后续明确要求打包时，才按仓库规则进行敏感信息检查、版本升级、更新日志和打包验证。

## Task 1：replacementTabIds 有界化

**Files:**

- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：先写有界性失败测试**

在 `tests/sidebar.test.ts` 增加：

```ts
it("标签替换后迁移完成即删除旧 ID 映射", async () => {
  // 场景：树模式下 replaceTab 多次，验证迁移后 replacementTabIds 不增长
  // 通过重复执行 onReplaced 模拟，断言内部映射有界（可用导出或行为观察）
});

it("关闭内容树后清空 replacementTabIds", async () => {
  // 场景：开启内容树 → replaceTab → 关闭内容树 → 断言映射已清空
});
```

- [ ] **Step 2：消费即删**

在 `copyMigratedIds` / `copyMigratedParentIds`（sidebar.ts L2029-2050）迁移完成后，收集本次已消费的 removedId 键，批量 `replacementTabIds.delete(key)`（不在遍历中删除）。

- [ ] **Step 3：树关闭清空**

内容树关闭分支（sidebar.ts L494-500，`onSave` 中 `!saved.contentTreeEnabled` 分支）追加 `replacementTabIds.clear()`。

- [ ] **Step 4：验证**

```powershell
npm run typecheck
npm test -- --run tests/sidebar.test.ts
```

- [ ] **Step 5：全量回归**

```powershell
npm run check
```

## Task 2：TabStore 有序缓存与零拷贝快照

**Files:**

- Modify: `src/sidepanel/tab-store.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `src/sidepanel/tab-list-model.ts`
- Modify: `tests/tab-store.test.ts`
- Modify: `tests/sidebar.test.ts`
- Modify: `scripts/benchmark-tab-renderer.mjs`（可选，扩展基准）

- [ ] **Step 1：先写缓存失效矩阵测试**

在 `tests/tab-store.test.ts` 增加：

```ts
it.each([
  ["initialize", (store) => store.initialize([t1, t2])],
  ["add", (store) => store.add(t3)],
  ["update", (store) => store.update(1, { title: "x" })],
  ["remove", (store) => store.remove(2)],
  ["move", (store) => store.move(2, 0)],
  ["activate", (store) => store.activate(1)],
  ["replaceId", (store) => store.replaceId(2, t3)],
])("%s 后 list() 顺序正确", ...);

it("snapshot 返回只读视图，外部修改不影响 store", () => {
  const view = store.snapshot();
  (view[0] as TabViewModel).title = "hacked";
  expect(store.get(view[0].id)?.title).not.toBe("hacked");
});
```

- [ ] **Step 2：实现有序缓存**

`TabStore` 增加 `orderedCache: TabViewModel[] | undefined` 与 `markDirty()`；所有变更方法统一调用 `markDirty()`；`list()` 命中缓存只做 `map(copyTab)`，未命中排序并缓存；新增 `snapshot()` 返回缓存引用。

- [ ] **Step 3：事件路径 O(1) 化**

- `updated`（sidebar.ts L1667）：`tabStore.list()` 改为 `tabStore.get(tab.id)`；
- `activated`（L1700/L1706）：两次 `list()` 改为仅对受影响的标签 id 用 `get()`；
- `renderTabList`（L331）：`list()` 改为 `snapshot()`。

- [ ] **Step 4：移除双重排序**

`tab-list-model.ts` `buildTabListItems` 的 `orderedTabs = [...tabs].sort(compareTabs)` 移除（`snapshot()` 已按 pinned + index 排序），保留纯函数结构。

- [ ] **Step 5：验证**

```powershell
npm run typecheck
npm test -- --run tests/tab-store.test.ts tests/sidebar.test.ts tests/tab-list-model.test.ts
node scripts/benchmark-tab-renderer.mjs
```

- [ ] **Step 6：全量回归**

```powershell
npm run check
```

## Task 3：onUpdated 合并调度

**Files:**

- Add: `src/sidepanel/tab-update-scheduler.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/helpers/fake-chrome.ts`（增加 flush helper）
- Modify: `tests/sidebar.test.ts`
- Add: `tests/tab-update-scheduler.test.ts`

- [ ] **Step 1：先写合并调度失败测试**

新建 `tests/tab-update-scheduler.test.ts`：

```ts
it("同一微任务窗口多次 updated 只 flush 一次", async () => {
  // 同一窗口内 3 次 schedule，flush 只执行 1 次
});

it("flush 后标签不存在则跳过", async () => {
  // 模拟 flush 前标签被关闭
});
```

在 `tests/sidebar.test.ts` 增加事件风暴场景：同一微任务窗口多次 updated，最终状态正确、渲染次数受限。

- [ ] **Step 2：实现调度器**

新建 `tab-update-scheduler.ts`：`pendingTabUpdates` Map + `queueMicrotask` 合并窗口 + `flush()`。

- [ ] **Step 3：接入 updated 处理**

`tabEventHandlers.updated` 改为 `pendingTabUpdates.set(tab.id, tab)` + `scheduleTabUpdateFlush()`；`flushTabUpdates` 内对每个 tab 执行现有逻辑（`get()` 查 previous → `replace()` → `patchTab` 或 `renderTabList`），favicon 同步只在 flush 后执行一次。

- [ ] **Step 4：测试基建**

`fake-chrome.ts` 增加 `flushMicrotasks()` / `flushTabUpdates()` helper，供测试触发合并窗口落盘。

- [ ] **Step 5：验证**

```powershell
npm run typecheck
npm test -- --run tests/tab-update-scheduler.test.ts tests/sidebar.test.ts
```

- [ ] **Step 6：全量回归与基准**

```powershell
npm run check
node scripts/benchmark-tab-renderer.mjs
```

## 验证矩阵（全部任务完成后）

| 场景 | 预期 |
| --- | --- |
| `npm run check` | 全绿 |
| 500 标签 benchmark | 不劣于现状，updated 风暴场景提升 |
| 手工：批量开标签 | 首屏流畅，事件风暴无卡顿 |
| 手工：后台页面定时改标题 | 渲染合并，无明显重绘 |
| 手工：快速切换标签 / 拖拽大子树 | 行为不变 |
| 长时间运行 + 多次标签替换 + 树开关切换 | `replacementTabIds` 有界 |
