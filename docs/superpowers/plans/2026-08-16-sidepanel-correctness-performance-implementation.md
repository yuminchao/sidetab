# 侧栏正确性与性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除侧栏标签事件竞态和资源残留，降低批量标签更新、活动切换和重复排序的成本，并保证关闭分组按最新成员集合执行。

**Architecture:** `TabUpdateScheduler` 成为 `onUpdated` 的同步、可失效批处理边界；Sidebar 在其他生命周期事件发生时失效过期更新，并对一批有效更新做一次 favicon 同步和一次结构渲染。`TabStore` 维护安全的有序视图与活动标签 ID；树、会话和映射分别收紧其排序、迭代和清理职责。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3 API、原生 DOM、Vitest、JSDOM、esbuild

---

## 执行约束

- 在 `E:\java\sidebar` 当前未提交工作区执行，保留已有改动，不创建无法携带这些改动的新工作树。
- 不升级版本、不打包、不写 `update.log`；不新增权限、轮询、网络请求或后台任务。
- 每个生产代码改动必须先有对应失败测试；每个任务完成后运行指定聚焦测试。
- 未取得单独 Git 提交授权前，只修改文件和验证，不提交。

## 文件职责

- `src/sidepanel/tab-update-scheduler.ts`：保存、失效和同步 flush 最新标签更新。
- `src/sidepanel/tab-store.ts`：维护标签状态、有序安全快照和 O(1) 活动切换。
- `src/sidepanel/sidebar.ts`：把 Chrome 生命周期事件、批处理渲染和分组关闭接入上述边界。
- `src/sidepanel/tab-list-model.ts`、`src/sidepanel/tab-tree-model.ts`：消费已排序输入，迭代展开树。
- `src/sidepanel/tab-tree-session-store.ts`：合并连续会话持久化请求。
- `tests/*.test.ts`：以真实 Store/调度器和 Sidebar 假 Chrome 事件记录回归行为。

### Task 1: 可失效的标签更新调度器

**Files:**
- Modify: `src/sidepanel/tab-update-scheduler.ts`
- Modify: `tests/tab-update-scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

添加四个测试：`invalidate(id)` 在 flush 前丢弃该标签；`flushNow()` 只应用当前有效记录；同一 ID 只保留最后快照；flush 回调只能同步执行。

```ts
it("drops an invalidated update before the scheduled flush", async () => {
  const flush = vi.fn();
  const scheduler = createTabUpdateScheduler(flush);
  scheduler.schedule(1, { id: 1, title: "stale" } as chrome.tabs.Tab);
  scheduler.invalidate(1);
  await Promise.resolve();
  expect(flush).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/tab-update-scheduler.test.ts`

Expected: FAIL，因为尚未提供 `invalidate`。

- [ ] **Step 3: 最小实现版本屏障**

为每个 ID 保存 generation；`schedule` 写入当前 generation，`invalidate` 递增 generation 并删除 pending，`flushNow` 过滤 generation 相同的条目后同步调用 flush。删除 Promise 类型和任何被忽略的 rejection。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/tab-update-scheduler.test.ts`

Expected: PASS。

### Task 2: Sidebar 事件顺序与单批渲染

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写失败回归测试**

在 Sidebar 生命周期测试中新增 `updated -> removed`、`updated -> moved`、`updated -> activated`、`updated -> replaced`；每个场景在 `await flush()` 后断言 Store/行仍是同步事件的最终状态。增加多个不同 ID 更新同批时 favicon 同步一次、结构渲染一次的 spy 断言。

```ts
fake.events.onUpdated.emit(2, {}, fakeTab({ id: 2, title: "stale" }));
fake.events.onRemoved.emit(2, { windowId: 10, isWindowClosing: false });
await flush();
expect(rowIds()).not.toContain(2);
```

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，旧更新会回写或产生多次同步。

- [ ] **Step 3: 最小接入**

在 `removed`、`detached`、`moved`、`activated`、`replaced` 前调用调度器的 `invalidate`；替换同时失效 old/new ID。实现 `applyTabUpdates(tabs)`：顺序更新 Store，合并结构变更、行 patch 和 favicon 同步；每个 batch 最多一次完整渲染和一次 favicon 同步。保留缓冲重同步期间的既有顺序。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-update-scheduler.test.ts`

Expected: PASS。

### Task 3: 安全快照与常量级活动切换

**Files:**
- Modify: `src/sidepanel/tab-store.ts`
- Modify: `tests/tab-store.test.ts`

- [ ] **Step 1: 写失败测试**

添加测试，验证修改 snapshot 元素不会影响 `get/list`；验证重复激活当前 ID 不修改任何状态；验证切换只替换原活动和新活动对象，其他对象引用保持不变。

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/tab-store.test.ts`

Expected: FAIL，当前快照泄露内部对象且 activate 全量复制。

- [ ] **Step 3: 最小实现**

引入 `activeTabId`。`initialize` 与 `put` 维护它；`activate` 只更新两个可能变化的条目。`snapshot` 返回由 `copyTab` 形成的冻结只读视图，并保留有序缓存只在变更时重建；`list` 仍返回普通副本。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/tab-store.test.ts`

Expected: PASS。

### Task 4: 单一排序与迭代树展开

**Files:**
- Modify: `src/sidepanel/tab-list-model.ts`
- Modify: `src/sidepanel/tab-tree-model.ts`
- Modify: `tests/tab-list-model.test.ts`
- Modify: `tests/tab-tree-model.test.ts`

- [ ] **Step 1: 写失败测试**

传入具有既定顺序的只读快照，断言平面与树列表保留该顺序；构建超过默认调用栈深度的链，断言 `flattenVisibleTabForest` 仍返回完整序列与正确活动祖先。

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/tab-list-model.test.ts tests/tab-tree-model.test.ts`

Expected: FAIL，因为当前模型重新排序且 flatten 使用递归。

- [ ] **Step 3: 最小实现**

移除已排序输入上的复制排序，使用线性分区；以 `{ node, depth, rootId }` 显式栈替换 `flattenVisibleTabForest` 递归；以显式 enter/exit 栈替换循环检测和活动祖先递归，保持 child 输出顺序。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/tab-list-model.test.ts tests/tab-tree-model.test.ts`

Expected: PASS。

### Task 5: 会话和映射生命周期

**Files:**
- Modify: `src/sidepanel/tab-id-replacement.ts`
- Modify: `src/sidepanel/tab-tree-session-store.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/tab-id-replacement.test.ts`
- Modify: `tests/tab-tree-session-store.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写失败测试**

验证 replacement 映射在迁移窗口结束后删除所有参与键；分组移动完成计数归零后键被删除；延迟 `storage.session.set` 时连续三次 `save` 只持久化首个和最后一个状态。

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/tab-id-replacement.test.ts tests/tab-tree-session-store.test.ts tests/sidebar.test.ts`

Expected: FAIL，因为当前队列保留每次中间写入且零计数残留。

- [ ] **Step 3: 最小实现**

在迁移事务边界统一消费 replacement key；计数从一减到零时使用 `delete`；将会话写队列改成一个 in-flight Promise 与一个覆盖式 pending payload，当前写完后只发送最后 payload。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/tab-id-replacement.test.ts tests/tab-tree-session-store.test.ts tests/sidebar.test.ts`

Expected: PASS。

### Task 6: 关闭分组使用最新成员

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写失败测试**

右键打开分组菜单后，发出一个将新标签加入该分组的 `onUpdated`，不等待自然微任务 flush 就点击关闭；断言唯一 `tabs.remove` 参数包含所有成员。

- [ ] **Step 2: 运行 RED 测试**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，旧 Store 集合遗漏待处理成员。

- [ ] **Step 3: 最小实现**

在 close 命令读取成员前调用调度器 `flushNow()`，然后重新从 Store 收集成员并复用 `executeGroupCommand` 和单次 `groupActions.close`。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-group-actions.test.ts tests/tab-group-context-menu.test.ts`

Expected: PASS。

### Task 7: 全量验证与实机验收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-sidepanel-correctness-performance-design.md`（仅记录最终基准）

- [ ] **Step 1: 运行质量门禁**

Run: `npm run typecheck; npm test -- --run; npm run build; node scripts/check-dist.mjs; npm run benchmark:tabs`

Expected: 所有命令退出码为 0，记录 100/500 标签中位数、P95、DOM 节点数，且 500 标签结果优于设计基线或明确记录剩余窗口化需求。

- [ ] **Step 2: Chrome 实机验收**

加载当前 `dist` 后，创建至少一个含三成员的标签组；右键分组块选择“关闭分组”；确认所有成员关闭、菜单消失、无控制台错误。再验证刚加入分组的标签立即关闭不会遗漏。

- [ ] **Step 3: 最终差异检查**

Run: `git diff --check; git status --short`

Expected: 无空白错误；只包含本方案代码、测试与文档改动，以及原有未提交文件。
