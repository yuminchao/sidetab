# SideTab Lite 0.8.0 性能与一致性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在最多 500 个标签的场景下增量维护侧栏 DOM，处理 Chrome 标签替换事件，缓存快捷网站成功图标地址，让历史搜索返回最多 20 条去重后的记录，并用统一本地图标替代三处首字符兜底，发布 0.8.0。

**Architecture:** 保留现有标签、分组 Store 和重同步状态机。渲染器使用标签/分组 ID 复用节点；异步标签读取通过通用有序槽进入事件缓冲；快捷图标缓存由独立存储模块校验、裁剪并串行合并写入；历史搜索扩大候选集合后按规范化完整 URL 去重；标签、历史和快捷入口通过同一 CSS mask 使用安全清理后的本地网络图标兜底。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、Chrome `tabs`/`tabGroups`/`storage`/`history` API、Vitest、JSDOM、esbuild。

---

## 文件结构

- 修改 `src/sidepanel/history-search.ts`：扩大历史候选集并按完整 URL 去重。
- 修改 `src/sidepanel/tab-renderer.ts`：实现 keyed DOM 协调和节点复用。
- 修改 `src/sidepanel/tab-events.ts`：订阅、过滤并清理 `tabs.onReplaced`。
- 修改 `src/sidepanel/sidebar.ts`：集成替换事件、有序异步槽和 favicon 签名短路。
- 新建 `src/sidepanel/shortcut-favicon-cache.ts`：缓存校验、裁剪、加载与串行合并写入。
- 修改 `src/sidepanel/shortcut-renderer.ts`：组合实时、缓存、根目录候选并报告加载结果。
- 修改 `src/sidepanel/history-search.ts`、`src/sidepanel/tab-renderer.ts` 和 `src/sidepanel/sidebar.css`：统一网络兜底图标。
- 新建 `assets/icons/network.svg`：保存用户提供 SVG 的安全最小结构。
- 修改 `tests/helpers/fake-chrome.ts`：提供替换事件和可变标签快照。
- 新建 `tests/shortcut-favicon-cache.test.ts`：覆盖缓存边界与写入竞争。
- 修改相关 Vitest 文件：覆盖去重、节点复用、替换竞争和侧栏集成。
- 新建 `scripts/benchmark-tab-renderer.mjs`：提供非 CI 硬门槛的 100/500 标签基准。
- 修改 `scripts/release-files.mjs` 和 `scripts/check-dist.mjs`：把网络图标加入14文件发布白名单和 SVG 结构审计。
- 修改发布元数据、说明和 `update.log`：发布 0.8.0。

### Task 1: 历史记录完整 URL 去重

**Files:**
- Modify: `src/sidepanel/history-search.ts:9-27`
- Test: `tests/history-search.test.ts:14-64`

- [ ] **Step 1: 写候选数量与去重失败测试**

把现有查询参数断言改为 `maxResults: 200`，并新增一个候选数组：前 20 条由 10 个完整 URL 各重复两次，后 10 条为不同 URL。断言结果长度为 20、重复 URL 仅保留第一次记录，并包含后续 10 条。

```ts
it("deduplicates complete URLs before taking twenty results", async () => {
  const duplicates = Array.from({ length: 20 }, (_, index) =>
    historyItem(String(index), `https://site-${index % 10}.example/path`, `Recent ${index}`),
  );
  const tail = Array.from({ length: 10 }, (_, index) =>
    historyItem(`tail-${index}`, `https://tail-${index}.example/path`, `Tail ${index}`),
  );
  const search = vi.fn(async () => [...duplicates, ...tail]);

  const result = await searchHistory({ search }, "docs");

  expect(search).toHaveBeenCalledWith({ text: "docs", startTime: 0, maxResults: 200 });
  expect(result).toHaveLength(20);
  expect(result.filter((item) => item.url === "https://site-0.example/path")).toHaveLength(1);
  expect(result.at(-1)?.url).toBe("https://tail-9.example/path");
});
```

- [ ] **Step 2: 写完整 URL 边界失败测试**

使用相同 origin 的不同路径、查询参数和锚点，断言四条均保留；同一规范化 `href` 的不同标题只保留第一条；无效协议不占结果名额。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 查询参数仍为 `maxResults: 20`，重复 URL 未被删除，测试失败原因与缺失功能一致。

- [ ] **Step 4: 实现最小去重逻辑**

```ts
items = await api.search({ text, startTime: 0, maxResults: 200 });
const seenUrls = new Set<string>();
const results: HistorySearchResult[] = [];
for (const item of items) {
  if (results.length === 20) break;
  const result = normalizeHistoryItem(item);
  if (!result || seenUrls.has(result.url)) continue;
  seenUrls.add(result.url);
  results.push(result);
}
```

- [ ] **Step 5: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: `tests/history-search.test.ts` 全部通过。

Commit:

```text
yyyyMMddHHmmss feat 历史记录搜索按完整地址去重
```

### Task 2: keyed 标签与分组 DOM 协调

**Files:**
- Modify: `src/sidepanel/tab-renderer.ts:20-112`
- Test: `tests/tab-renderer.test.ts:53-380,664-end`

- [ ] **Step 1: 写节点身份失败测试**

先渲染 500 个标签，保存每个行节点引用，再交换首尾条目并重新渲染。断言所有 `data-tab-id` 对应节点仍为原对象，只有 DOM 顺序改变。

```ts
const original = new Map(
  Array.from(list.querySelectorAll<HTMLElement>(".tab-row"), (row) => [row.dataset.tabId, row]),
);
renderer.render(reordered.map((tab) => ({ kind: "tab" as const, tab })));
for (const row of Array.from(list.querySelectorAll<HTMLElement>(".tab-row"))) {
  expect(row).toBe(original.get(row.dataset.tabId));
}
```

- [ ] **Step 2: 写新增、删除与 favicon 复用失败测试**

监视 `list.replaceChildren`；重复渲染、新增一个标签、删除一个标签时断言不调用它。保存未变化标签的 `<img>`，断言节点和 `src` 保持不变；新增只出现一个新行，删除不替换其他行。

- [ ] **Step 3: 写原子失败保护测试**

输入重复标签 ID 或让新行创建阶段抛错，断言原 DOM、标签索引和分组索引保持不变。保留现有“替换 DOM 抛错”测试的等价保护，不允许部分提交。

- [ ] **Step 4: 运行测试确认 RED**

Run: `npm test -- --run tests/tab-renderer.test.ts`

Expected: 当前 `replaceChildren` 全量重建导致节点身份和调用次数断言失败。

- [ ] **Step 5: 实现目标键与预提交阶段**

在 `render(items)` 内先构造目标项，验证键唯一，并复用现有索引：

```ts
type PreparedRow = { key: string; node: HTMLElement; item: TabListItem };
const prepared: PreparedRow[] = [];
const keys = new Set<string>();
for (const item of items) {
  const key = item.kind === "tab" ? `tab:${item.tab.id}` : `group:${item.group.id}`;
  if (!keys.add(key)) throw new Error(`重复列表键: ${key}`);
  const existing = item.kind === "tab"
    ? tabRows.get(item.tab.id)
    : groupRows.get(item.group.id);
  const node = existing ?? (item.kind === "tab"
    ? createTabRow(item.tab, dragEnabled)
    : createGroupRow(item.group));
  prepared.push({ key, node, item });
}
```

所有缺失节点创建完成后才能修改 DOM 或索引。

- [ ] **Step 6: 实现顺序协调、删除和补丁**

按 `prepared` 顺序比较 `list.children[index]`；不一致时使用 `list.insertBefore(node, current ?? null)`。随后删除不在目标集合中的旧节点，更新两个 Map，并调用 `updateTabRow`/`updateGroupRow`。不得调用 `replaceChildren`。

- [ ] **Step 7: 运行渲染器与侧栏回归测试确认 GREEN**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidebar.test.ts tests/tab-drag-controller.test.ts tests/tab-context-menu.test.ts`

Expected: 节点复用新增测试和现有拖拽、菜单、侧栏测试全部通过。

- [ ] **Step 8: 提交增量渲染**

```text
yyyyMMddHHmmss feat 标签列表复用现有DOM节点
```

### Task 3: favicon 映射签名短路

**Files:**
- Modify: `src/sidepanel/sidebar.ts:174-238,574-690`
- Test: `tests/sidebar.test.ts:322-450,1747-1783`

- [ ] **Step 1: 写无关更新失败测试**

快捷入口开启且历史结果框打开后，仅更新某标签标题。监视快捷渲染器可观察的图片节点和历史结果节点，断言二者保持对象身份；标签行标题仍更新。

- [ ] **Step 2: 写真实 favicon 变化测试**

更新同 origin 的 `favIconUrl`，断言快捷入口和历史结果使用新地址；相同映射的后续标题更新不得再次替换节点。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: `historySearch.setFaviconsByOrigin` 当前无签名短路，打开的历史结果节点被重建。

- [ ] **Step 4: 实现稳定签名**

在 Sidebar 保存上次 origin 映射签名。签名使用已排序 Map 的 origin 与 URL，不包含标题、激活或 index：

```ts
const faviconSignature = (items: ReadonlyMap<string, string>): string =>
  JSON.stringify(Array.from(items.entries()));
```

`syncShortcutFavicons` 只有签名变化时才同时通知快捷渲染器和历史搜索控制器；初始化必须强制执行一次，销毁后不更新签名或组件。

- [ ] **Step 5: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/sidebar.test.ts tests/favicon-model.test.ts tests/history-search.test.ts tests/shortcut-renderer.test.ts`

Expected: favicon 更新与无关更新测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 跳过未变化的favicon同步
```

### Task 4: Chrome 标签替换事件接口

**Files:**
- Modify: `src/sidepanel/tab-events.ts:1-91`
- Modify: `tests/helpers/fake-chrome.ts:1-205`
- Test: `tests/tab-events.test.ts`

- [ ] **Step 1: 扩展假 Chrome 事件但不改生产代码**

在 `createFakeChrome` 中增加：

```ts
type ReplacedListener = (addedTabId: number, removedTabId: number) => void;
const events = {
  // existing events
  onReplaced: new FakeEvent<ReplacedListener>(),
};
```

返回一个测试辅助方法 `setTabs(next)`，用深拷贝替换 `tabState`，让替换事件前可以设置 `tabs.get` 的真实结果。

- [ ] **Step 2: 写订阅、窗口过滤、失败与清理测试**

给 `TabEventHandlers` 期望接口增加：

```ts
replaced(tab: chrome.tabs.Tab, removedTabId: number): void;
replacementLookupFailed(): void;
```

覆盖：当前窗口成功转发、其他窗口忽略、`tabs.get` 拒绝触发失败回调、取消订阅后延迟成功或失败均不转发，以及 `onReplaced` 监听器只注册/注销一次。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- --run tests/tab-events.test.ts`

Expected: `onReplaced` 未订阅且处理器类型缺失导致测试失败。

- [ ] **Step 4: 实现替换查询和失效保护**

```ts
const onReplaced = (addedTabId: number, removedTabId: number): void => {
  void forwardReplacedTab(addedTabId, removedTabId);
};
async function forwardReplacedTab(addedTabId: number, removedTabId: number): Promise<void> {
  try {
    const tab = await tabsApi.get(addedTabId);
    if (active && tab.windowId === currentWindowId) handlers.replaced(tab, removedTabId);
  } catch {
    if (active) handlers.replacementLookupFailed();
  }
}
```

注册和注销 `tabsApi.onReplaced`，保持 `active` 失效检查。

- [ ] **Step 5: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/tab-events.test.ts tests/tab-group-events.test.ts`

Expected: 标签事件和分组事件测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 订阅Chrome标签替换事件
```

### Task 5: 替换事件有序缓冲与 Sidebar 集成

**Files:**
- Modify: `src/sidepanel/sidebar.ts:86-172,591-806,831-894`
- Modify: `src/sidepanel/tab-store.ts:86-103`
- Test: `tests/tab-store.test.ts`
- Test: `tests/sidebar.test.ts`

- [ ] **Step 1: 写 Store 原子替换失败测试**

为 `TabStore` 设计并测试：

```ts
replaceId(removedId: number, replacement: chrome.tabs.Tab): TabViewModel | undefined;
```

断言旧 ID 删除、新 ID 唯一、Chrome index 顺序正确；replacement 无效时旧状态保持不变。

- [ ] **Step 2: 写 Sidebar 实时替换失败测试**

启动两个标签，修改 fake Chrome 快照后发出 `onReplaced(newId, oldId)`。等待异步查询完成，断言旧行消失、新行出现一次、未变化行保持节点身份。

- [ ] **Step 3: 写启动和重同步竞态失败测试**

覆盖三个顺序：

1. 启动快照挂起时替换事件先到，旧快照返回后仍以新 ID 为准。
2. 替换查询挂起时后续关闭事件到达，关闭必须在替换之后应用。
3. 替换查询失败与其他失败并发时只触发一次合并重同步。

清理场景断言八个标签事件监听器归零，未完成替换查询返回后 DOM 不变化。

- [ ] **Step 4: 运行测试确认 RED**

Run: `npm test -- --run tests/tab-store.test.ts tests/sidebar.test.ts`

Expected: `replaceId`、替换处理器和异步槽尚不存在，测试失败。

- [ ] **Step 5: 实现原子 Store 替换**

先把 replacement 转换为有效模型，再对临时 Chrome 顺序数组执行旧 ID 删除和新模型插入；全部成功后一次性更新 Map。不得先删除旧标签再验证新标签。

- [ ] **Step 6: 泛化异步事件槽**

把仅附加事件使用的 `AttachedSlot` 改为通用 `AsyncEventSlot`，提供 `reserveAsyncEvent()` 和 `resolveAsyncEvent(slot, mutation)`。启动或重同步缓冲时，`onAttached` 与 `onReplaced` 都必须先占位；查询成功、忽略、失败和清理路径都必须恰好解析一次槽。

实时事件不需要缓冲时仍使用处理器的异步结果，但在应用前检查 `active` 和当前窗口。替换查询失败调用 `resyncTabsAndGroups()`，依赖现有 `resyncPromise` 合并并发请求。

- [ ] **Step 7: 接入原子替换处理器**

```ts
replaced(tab, removedTabId) {
  applyEvent(
    () => { tabStore.replaceId(removedTabId, tab); },
    renderTabList,
    true,
  );
},
replacementLookupFailed() {
  void resyncTabsAndGroups();
},
```

替换前关闭旧标签对应右键菜单；渲染完成后新 ID 只能出现一次。

- [ ] **Step 8: 运行竞态与完整 Sidebar 测试确认 GREEN**

Run: `npm test -- --run tests/tab-store.test.ts tests/tab-events.test.ts tests/sidebar.test.ts`

Expected: Store、八类标签事件、启动/重同步竞态和清理测试全部通过。

- [ ] **Step 9: 提交一致性修复**

```text
yyyyMMddHHmmss fix 修复Chrome替换标签后的侧栏残留
```

### Task 6: 快捷网站图标缓存模型与写入队列

**Files:**
- Create: `src/sidepanel/shortcut-favicon-cache.ts`
- Create: `tests/shortcut-favicon-cache.test.ts`
- Modify: `src/sidepanel/favicon-model.ts`
- Test: `tests/favicon-model.test.ts`

- [ ] **Step 1: 写缓存校验失败测试**

定义期望 API：

```ts
export type ShortcutFaviconCache = ReadonlyMap<string, string>;
export function createShortcutFaviconCacheStore(area: StorageArea): {
  load(): Promise<Map<string, string>>;
  update(origin: string, url: string | undefined): void;
  prune(origins: ReadonlySet<string>): void;
  flush(): Promise<void>;
  destroy(): void;
};
```

覆盖合法 HTTP/HTTPS、32 KiB 内 Data URL、无效 origin、危险协议、超长 Data URL、损坏存储回退空 Map。

- [ ] **Step 2: 写裁剪、合并和竞争失败测试**

连续 `update` 三个 origin 后只调用一次 `area.set`；相同值不写；`prune` 只保留当前快捷网站且最多 12 条；第一笔存储 Promise 挂起时更新同 origin，第二笔必须在第一笔完成后写最新完整快照，旧快照不得覆盖新值；`destroy` 后不再排队。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- --run tests/shortcut-favicon-cache.test.ts tests/favicon-model.test.ts`

Expected: 新模块不存在，测试失败。

- [ ] **Step 4: 实现安全 URL 校验与缓存读取**

复用或扩展 `getAllowedImageUrl`。Data URL 需同时满足 `/^data:image\//i` 和字符串长度 `<= 32 * 1024`；HTTP origin 必须等于规范化输入 origin。存储键固定为 `shortcutFaviconCacheV1`，未知字段忽略。

- [ ] **Step 5: 实现微任务合并和串行完整快照写入**

缓存模块维护内存 Map、`scheduled`、`active` 和 `writeChain`。`update`/`prune` 只在状态真实变化时安排一次 `queueMicrotask`；微任务捕获最新快照并追加到 `writeChain`。每次写入完整对象：

```ts
writeChain = writeChain
  .catch(() => undefined)
  .then(() => area.set({ shortcutFaviconCacheV1: Object.fromEntries(snapshot) }));
```

`flush()` 等待已安排微任务和写入链，存储错误由调用方映射为非阻塞状态提示。

- [ ] **Step 6: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/shortcut-favicon-cache.test.ts tests/favicon-model.test.ts`

Expected: 缓存校验、合并、竞争、裁剪和销毁测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 新增快捷网站图标地址缓存
```

### Task 7: 快捷渲染器缓存候选与加载反馈

**Files:**
- Modify: `src/sidepanel/shortcut-renderer.ts:24-40,45-210,390-570`
- Test: `tests/shortcut-renderer.test.ts`

- [ ] **Step 1: 写候选优先级失败测试**

给渲染器增加 `setCachedFaviconsByOrigin(cache)`，设置实时 favicon、缓存地址和根目录地址，断言 `<img>` 依次尝试三个去重候选。实时和缓存相同只能尝试一次。

- [ ] **Step 2: 写成功与失败反馈测试**

给 callbacks 增加：

```ts
onFaviconLoaded?(origin: string, url: string): void;
onCachedFaviconFailed?(origin: string, url: string): void;
```

图片 `load` 时报告当前实际 `src`；只有失败候选来自缓存时报告淘汰；随后继续下一个候选。全部候选耗尽时渲染统一网络兜底元素，该元素不触发缓存回调。销毁后相同事件不回调。

- [ ] **Step 3: 写未变化图片复用失败测试**

重复设置等价实时和缓存 Map，断言快捷按钮和图片节点保持身份、`src` 不重新赋值。只改变某 origin 时仅替换对应按钮的图标节点。

- [ ] **Step 4: 运行测试确认 RED**

Run: `npm test -- --run tests/shortcut-renderer.test.ts`

Expected: 缓存 API、load 委托和多候选链不存在，测试失败。

- [ ] **Step 5: 实现带来源的候选链**

为图片保存 JSON 候选数组和当前索引，每项包含 `{ url, source: "live" | "cache" | "root" }`。候选构造按实时、缓存、根目录顺序去重。`error` 前进到下一项，耗尽后替换为无文本的网络兜底 `<span>`；`load` 只报告前三类候选的 origin 和当前 URL。

- [ ] **Step 6: 使用 keyed 快捷按钮更新避免整条重绘**

快捷入口最多 12 条，但 favicon Map 变化时仍应按 shortcut ID 复用按钮。至少保证候选签名不变时 `setFaviconsByOrigin` 和 `setCachedFaviconsByOrigin` 不调用 `renderStrip`；候选变化时仅更新对应按钮内图标。

- [ ] **Step 7: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/shortcut-renderer.test.ts tests/favicon-model.test.ts`

Expected: 候选优先级、加载反馈、失败淘汰、节点复用和销毁测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 快捷网站复用已缓存图标地址
```

### Task 8: Sidebar 缓存加载、裁剪和生命周期集成

**Files:**
- Modify: `src/sidepanel/sidebar.ts:74-238,342-370,486-514,808-894`
- Modify: `tests/sidebar.test.ts`
- Modify: `tests/helpers/fake-chrome.ts`

- [ ] **Step 1: 写启动缓存失败测试**

让 `storage.get("shortcutSettings")` 和 `storage.get("shortcutFaviconCacheV1")` 返回独立结果。启动后断言快捷图标优先使用当前标签 favicon；没有匹配标签时使用缓存；缓存读取失败仍完成 `data-ready` 并依次使用根目录图标和统一网络兜底。

- [ ] **Step 2: 写加载成功、失败淘汰和合并写入失败测试**

触发两个快捷图标 `load`，等待微任务后断言一次 `storage.set` 包含两个 origin。缓存图标 `error` 后断言下一候选生效且缓存快照删除该项。相同地址再次 `load` 不增加写入。

- [ ] **Step 3: 写设置保存裁剪和清理失败测试**

修改快捷网站域名并保存，断言缓存只保留新设置的 origin。恢复默认同样裁剪。页面 cleanup 后触发延迟 `load/error`，断言不产生新写入；挂起写入完成后不更新状态消息或 DOM。

- [ ] **Step 4: 运行测试确认 RED**

Run: `npm test -- --run tests/sidebar.test.ts tests/shortcut-favicon-cache.test.ts tests/shortcut-renderer.test.ts`

Expected: Sidebar 尚未加载或连接缓存，测试失败。

- [ ] **Step 5: 并行加载设置、缓存和标签快照**

创建缓存 Store 后同时启动 `shortcutStore.load()`、`faviconCacheStore.load()` 和窗口标签/分组加载。设置和缓存均就绪后调用渲染器；任一缓存读取错误按空缓存继续，不阻塞设置按钮和标签列表。

- [ ] **Step 6: 连接渲染器回调与设置裁剪**

`onFaviconLoaded` 调用 `cacheStore.update(origin, url)`；`onCachedFaviconFailed` 调用 `cacheStore.update(origin, undefined)`。设置保存、右键新增快捷网站和恢复默认后，用当前快捷项 origin 集合调用 `prune`，并把最新缓存 Map 传给渲染器。

- [ ] **Step 7: 清理缓存生命周期**

Sidebar cleanup 先销毁渲染器、再 `cacheStore.destroy()`，清除待安排微任务并阻止后续排队。已经开始的写入允许自然结束，但其 rejection 必须被消费，不能产生未处理 Promise。

- [ ] **Step 8: 运行集成测试确认 GREEN 并提交**

Run: `npm test -- --run tests/sidebar.test.ts tests/shortcut-store.test.ts tests/shortcut-favicon-cache.test.ts tests/shortcut-renderer.test.ts`

Expected: 缓存启动、学习、淘汰、裁剪、写入竞争和清理测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 集成快捷网站图标缓存生命周期
```

### Task 9: 统一网络兜底图标

**Files:**
- Create: `assets/icons/network.svg`
- Modify: `src/sidepanel/tab-renderer.ts:232-283`
- Modify: `src/sidepanel/history-search.ts:113-150,249-259`
- Modify: `src/sidepanel/shortcut-renderer.ts:182-200,436-470`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `scripts/release-files.mjs`
- Modify: `scripts/check-dist.mjs`
- Test: `tests/assets.test.ts`
- Test: `tests/tab-renderer.test.ts`
- Test: `tests/history-search.test.ts`
- Test: `tests/shortcut-renderer.test.ts`
- Test: `tests/sidepanel-css.test.ts`
- Test: `tests/release-scripts.test.ts`

- [ ] **Step 1: 写本地资源与发布契约失败测试**

断言 `assets/icons/network.svg` 存在，根元素仅有 `xmlns`、`viewBox`，只包含一个仅有 `d` 属性的 `<path>`，且不含 XML 声明、DOCTYPE、生成器属性、脚本、事件、远程引用或多余命名空间。把预期发布文件加入 `assets/icons/network.svg`，总数改为 14。

- [ ] **Step 2: 写三处兜底行为失败测试**

标签、历史和快捷网站分别构造无候选与候选全部 `error` 两种场景。断言最终存在统一兜底 class、无首字符文本、没有额外 `<img>`；快捷兜底不调用 `onFaviconLoaded` 或 `onCachedFaviconFailed`。

- [ ] **Step 3: 写 CSS 尺寸失败测试**

断言统一基础 class 使用 `mask-image: url("../assets/icons/network.svg")`、`background-color: currentColor`，标签和历史为 16px，快捷网站为 20px，不改变现有容器尺寸。

- [ ] **Step 4: 运行测试确认 RED**

Run: `npm test -- --run tests/assets.test.ts tests/tab-renderer.test.ts tests/history-search.test.ts tests/shortcut-renderer.test.ts tests/sidepanel-css.test.ts tests/release-scripts.test.ts`

Expected: 网络图标资源不存在，三处仍生成首字符，发布白名单仍为 13 个文件。

- [ ] **Step 5: 安全清理用户 SVG**

确认源文件 `C:\Users\NUC\Downloads\网络.svg` 的 SHA-256 为 `AF097473A6E8A520A2FB533E3AB66568729E50A6E19D300A01AF775F356D1BAA`。读取其中唯一 `<path>` 的完整 `d` 值并原样放入 `assets/icons/network.svg`；根元素固定为 `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">`，path 仅保留 `d`。不得保留原 XML、DOCTYPE、`t`、`class`、`version`、`p-id`、`xmlns:xlink`、宽高或其他属性，也不得改写路径数值。

- [ ] **Step 6: 实现统一无文本兜底元素**

三个渲染器使用各自语义 class 加统一 `site-favicon-fallback`，元素设置 `aria-hidden="true"` 且 `textContent` 为空。删除 `getFallbackText`、`getFirstCharacter` 和图片上的 fallback 文字 dataset；候选耗尽时只替换为该 span。

- [ ] **Step 7: 实现 CSS mask 与发布审计**

在 CSS 中定义本地 mask，分别保持 16px/20px。`scripts/release-files.mjs` 加入网络图标；`scripts/check-dist.mjs` 把它纳入 sanitized SVG 集合，继续使用结构化 XML 白名单校验。

- [ ] **Step 8: 运行测试确认 GREEN 并提交**

Run: `npm test -- --run tests/assets.test.ts tests/tab-renderer.test.ts tests/history-search.test.ts tests/shortcut-renderer.test.ts tests/sidepanel-css.test.ts tests/release-scripts.test.ts`

Expected: 三处网络兜底、无首字符、安全 SVG 和14文件发布契约测试全部通过。

Commit:

```text
yyyyMMddHHmmss feat 统一网站图标兜底资源
```

### Task 10: 性能基准与回归检查

**Files:**
- Create: `scripts/benchmark-tab-renderer.mjs`
- Modify: `package.json`
- Test: `tests/release-scripts.test.ts`

- [ ] **Step 1: 写脚本契约失败测试**

断言 `package.json` 提供 `benchmark:tabs`，脚本存在且不进入发布文件白名单；脚本输出 100、500 标签的 JSON 指标，但不得以 50ms 目标作为退出失败条件。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- --run tests/release-scripts.test.ts`

Expected: benchmark script 尚不存在，测试失败。

- [ ] **Step 3: 实现可重复基准**

脚本使用 esbuild 内存打包 `tab-renderer.ts`，在 JSDOM 中预热后分别执行 30 次单标签移动，输出 `count`、`medianMs`、`p95Ms`、`domNodes` 和 `heapUsedMb`。使用 `performance.now()`，不修改仓库文件，不调用网络。

- [ ] **Step 4: 运行基准和相关测试**

Run: `npm run benchmark:tabs`

Expected: 输出 100 和 500 两行有效 JSON；人工确认 500 标签中位数目标低于 50ms，若未达到则回到 Task 2 分析 DOM 调用。

Run: `npm test -- --run tests/release-scripts.test.ts tests/tab-renderer.test.ts`

Expected: 发布脚本与增量渲染测试通过。

- [ ] **Step 5: 提交基准工具**

```text
yyyyMMddHHmmss feat 新增标签列表性能基准
```

### Task 11: 0.8.0 版本、更新日志与发布包

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `README.md`
- Create: `update.log`
- Modify: `tests/smoke.test.ts`
- Modify: `tests/release-scripts.test.ts`

- [ ] **Step 1: 写 0.8.0 发布契约失败测试**

把四处版本断言改为 `0.8.0`；断言 README 指向 `release/sidetab-lite-0.8.0.zip`；断言 `update.log` 包含 0.8.0、`tabs.onReplaced`、增量 DOM、快捷图标缓存、统一网络兜底和历史 URL 去重，且发布 ZIP 为精确 14 个文件。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: 当前版本仍为 0.7.0 且更新日志不存在，测试失败。

- [ ] **Step 3: 更新版本与中文更新记录**

把 `package.json`、`package-lock.json` 根版本、`package-lock.json.packages[""].version` 和 `manifest.json` 更新为 `0.8.0`。README 更新 ZIP 名称。创建 UTF-8 `update.log`：

```text
0.8.0
- 处理 Chrome 预渲染标签替换，避免侧栏残留旧标签。
- 标签和分组列表改为增量 DOM 协调，优化大量标签的移动与分组性能。
- 缓存快捷网站最后成功加载的安全图标地址。
- 标签页、历史记录和快捷网站统一使用本地网络图标兜底，不再生成首字符图标。
- 历史搜索按完整 URL 去重后返回最多 20 条结果。
```

- [ ] **Step 4: 运行完整验证**

Run: `npm run typecheck`

Expected: TypeScript 退出码 0。

Run: `npm test -- --run`

Expected: 全部 Vitest 文件通过，仅允许现有 Windows 符号链接场景按平台跳过。

Run: `npm run benchmark:tabs`

Expected: 100/500 标签指标有效，500 标签中位数目标低于 50ms。

Run: `npm run package`

Expected: 类型检查、全部测试、构建和 dist 审计通过，生成 `release/sidetab-lite-0.8.0.zip`。

- [ ] **Step 5: 审计最终 ZIP**

确认 manifest 版本为 0.8.0，权限仍为 `sidePanel,tabs,tabGroups,storage,history`；ZIP 精确包含 14 个商店文件，其中新增 `assets/icons/network.svg`，且不含源码、测试、文档、benchmark、source map 或 package 元数据。计算 SHA-256 并记录最终字节数。

- [ ] **Step 6: Chrome 扩展环境手工验证**

在 `chrome://extensions` 加载 `dist`，验证：

1. 500 标签合成或真实场景下移动、固定、分组时滚动位置与行节点状态稳定。
2. 快捷图标成功加载后关闭并重开侧栏，缓存候选仍被使用。
3. 清除或阻断 favicon 候选后，标签、历史和快捷入口均显示网络图标，且缓存中没有该本地资源。
4. 历史搜索结果无重复完整 URL，候选足够时显示 20 条。
5. 侧栏关闭后重新打开，标签列表来自最新 Chrome 快照，不出现旧 ID 或重复行。

若当前自动化环境不能触发 Chrome 原生预渲染替换，明确记录该项由自动化事件竞态测试覆盖，不能声称完成真实 `onReplaced` 端到端验证。

- [ ] **Step 7: 提交 0.8.0 发布元数据**

```text
yyyyMMddHHmmss feat 发布性能优化版本0.8.0
```
