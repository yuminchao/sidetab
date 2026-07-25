# 紧凑标签列表实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将标签列表改为约 30px 的单行紧凑布局，把搜索框和设置按钮固定到底部，并重新生成可安装的 Chrome 包。

**Architecture:** 保留现有 `TabStore`、Chrome 事件和快捷设置架构，只调整标签排序、DOM 结构、渲染器、CSS、favicon CSP 与发布检查。固定标签在 store 输出层优先排序；渲染层只显示图钉、favicon 和标题，域名继续保留用于搜索。

**Tech Stack:** TypeScript、原生 DOM/CSS、Vitest/jsdom、Chrome MV3、esbuild、fflate

---

## Task 1：固定标签优先排序

**Files:**
- Modify: `src/sidepanel/tab-store.ts`
- Modify: `tests/tab-store.test.ts`

- [ ] **Step 1：写固定标签优先的失败测试**

```ts
it("lists pinned tabs before normal tabs while preserving each group index order", () => {
  const store = new TabStore();
  store.initialize([
    tab(1, 0, { pinned: false, title: "Normal A" }),
    tab(2, 3, { pinned: true, title: "Pinned B" }),
    tab(3, 1, { pinned: true, title: "Pinned A" }),
    tab(4, 2, { pinned: false, title: "Normal B" }),
  ]);
  expect(store.list().map(({ id }) => id)).toEqual([3, 2, 1, 4]);
  expect(store.filter("").map(({ id }) => id)).toEqual([3, 2, 1, 4]);
});
```

- [ ] **Step 2：运行并确认旧排序失败**

Run: `npm test -- --run tests/tab-store.test.ts`

Expected: FAIL，实际顺序仍只按 `index`。

- [ ] **Step 3：加入唯一排序比较器**

```ts
function compareTabs(left: TabViewModel, right: TabViewModel): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return left.index - right.index || left.id - right.id;
}
```

`list()` 和 `filter()` 必须复用该比较器；`move()`、插入和删除仍维护 Chrome 原始 index，不把视觉分组顺序写回 Chrome。

- [ ] **Step 4：验证 store 与全量回归**

Run: `npm test -- --run tests/tab-store.test.ts`

Expected: PASS。

Run: `npm test -- --run && npm run typecheck`

Expected: 所有测试通过，类型检查退出码 0。

- [ ] **Step 5：提交排序变更**

```bash
git add src/sidepanel/tab-store.ts tests/tab-store.test.ts
git commit -m "feat: list pinned tabs first"
```

## Task 2：紧凑单行渲染与固定底栏

**Files:**
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `tests/sidepanel-css.test.ts`
- Modify: `tests/sidebar.test.ts`
- Create: `assets/icons/pin.svg`
- Create: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1：写 DOM 和 CSS 契约失败测试**

测试必须断言：

```ts
expect(document.querySelector(".tab-domain")).toBeNull();
expect(document.querySelector(".pin-indicator")?.textContent).not.toContain("固定");
expect(document.querySelector(".tab-main")?.getAttribute("aria-label")).toContain("已固定");
expect(document.querySelector(".bottom-toolbar")?.contains(document.querySelector("#tab-search"))).toBe(true);
expect(document.querySelector(".bottom-toolbar")?.contains(document.querySelector("#shortcut-settings"))).toBe(true);
```

CSS 文件测试断言存在 `--tab-row-height: 30px`、`.tab-row { min-height: var(--tab-row-height) }`、`.tab-list { overflow-y: auto }`、`.bottom-toolbar` 固定网格、`minmax(0, 1fr)`，并确认 `.tab-row` 没有 `border-bottom`、页面没有正值 `min-width`。

- [ ] **Step 2：运行测试并确认旧双行顶部布局失败**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts`

Expected: FAIL，旧页面仍有域名、46px 行高和顶部搜索工具栏。

- [ ] **Step 3：调整 HTML 结构**

`index.html` 主结构改为：

```html
<main class="sidebar-shell">
  <header class="shortcut-region">
    <div id="shortcut-strip" class="shortcut-strip" hidden></div>
  </header>
  <section class="tab-region" aria-label="当前窗口标签页">
    <div id="tab-empty" class="empty-state" hidden>没有匹配的标签页</div>
    <div id="tab-list" class="tab-list" role="list"></div>
  </section>
  <p id="status-message" class="status-message" role="status" aria-live="polite"></p>
  <footer class="bottom-toolbar">
    <input id="tab-search" type="search" placeholder="搜索标签页" aria-label="搜索标签页" autocomplete="off" />
    <button id="shortcut-settings" class="icon-button" type="button" title="快捷网站设置" aria-label="快捷网站设置">&#9881;</button>
  </footer>
</main>
```

没有状态文字时 `.status-message:empty { display: none; }`，因此底栏上方不保留空白。

- [ ] **Step 4：实现紧凑标签 DOM**

`tab-renderer.ts` 每行结构固定为：

```text
.tab-row[data-pinned]
  button.tab-main
    span.pin-indicator（仅 pinned 创建，img/SVG 无“固定”文本）
    span.favicon-slot
    span.tab-title
  button.tab-close
```

删除 `.tab-domain`。固定行的 `tab-main` 可访问名称为 `${title}，已固定`；非固定行为 `${title}`。`patch()` 必须能新增或移除 pin 节点且保留未变化 favicon 的节点身份。pin 使用本地 `assets/icons/pin.svg`，SVG 采用 Lucide Pin 的 24×24 viewBox、`currentColor`/单色路径，并在 `THIRD_PARTY_NOTICES.md` 记录 Lucide ISC 来源；构建会原样复制该资产。

- [ ] **Step 5：调整 CSS 密度和窄宽度**

核心 CSS 使用：

```css
:root { --tab-row-height: 30px; }
.sidebar-shell { grid-template-rows: auto minmax(0, 1fr) auto auto; min-width: 0; }
.shortcut-region:has(.shortcut-strip[hidden]) { display: none; }
.tab-region { min-width: 0; min-height: 0; overflow: hidden; }
.tab-list { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.tab-row { min-height: var(--tab-row-height); border-bottom: 0; }
.tab-main { grid-template-columns: auto 18px minmax(0, 1fr); min-width: 0; }
.tab-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab-close { inline-size: 26px; block-size: 26px; opacity: 0; }
.tab-row:hover .tab-close,
.tab-row[data-active="true"] .tab-close,
.tab-close:focus-visible { opacity: 1; }
.bottom-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 4px; padding: 6px; }
```

普通标签没有 pin 占位时，渲染器给 `.tab-main` 增加 `data-has-pin="false"`，CSS 使用两列 `18px minmax(0,1fr)`。不得设置会把内容撑宽的正 `min-width`。180px 下设置对话框宽度为 `min(360px, calc(100vw - 8px))` 并允许内容纵向滚动。

- [ ] **Step 6：验证紧凑 UI**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts`

Expected: 所有目标测试通过。

Run: `npm test -- --run && npm run typecheck && npm run build`

Expected: 全量通过，构建成功。

- [ ] **Step 7：提交 UI 变更**

```bash
git add src/sidepanel/index.html src/sidepanel/sidebar.css src/sidepanel/tab-renderer.ts tests/tab-renderer.test.ts tests/sidepanel-css.test.ts tests/sidebar.test.ts assets/icons/pin.svg THIRD_PARTY_NOTICES.md
git commit -m "feat: compact tab rows and pin bottom toolbar"
```

## Task 3：允许 Chrome favicon 并重新发布打包

**Files:**
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `tests/tab-renderer.test.ts`
- Modify: `manifest.json`
- Modify: `tests/smoke.test.ts`
- Modify: `scripts/check-dist.mjs`
- Modify: `scripts/release-files.mjs`
- Modify: `tests/release-scripts.test.ts`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`

- [ ] **Step 1：写 HTTPS favicon 和 CSP 的失败测试**

```ts
it("renders Chrome-provided HTTPS favicons", () => {
  renderer.render([{ ...model, favIconUrl: "https://example.com/favicon.ico" }]);
  expect(document.querySelector<HTMLImageElement>(".favicon")?.src)
    .toBe("https://example.com/favicon.ico");
});
```

Manifest 测试要求 `img-src` 精确允许 `'self' data: https:`，其他 CSP 仍为：`connect-src 'none'`、`style-src 'self'`、`frame-src 'none'`、`script-src 'self'`、`object-src 'self'`。`EXPECTED_FILES` 增加 `assets/icons/pin.svg`，发布包条目从 12 项精确变为 13 项。

- [ ] **Step 2：运行并确认 CSP 与 favicon 测试失败**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: FAIL，旧实现拒绝 HTTPS favicon，CSP 也未允许 HTTPS 图片。

- [ ] **Step 3：实现受限 favicon 策略**

`tab-renderer.ts` 仅允许：

```ts
function isAllowedFaviconUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || raw.startsWith("data:image/");
  } catch {
    return raw.startsWith("data:image/");
  }
}
```

不拼接 `/favicon.ico`，不调用 `fetch`。HTTP、JavaScript、file 等协议继续使用首字符 fallback。HTTPS 图片加载失败继续由现有 capture `error` 处理。

- [ ] **Step 4：更新 CSP、发布检查和文档**

Manifest 图片策略改为 `img-src 'self' data: https:`。`check-dist` 的 CSP 精确解析同步更新，仍禁止连接、frame、远程脚本和远程样式。`release-files.mjs` 的精确白名单加入本地图钉 SVG，并验证它不包含脚本、外链或事件属性。README 与商店清单明确：扩展不主动请求 favicon API，但渲染 Chrome 提供的 HTTPS favicon URL 时浏览器可能使用缓存或发起图片请求。

- [ ] **Step 5：执行完整发布与确定性打包**

Run: `npm test -- --run`

Expected: 所有测试 0 失败。

Run: `npm run typecheck`

Expected: 退出码 0。

Run: `npm run package`

Expected: build、check-dist 和 ZIP 自验全部通过，输出 `release/sidetab-lite-0.1.0.zip`。

连续执行两次 `npm run package` 并计算 SHA-256，两个哈希必须一致。ZIP 根目录必须直接包含 `manifest.json`，条目集合与 `EXPECTED_FILES` 完全一致。

- [ ] **Step 6：真实 Chrome 页面视觉验证**

优先使用应用内 Browser；若仍不可用，记录原因并使用 Playwright + 本机 Chrome 加载 `dist/`，直接打开扩展的 `sidepanel/index.html`。用假 Chrome API 提供固定、普通、长标题和 favicon 失败样本，截取 180×720、240×720、300×720、360×720，并检查：

- 标签行约 30px、无域名、无分割线。
- 固定标签排在最前，图钉在行首且没有“固定”中文。
- 搜索框和设置按钮固定底部。
- 180px 无横向溢出或控件遮挡。
- HTTPS favicon 与 fallback 都可见。
- 明暗模式均保持可读。

- [ ] **Step 7：提交发布更新**

```bash
git add src/sidepanel/tab-renderer.ts tests/tab-renderer.test.ts manifest.json tests/smoke.test.ts scripts/check-dist.mjs scripts/release-files.mjs tests/release-scripts.test.ts README.md docs/chrome-web-store-checklist.md
git commit -m "chore: package compact side panel release"
```

最终保留：

- 可加载目录：`dist/`
- 商店上传包：`release/sidetab-lite-0.1.0.zip`
- 最新 ZIP SHA-256
