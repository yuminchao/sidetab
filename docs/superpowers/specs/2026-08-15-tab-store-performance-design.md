# 标签存储性能与内存优化设计

日期：2026-08-15

## 目标

本次改动针对侧边栏在大量标签（约 500 个）场景下的三个已确认技术问题，不改变任何用户可见行为：

1. **P1-1 高频全量拷贝与排序**：`TabStore.list()` 每次调用都执行 O(n log n) 排序和 O(n) 对象拷贝，在事件处理路径上被大量调用，批量标签更新时呈 O(n²) 累积。
2. **P1-2 onUpdated 高频全量处理**：Chrome `tabs.onUpdated` 对每个标签的每次属性变化都触发，现有处理每次执行全量拷贝、可能触发全量重渲染和全量 favicon 签名计算。
3. **P1-3 replacementTabIds 无界增长**：`replacementTabIds` Map 只有一个写入点、从不清理，长期运行后无限累积，构成内存泄漏。

设计要求保持现有架构与安全契约：store 仍返回副本防止外部篡改、Chrome 事件仍是状态唯一事实来源、不新增权限/轮询/长期缓存/后台任务，且每个方案可独立实施、独立验证、独立合入。

## 现状分析

### 事件处理路径的代价构成

以 `updated` 事件（sidebar.ts `tabEventHandlers.updated`）为例，每次 Chrome `onUpdated` 触发时：

1. `tabStore.list()` —— O(n log n) 排序 + O(n) 拷贝，仅用于查找 previous；
2. `tabStore.replace(tab)` —— 若 index 变化则 `remove + insert`，O(n) 位移；
3. 若 index/groupId/pinned 变化则 `renderTabList()` —— `buildTabListItems` 全量重建列表项（树模式下还 `buildTabForest`）；
4. 无论是否渲染都执行 `syncShortcutFavicons()` —— 全量 URL 解析 + `localeCompare` 排序 + `JSON.stringify` 签名。

`sidebar.ts` 中共有 26 处 `tabStore.list()` 调用、13 处 `renderTabList()` 调用、5 处 `syncShortcutFavicons()` 调用，全部集中在事件处理路径上。

### replacementTabIds 的生命周期

- `replacementTabIds`（sidebar.ts L221）唯一写入点 L1592 `replacementTabIds.set(removedTabId, tab.id)`；
- 读取点 L1990/1991/1995 的 `copyMigratedIds` / `copyMigratedParentIds` 完成标签 ID 替换后的树状态迁移；
- 没有任何删除路径，Map 大小随标签 ID 替换次数单调增长。

## 方案 1：TabStore 只读快照 + O(1) 查询

### 变更点

**A. 有序缓存（脏标记）**

`TabStore` 增加内部有序缓存，所有变更操作（`initialize` / `add` / `update` / `remove` / `move` / `activate` / `replaceId` / 私有 `put` / `insert`）统一标记缓存失效：

```ts
private orderedCache: TabViewModel[] | undefined;

private markDirty(): void {
  this.orderedCache = undefined;
}
```

- `list()` 命中缓存时只做一次 `map(copyTab)`，未命中时排序并缓存。
- 拷贝语义保持不变：仍返回副本，防止外部修改污染 store。

**B. 零拷贝只读快照**

新增 `snapshot(): readonly TabViewModel[]`，返回缓存数组引用，零拷贝。调用方必须只读。

**C. 移除双重排序**

`buildTabListItems` 的 `orderedTabs = [...tabs].sort(compareTabs)` 与 `list()` 内部排序重复。传入 `snapshot()`（已按 pinned + index 排序）后移除内部重复排序。

**D. 事件路径 O(1) 化**

| 调用点 | 现状 | 改为 |
| --- | --- | --- |
| `updated`（sidebar.ts L1667） | `tabStore.list()` 找 previous | `tabStore.get(tab.id)` O(1) |
| `activated`（L1700 / L1706） | 两次 `list()` | 仅对受影响的 2 个标签 id 用 `get()` |
| `renderTabList`（L331） | `list()` | `snapshot()` |

### 兼容性

- `list()` 公共行为不变，仅内部缓存排序结果；
- `filter()` / `get()` / 各变更方法对外契约不变；
- 新增 `snapshot()` 为只读消费方（渲染、规划、菜单计算）提供零拷贝入口。

### 风险与对策

| 风险 | 对策 |
| --- | --- |
| `snapshot()` 返回引用被外部修改污染 store | 审查全部调用点确认只读；tab-store.test.ts 增加"快照内容变化不影响 store"断言；snapshot 不暴露为公共文档 API |
| 缓存失效漏点导致脏读 | 单测覆盖每个变更方法后的 list() 顺序与内容正确性 |
| copyTab 拷贝仍为 O(n) | 渲染路径已走 snapshot 零拷贝；事件路径拷贝从每事件 2-3 次降为每次变更后首次读取 1 次 |

## 方案 2：onUpdated 合并调度 + 增量渲染

### 变更点

**A. 合并调度器**

针对 `updated` 事件引入微任务合并窗口，其他事件保持同步处理不变：

```ts
const pendingTabUpdates = new Map<number, chrome.tabs.Tab>();
let updateFlushScheduled = false;

const scheduleTabUpdateFlush = (): void => {
  if (updateFlushScheduled) return;
  updateFlushScheduled = true;
  queueMicrotask(() => {
    updateFlushScheduled = false;
    flushTabUpdates();
  });
};
```

- `updated` 处理改为 `pendingTabUpdates.set(tab.id, tab)` + `scheduleTabUpdateFlush()`；
- `flushTabUpdates()` 遍历 pending map，对每个 tab 执行现有 updated 逻辑。

**B. 与既有缓冲机制兼容**

`flushTabUpdates` 内部仍走 `applyEvent`（mutate + render），`bufferingEvents`（resync 期间缓冲）语义不变。若 flush 时 `tabStore.get(tabId)` 不存在（标签已关闭），跳过该条即可，无脏状态。

**C. favicon 同步降频**

`updated` 的 `syncFavicons=true` 只在 flush 后执行一次，`syncShortcutFavicons` 的 JSON 签名比较保留（从每事件一次降为每合并窗口一次）。

### 正确性论证

- 浏览器多次触发 updated 的中间态可安全跳过：store 最终以最后一次快照为准，UI 中间态不可见；
- 用户交互路径（点击 / 拖拽 / 菜单）走 click / drop 事件，与 updated 合并无关，不受影响；
- removed / moved 事件独立同步处理，竞争时以 Chrome 最终状态为准。

### 风险与对策

| 风险 | 对策 |
| --- | --- |
| 现有测试依赖 updated 同步生效 | fake-chrome 增加 flush helper，测试触发 updated 后 flush 微任务；测试基建小改 |
| 合并后状态延迟一帧 | 微任务窗口 ≤ 1 帧，可接受；必要时可改为 requestAnimationFrame 对齐渲染 |
| 复杂度上升 | 调度器独立成 `tab-update-scheduler.ts` 模块，便于单测 |

## 方案 3：replacementTabIds 有界化

### 变更点

1. **消费即删**：`copyMigratedIds` / `copyMigratedParentIds` 迁移完成后，收集本次已迁移的 removedId，批量从 Map 删除（不在遍历中删除，避免迭代异常）。
2. **树关闭清空**：内容树关闭分支（sidebar.ts L494-500 已有 `clear` 逻辑）同时 `replacementTabIds.clear()`。
3. **兜底上限（可选）**：保留最近 256 条 FIFO 上限，防御极端场景。

### 论证

- `replacementTabIds` 唯一用途是把旧 tabId 迁移到新 tabId（会话恢复 / 崩溃恢复场景）；
- 迁移是一次性消费，`copyMigratedIds` 遍历后旧键不再需要；
- 内容树关闭时树会话被 clear，映射失去意义，一并清空；
- 三项叠加后 Map 大小有界（≤ 活跃替换窗口），消除泄漏。

### 风险与对策

| 风险 | 对策 |
| --- | --- |
| 遍历期间修改 Map 导致迭代异常 | 收集后批量删除，不在遍历中删 |
| 误删仍需要的映射 | 消费即删仅在迁移完成后执行；树关闭清空仅在有 clear 分支时执行 |

## 实施顺序

三个方案相互独立，按"小到大"顺序实施：

1. 方案 3（replacementTabIds 有界化）—— 约 0.5 天；
2. 方案 1（TabStore 快照 + O(1) 查询）—— 约 1-2 天，含测试与基准；
3. 方案 2（onUpdated 合并调度）—— 约 2-3 天，含测试基建小改。

每个方案独立提交、独立跑 `npm run check`，可逐个合入。

## 验证策略

- 每个方案落地后 `npm run check` 全绿（typecheck + 全量测试 + build + dist 检查）；
- 性能回归：`npm run benchmark:tabs`（现有 100 / 500 标签基准）前后对比；扩展基准覆盖 updated 事件风暴；
- 手工场景：500 标签批量打开、后台页面定时改标题、快速切换标签、拖拽大子树；
- 内存验证：长时间运行（含多次标签替换与树开关切换）后观察 `replacementTabIds` 大小保持有界。
