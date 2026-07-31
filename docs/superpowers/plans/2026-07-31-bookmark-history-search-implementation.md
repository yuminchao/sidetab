# 收藏夹与历史记录合并搜索实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在底部搜索框输入内容时，将最多 5 条 Chrome 收藏夹结果置顶，并用去重后的历史记录补足到最多 20 条；空查询保持纯历史记录。

**Architecture:** 新建共享搜索结果模型统一 HTTP/HTTPS 地址规范化、来源字段和跨来源合并；新建收藏夹查询模块只负责按需调用 `chrome.bookmarks.search()`。现有历史搜索控制器使用 `Promise.allSettled()` 并行查询两个来源并支持单侧失败降级，侧边栏只增加一个显式 `bookmarks` 依赖。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、Chrome `bookmarks`/`history` API、Vitest、JSDOM、Vite。

---

## 范围约束

本计划只实现收藏夹搜索及其必需权限、隐私与发布校验。以下已确认需求不在本计划中提前修改：

- 恢复 `+` 文本按钮和删除 `add-tab.svg`。
- 快捷网站默认开启。
- 版本升级到 0.8.2 和生成最终 ZIP。

这些内容在收藏夹搜索完成后继续实施，最终统一发布 0.8.2。

## 文件结构

- 新建 `src/sidepanel/search-result-model.ts`：搜索结果类型、URL 规范化键和收藏夹/历史记录合并规则。
- 新建 `src/sidepanel/bookmark-search.ts`：Chrome 收藏夹查询、节点过滤和稳定错误映射。
- 新建 `tests/search-result-model.test.ts`：跨来源去重、顺序和数量上限。
- 新建 `tests/bookmark-search.test.ts`：收藏夹 API 参数、节点过滤、标题回退和失败映射。
- 修改 `src/sidepanel/history-search.ts`：复用共享模型，并行查询两个来源和渲染通用反馈。
- 修改 `tests/history-search.test.ts`：历史来源字段、空查询、并行合并、部分失败和生命周期回归。
- 修改 `src/sidepanel/sidebar.ts`：增加 `bookmarks` 依赖并传给搜索控制器。
- 修改 `tests/helpers/fake-chrome.ts`、`tests/sidebar.test.ts`：提供收藏夹假 API 并验证真实接入。
- 修改 `manifest.json`、`scripts/check-dist.mjs`、`tests/smoke.test.ts`、`tests/release-scripts.test.ts`：精确加入 `bookmarks` 必需权限。
- 修改 `README.md`、`docs/privacy-policy.md`、`docs/chrome-web-store-checklist.md`：说明按需本地收藏夹查询、合并规则和权限用途。

### Task 1: 建立共享搜索结果模型

**Files:**
- Create: `src/sidepanel/search-result-model.ts`
- Create: `tests/search-result-model.test.ts`
- Modify: `src/sidepanel/history-search.ts:3-60`
- Modify: `tests/history-search.test.ts:1-120`

- [ ] **Step 1: 写共享规范化与合并的失败测试**

在 `tests/search-result-model.test.ts` 创建覆盖以下行为的测试：

```ts
import { describe, expect, it } from "vitest";
import {
  createSearchResult,
  mergeSearchResults,
  type SearchResult,
} from "../src/sidepanel/search-result-model";

const result = (
  id: string,
  url: string,
  source: SearchResult["source"],
): SearchResult => ({ id, title: id, url, source });

describe("search result model", () => {
  it("normalizes web URLs and rejects unsupported schemes", () => {
    expect(createSearchResult({
      id: "bookmark-1",
      title: "  Docs  ",
      url: "https://example.com/docs/?q=1#top",
      source: "bookmark",
    })).toEqual({
      result: {
        id: "bookmark-1",
        title: "Docs",
        url: "https://example.com/docs/?q=1#top",
        source: "bookmark",
      },
      dedupeKey: "example.com/docs",
    });
    expect(createSearchResult({
      id: "internal",
      title: "Settings",
      url: "chrome://settings/",
      source: "bookmark",
    })).toBeUndefined();
  });

  it("places at most five unique bookmarks first and fills to twenty", () => {
    const bookmarks = Array.from({ length: 7 }, (_, index) =>
      result(`bookmark-${index}`, `https://bookmark-${index}.example/`, "bookmark"),
    );
    const history = Array.from({ length: 20 }, (_, index) =>
      result(`history-${index}`, `https://history-${index}.example/`, "history"),
    );

    const merged = mergeSearchResults(bookmarks, history);

    expect(merged).toHaveLength(20);
    expect(merged.slice(0, 5).every((item) => item.source === "bookmark")).toBe(true);
    expect(merged.slice(5).every((item) => item.source === "history")).toBe(true);
  });

  it("keeps a bookmark when history has the same normalized address", () => {
    const bookmark = result("bookmark", "https://example.com/docs/?saved=1", "bookmark");
    const duplicateHistory = result("history", "http://example.com/docs#old", "history");

    expect(mergeSearchResults([bookmark], [duplicateHistory])).toEqual([bookmark]);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm test -- --run tests/search-result-model.test.ts`

Expected: FAIL，提示无法解析 `src/sidepanel/search-result-model.ts`。

- [ ] **Step 3: 实现共享类型、规范化和有界合并**

在 `src/sidepanel/search-result-model.ts` 实现：

```ts
export type SearchResult = {
  id: string;
  title: string;
  url: string;
  source: "bookmark" | "history";
};

export type NormalizedSearchResult = {
  result: SearchResult;
  dedupeKey: string;
};

export function createSearchResult(input: SearchResult): NormalizedSearchResult | undefined {
  try {
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return {
      result: {
        ...input,
        title: input.title.trim() || url.hostname,
        url: url.href,
      },
      dedupeKey: `${url.host}${pathname}`,
    };
  } catch {
    return undefined;
  }
}

export function mergeSearchResults(
  bookmarks: readonly SearchResult[],
  history: readonly SearchResult[],
): SearchResult[] {
  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  const append = (items: readonly SearchResult[], limit: number): void => {
    let added = 0;
    for (const item of items) {
      if (merged.length === 20 || added === limit) break;
      const normalized = createSearchResult(item);
      if (!normalized || seen.has(normalized.dedupeKey)) continue;
      seen.add(normalized.dedupeKey);
      merged.push(normalized.result);
      added += 1;
    }
  };
  append(bookmarks, 5);
  append(history, 20);
  return merged;
}
```

修改 `searchHistory()` 使用 `createSearchResult()`，返回项增加 `source: "history"`，移除文件内重复的路径规范化函数。保留 `HistorySearchResult` 为兼容别名：

```ts
import { createSearchResult, type SearchResult } from "./search-result-model";

export type HistorySearchResult = SearchResult;
```

- [ ] **Step 4: 更新历史模型期望并运行模型测试**

为 `tests/history-search.test.ts` 中所有 `searchHistory()` 结果补充 `source: "history"`。

Run: `npm test -- --run tests/search-result-model.test.ts tests/history-search.test.ts`

Expected: 新模型测试与既有历史搜索测试全部 PASS。

- [ ] **Step 5: 提交共享模型**

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后执行：

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 统一搜索结果规范化与合并"
git add src/sidepanel/search-result-model.ts src/sidepanel/history-search.ts tests/search-result-model.test.ts tests/history-search.test.ts
git commit -m $message
```

### Task 2: 实现有界收藏夹查询

**Files:**
- Create: `src/sidepanel/bookmark-search.ts`
- Create: `tests/bookmark-search.test.ts`

- [ ] **Step 1: 写收藏夹查询失败测试**

在 `tests/bookmark-search.test.ts` 创建测试，覆盖准确参数、最多 5 条、无标题回退、文件夹与非网页地址过滤、统一键去重和稳定错误：

```ts
import { describe, expect, it, vi } from "vitest";
import { searchBookmarks } from "../src/sidepanel/bookmark-search";

const node = (overrides: Partial<chrome.bookmarks.BookmarkTreeNode> = {}) => ({
  id: "bookmark-1",
  title: "Docs",
  url: "https://docs.example/guide",
  ...overrides,
});

describe("bookmark search", () => {
  it("queries the text and returns at most five unique web bookmarks", async () => {
    const search = vi.fn(async () => [
      node(),
      node({ id: "duplicate", url: "http://docs.example/guide/?q=1" }),
      node({ id: "folder", url: undefined }),
      node({ id: "internal", url: "chrome://bookmarks/" }),
      ...Array.from({ length: 6 }, (_, index) => node({
        id: `extra-${index}`,
        title: "",
        url: `https://extra-${index}.example/`,
      })),
    ]);

    const results = await searchBookmarks({ search }, "docs");

    expect(search).toHaveBeenCalledWith("docs");
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      id: "bookmark-1",
      title: "Docs",
      url: "https://docs.example/guide",
      source: "bookmark",
    });
    expect(results[1]?.title).toBe("extra-0.example");
  });

  it("maps API failures to a stable error", async () => {
    const search = vi.fn(async (): Promise<chrome.bookmarks.BookmarkTreeNode[]> => {
      throw new Error("browser failure");
    });
    await expect(searchBookmarks({ search }, "docs")).rejects.toThrow("无法读取收藏夹");
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm test -- --run tests/bookmark-search.test.ts`

Expected: FAIL，提示无法解析 `src/sidepanel/bookmark-search.ts`。

- [ ] **Step 3: 实现收藏夹查询**

在 `src/sidepanel/bookmark-search.ts` 实现：

```ts
import { createSearchResult, type SearchResult } from "./search-result-model";

export type BookmarkSearchApi = Pick<typeof chrome.bookmarks, "search">;

export async function searchBookmarks(
  api: BookmarkSearchApi,
  text: string,
): Promise<SearchResult[]> {
  let nodes: chrome.bookmarks.BookmarkTreeNode[];
  try {
    nodes = await api.search(text);
  } catch {
    throw new Error("无法读取收藏夹");
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (results.length === 5) break;
    if (!node.url) continue;
    const normalized = createSearchResult({
      id: node.id,
      title: node.title,
      url: node.url,
      source: "bookmark",
    });
    if (!normalized || seen.has(normalized.dedupeKey)) continue;
    seen.add(normalized.dedupeKey);
    results.push(normalized.result);
  }
  return results;
}
```

- [ ] **Step 4: 运行收藏夹与共享模型测试**

Run: `npm test -- --run tests/bookmark-search.test.ts tests/search-result-model.test.ts`

Expected: 全部 PASS，收藏夹结果数量固定有界。

- [ ] **Step 5: 提交收藏夹查询模块**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 新增收藏夹搜索模型"
git add src/sidepanel/bookmark-search.ts tests/bookmark-search.test.ts
git commit -m $message
```

### Task 3: 在搜索控制器中并行合并结果

**Files:**
- Modify: `src/sidepanel/history-search.ts:62-330`
- Modify: `tests/history-search.test.ts:120-470`

- [ ] **Step 1: 写控制器失败测试**

在 `tests/history-search.test.ts` 为 `createHistorySearchController()` 增加 `bookmarks` 依赖，并新增以下场景：

```ts
it("keeps focus-only results history-only", async () => {
  const historySearch = vi.fn(async () => [historyItem("history", "https://history.example/")]);
  const bookmarkSearch = vi.fn(async () => []);
  const controller = createHistorySearchController(
    { document, input, results },
    {
      history: { search: historySearch },
      bookmarks: { search: bookmarkSearch },
      onOpen: vi.fn(),
    },
  );
  input.focus();
  await flush();
  expect(bookmarkSearch).not.toHaveBeenCalled();
  expect(results.textContent).toContain("history.example");
  controller.destroy();
});

it("places bookmarks first and fills with history after non-empty input", async () => {
  vi.useFakeTimers();
  const controller = createHistorySearchController(
    { document, input, results },
    {
      history: { search: vi.fn(async () => [
        historyItem("duplicate", "http://docs.example/guide", "Old Docs"),
        historyItem("history", "https://history.example/", "History"),
      ]) },
      bookmarks: { search: vi.fn(async () => [{
        id: "bookmark",
        title: "Saved Docs",
        url: "https://docs.example/guide/?saved=1",
      }]) },
      onOpen: vi.fn(),
    },
  );
  input.value = "docs";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(100);
  expect(Array.from(results.querySelectorAll("[role='option']"), (item) => item.textContent))
    .toEqual(["Saved Docs", "History"]);
  controller.destroy();
});
```

再分别新增收藏夹失败仍展示历史、历史失败仍展示收藏夹、两项失败显示“无法读取搜索记录”、快速输入丢弃旧组合结果、销毁后不更新 DOM 的测试。

- [ ] **Step 2: 运行控制器测试并确认失败原因正确**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: FAIL，原因是控制器尚不接受 `bookmarks`，也不会合并结果。

- [ ] **Step 3: 实现空查询分流与非空并行查询**

在 `history-search.ts` 导入：

```ts
import { searchBookmarks, type BookmarkSearchApi } from "./bookmark-search";
import { mergeSearchResults, type SearchResult } from "./search-result-model";
```

把回调类型扩展为：

```ts
callbacks: {
  history: HistorySearchApi;
  bookmarks: BookmarkSearchApi;
  onOpen(url: string): void | Promise<void>;
  onOpenError?(message: string): void;
}
```

将 `runQuery()` 改为：

```ts
const runQuery = async (rawQuery: string): Promise<void> => {
  const queryGeneration = ++generation;
  const query = rawQuery.trim();
  renderMessage("正在搜索…");

  if (!query) {
    try {
      const items = await searchHistory(callbacks.history, "");
      if (active && queryGeneration === generation) renderResults(items, "");
    } catch {
      if (active && queryGeneration === generation) renderMessage("无法读取历史记录");
    }
    return;
  }

  const [bookmarkOutcome, historyOutcome] = await Promise.allSettled([
    searchBookmarks(callbacks.bookmarks, query),
    searchHistory(callbacks.history, query),
  ]);
  if (!active || queryGeneration !== generation) return;
  if (bookmarkOutcome.status === "rejected" && historyOutcome.status === "rejected") {
    renderMessage("无法读取搜索记录");
    return;
  }
  const bookmarks = bookmarkOutcome.status === "fulfilled" ? bookmarkOutcome.value : [];
  const history = historyOutcome.status === "fulfilled" ? historyOutcome.value : [];
  renderResults(mergeSearchResults(bookmarks, history), query);
};
```

将非空无结果文案改为“没有匹配的记录”，打开失败文案改为“无法打开搜索结果”。其余失焦计时器、请求序号、点击保护和 favicon 渲染逻辑保持不变。

- [ ] **Step 4: 运行全部搜索测试**

Run: `npm test -- --run tests/search-result-model.test.ts tests/bookmark-search.test.ts tests/history-search.test.ts`

Expected: 全部 PASS；空查询没有收藏夹调用，单侧失败能降级。

- [ ] **Step 5: 提交控制器合并逻辑**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 合并收藏夹与历史搜索结果"
git add src/sidepanel/history-search.ts tests/history-search.test.ts
git commit -m $message
```

### Task 4: 接入侧边栏与真实 Chrome API

**Files:**
- Modify: `src/sidepanel/sidebar.ts:30-40,258-275,1145-1160`
- Modify: `tests/helpers/fake-chrome.ts:40-230`
- Modify: `tests/sidebar.test.ts:770-830,2328-2345`

- [ ] **Step 1: 写侧边栏接入失败测试**

扩展 `createFakeChrome()` 参数与返回值：

```ts
bookmarkItems?: chrome.bookmarks.BookmarkTreeNode[];
```

在侧边栏搜索测试中输入 `docs`，断言：

```ts
expect(fake.methods.bookmarkSearch).toHaveBeenCalledWith("docs");
expect(fake.methods.historySearch).toHaveBeenCalledWith({
  text: "docs",
  startTime: 0,
  maxResults: 500,
});
```

并在编译形状测试的 `RealChromeDependencies` 中加入：

```ts
bookmarks: typeof chrome.bookmarks;
```

- [ ] **Step 2: 运行侧边栏测试并确认缺少依赖而失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，提示 `SidebarDependencies` 或控制器缺少 `bookmarks`。

- [ ] **Step 3: 实现假 API 和生产依赖注入**

在 `tests/helpers/fake-chrome.ts` 增加：

```ts
const bookmarkSearch = vi.fn(async () => options.bookmarkItems ?? []);
```

返回对象增加：

```ts
bookmarks: { search: bookmarkSearch } as Pick<typeof chrome.bookmarks, "search">,
```

并把 `bookmarkSearch` 暴露在 `methods` 中。

在 `SidebarDependencies` 增加 `bookmarks: BookmarkSearchApi`，创建搜索控制器时传入 `deps.bookmarks`，自动启动入口传入 `chrome.bookmarks`：

```ts
const historySearch = createHistorySearchController(elements, {
  history: deps.history,
  bookmarks: deps.bookmarks,
  // existing callbacks
});
```

- [ ] **Step 4: 运行侧边栏与类型检查**

Run: `npm test -- --run tests/sidebar.test.ts tests/history-search.test.ts`

Expected: 全部 PASS。

Run: `npm run typecheck`

Expected: PASS，真实 Chrome API 类型与假依赖一致。

- [ ] **Step 5: 提交侧边栏接入**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 接入Chrome收藏夹搜索"
git add src/sidepanel/sidebar.ts tests/helpers/fake-chrome.ts tests/sidebar.test.ts
git commit -m $message
```

### Task 5: 增加权限、隐私说明与发布校验

**Files:**
- Modify: `manifest.json:7`
- Modify: `scripts/check-dist.mjs:337-342`
- Modify: `tests/smoke.test.ts:28-110`
- Modify: `tests/release-scripts.test.ts:80-95`
- Modify: `README.md:33-45`
- Modify: `docs/privacy-policy.md:12-38`
- Modify: `docs/chrome-web-store-checklist.md:28-46`

- [ ] **Step 1: 写权限与文档失败测试**

在 `tests/smoke.test.ts` 的精确权限数组末尾加入 `bookmarks`，并新增当前功能文档断言：

```ts
it("documents bookmark-first search and its local permission use", () => {
  const readme = readFileSync("README.md", "utf8");
  const privacy = readFileSync("docs/privacy-policy.md", "utf8");
  const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");
  for (const document of [readme, privacy, checklist]) {
    expect(document).toContain("最多 5 条收藏夹");
    expect(document).toContain("总数最多 20 条");
    expect(document).toContain("`bookmarks`");
  }
});
```

同步把 `tests/release-scripts.test.ts` 的 Manifest 夹具权限末尾加入 `bookmarks`。

- [ ] **Step 2: 运行发布测试并确认旧权限导致失败**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: FAIL，Manifest、发布白名单和文档尚未包含 `bookmarks`。

- [ ] **Step 3: 更新精确权限与中文说明**

将 Manifest 权限改为：

```json
["sidePanel", "tabs", "tabGroups", "storage", "history", "sessions", "bookmarks"]
```

`scripts/check-dist.mjs` 使用完全相同的顺序和错误提示。README、隐私政策与检查清单明确：

- 空查询不读取收藏夹。
- 非空查询按需在本地调用 `chrome.bookmarks.search()`。
- 最多 5 条收藏夹置顶，历史补足至总数最多 20 条。
- 收藏夹结果不持久化、不上传，不缓存完整收藏夹树。
- `bookmarks` 是读取收藏夹搜索结果所需权限，升级时 Chrome 可能要求用户确认新权限。

本阶段不修改版本号、发布文件数量和 `update.log`，这些在完成另外两项 0.8.2 需求后统一处理。

- [ ] **Step 4: 运行发布测试和产物检查**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: 全部 PASS，Windows 符号链接用例可按现有条件跳过。

Run: `npm run build && node scripts/check-dist.mjs`

Expected: 构建成功，现阶段仍精确包含 15 个审核文件。

- [ ] **Step 5: 提交权限与文档**

```powershell
$message = "$(Get-Date -Format yyyyMMddHHmmss) feat 声明收藏夹搜索权限与隐私用途"
git add manifest.json scripts/check-dist.mjs tests/smoke.test.ts tests/release-scripts.test.ts README.md docs/privacy-policy.md docs/chrome-web-store-checklist.md
git commit -m $message
```

### Task 6: 完整回归与性能验证

**Files:**
- Verify only

- [ ] **Step 1: 运行完整工程检查**

Run: `npm run check`

Expected: 类型检查、全部 Vitest、构建和 `dist` 审计通过；测试总数高于修改前的 637 项，现有 Windows 符号链接测试最多跳过 1 项。

- [ ] **Step 2: 运行标签渲染性能基准**

Run: `npm run benchmark:tabs`

Expected: 100 和 500 标签基准完成；收藏夹搜索没有改变标签渲染器，P95 保持既有门槛内，堆内存没有明显回退。

- [ ] **Step 3: 检查差异和工作树**

Run: `git diff --check`

Expected: 无空白错误。

Run: `git status --short`

Expected: 工作树干净；`release/` 仍由 `.gitignore` 排除，本阶段不生成最终 0.8.2 ZIP。

## 完成标准

- 空搜索只查询历史记录，行为与 0.8.1 一致。
- 非空搜索并行查询收藏夹和历史记录，收藏夹最多 5 条置顶，最终结果最多 20 条。
- 收藏夹内部和跨来源按主机名及端口与规范化路径去重，收藏夹优先。
- 任一来源失败时另一来源仍可展示，两项失败才显示错误。
- 快速输入、失焦、点击与销毁后的异步保护没有回归。
- Manifest 精确新增 `bookmarks`，无主机权限和 content script。
- 不缓存完整收藏夹树，不新增监听器、轮询或持久化搜索结果。
- 完整测试、构建、产物审计和性能基准通过。
