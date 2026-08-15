# 标签图标、对齐与字体优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让标签页和快捷网站优先使用 Chrome `favIconUrl`，逐级回退到网站根 favicon 和首字符，同时统一标签内容对齐、支持 12–18px 标题字号设置并保持底部工具栏固定。

**Architecture:** 新增 `favicon-model.ts` 作为纯数据模块，集中处理安全图片 URL、HTTP Origin、根 favicon 候选和同源标签映射。现有设置对象增加向后兼容的 `tabTitleFontSize`，设置渲染器通过回调只更新根节点 CSS 变量；标签与快捷入口渲染器分别维护自己的 `<img>` 回退状态，`sidebar.ts` 在标签快照和事件完成后把内存中的 Origin 映射同步给快捷入口。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3、原生 DOM、CSS Grid、Vitest、jsdom、esbuild。

---

### Task 1: 建立共享 favicon 候选与同源映射模型

**Files:**
- Create: `src/sidepanel/favicon-model.ts`
- Create: `tests/favicon-model.test.ts`

- [ ] **Step 1: 写 URL 与候选顺序的失败测试**

在 `tests/favicon-model.test.ts` 中覆盖允许协议、根路径派生、去重和非 HTTP 页面：

```ts
import { describe, expect, it } from "vitest";
import {
  createFaviconCandidates,
  createOriginFaviconMap,
  getHttpOrigin,
} from "../src/sidepanel/favicon-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

describe("favicon model", () => {
  it("orders a Chrome favicon before the website root favicon", () => {
    expect(
      createFaviconCandidates(
        "https://cdn.example/icon.png",
        "https://example.com/docs/page",
      ),
    ).toEqual([
      "https://cdn.example/icon.png",
      "https://example.com/favicon.ico",
    ]);
  });

  it("allows data, HTTP and HTTPS images but rejects dangerous protocols", () => {
    expect(createFaviconCandidates("data:image/png;base64,AA", "chrome://settings"))
      .toEqual(["data:image/png;base64,AA"]);
    expect(createFaviconCandidates("http://example.com/icon.png", "http://example.com/a"))
      .toEqual(["http://example.com/icon.png", "http://example.com/favicon.ico"]);
    expect(createFaviconCandidates("javascript:alert(1)", "chrome://settings"))
      .toEqual([]);
    expect(getHttpOrigin("https://example.com:8443/a")).toBe("https://example.com:8443");
    expect(getHttpOrigin("chrome://settings")).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm test -- --run tests/favicon-model.test.ts`

Expected: FAIL，提示无法解析 `../src/sidepanel/favicon-model`。

- [ ] **Step 3: 实现安全候选生成**

在 `src/sidepanel/favicon-model.ts` 中实现：

```ts
import type { TabViewModel } from "./tab-model";

export function getAllowedImageUrl(raw: string | undefined): string {
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function getHttpOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

export function createFaviconCandidates(
  favIconUrl: string | undefined,
  pageUrl: string,
): string[] {
  const primary = getAllowedImageUrl(favIconUrl);
  const origin = getHttpOrigin(pageUrl);
  const root = origin ? `${origin}/favicon.ico` : "";
  return [...new Set([primary, root].filter(Boolean))];
}
```

- [ ] **Step 4: 写同源映射选择规则的失败测试**

继续在 `tests/favicon-model.test.ts` 添加 `tab()` 测试工厂，并断言活动标签优先、否则索引最小、无效图标被忽略：

```ts
function tab(overrides: Partial<TabViewModel>): TabViewModel {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    title: "Example",
    url: "https://example.com/",
    domain: "example.com",
    active: false,
    pinned: false,
    ...overrides,
  };
}

it("selects the active same-origin favicon, then the lowest tab index", () => {
  const active = createOriginFaviconMap([
    tab({ id: 1, index: 0, favIconUrl: "https://example.com/old.png" }),
    tab({ id: 2, index: 4, active: true, favIconUrl: "data:image/png;base64,new" }),
  ]);
  expect(active.get("https://example.com")).toBe("data:image/png;base64,new");

  const indexed = createOriginFaviconMap([
    tab({ id: 3, index: 8, favIconUrl: "https://example.com/late.png" }),
    tab({ id: 4, index: 2, favIconUrl: "http://example.com/early.png" }),
    tab({ id: 5, index: 1, favIconUrl: "javascript:alert(1)" }),
  ]);
  expect(indexed.get("https://example.com")).toBe("http://example.com/early.png");
});
```

- [ ] **Step 5: 运行测试并确认缺少映射函数**

Run: `npm test -- --run tests/favicon-model.test.ts`

Expected: FAIL，提示 `createOriginFaviconMap` 未导出或不是函数。

- [ ] **Step 6: 实现确定性的 Origin 映射**

在 `favicon-model.ts` 添加：

```ts
export function createOriginFaviconMap(
  tabs: readonly TabViewModel[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const ordered = [...tabs].sort(
    (left, right) => Number(right.active) - Number(left.active) || left.index - right.index,
  );
  for (const tab of ordered) {
    const origin = getHttpOrigin(tab.url);
    const favicon = getAllowedImageUrl(tab.favIconUrl);
    if (origin && favicon && !result.has(origin)) result.set(origin, favicon);
  }
  return result;
}
```

- [ ] **Step 7: 验证纯模型测试并提交**

Run: `npm test -- --run tests/favicon-model.test.ts`

Expected: PASS。

```powershell
git add src/sidepanel/favicon-model.ts tests/favicon-model.test.ts
git commit -m "feat: model favicon fallback candidates"
```

### Task 2: 增加可持久化的标签标题字号设置

**Files:**
- Modify: `src/sidepanel/shortcut-model.ts`
- Modify: `src/sidepanel/shortcut-store.ts`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/shortcut-renderer.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/shortcut-model.test.ts`
- Modify: `tests/shortcut-store.test.ts`
- Modify: `tests/shortcut-renderer.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写默认值、范围验证和旧数据迁移的失败测试**

扩展模型测试，要求默认设置显式包含字号，旧设置缺少字段时迁移为 14，合法范围为 12 至 18 的整数：

```ts
expect(createDefaultShortcutSettings().tabTitleFontSize).toBe(14);

const legacy = validateShortcutSettings({
  enabled: true,
  items: [{ id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" }],
});
expect(legacy).toMatchObject({ ok: true, value: { tabTitleFontSize: 14 } });

for (const value of [12, 14, 18]) {
  expect(validateShortcutSettings({ enabled: false, items: [], tabTitleFontSize: value }).ok)
    .toBe(true);
}
for (const value of [11, 19, 14.5, Number.NaN, "14"]) {
  expect(validateShortcutSettings({ enabled: false, items: [], tabTitleFontSize: value }).ok)
    .toBe(false);
}
```

在 store 测试中断言旧对象读取后返回迁移后的 14，保存对象始终包含 `tabTitleFontSize`。

- [ ] **Step 2: 运行模型和存储测试并确认字段缺失导致失败**

Run: `npm test -- --run tests/shortcut-model.test.ts tests/shortcut-store.test.ts`

Expected: FAIL，默认设置没有 `tabTitleFontSize`，旧对象不会生成迁移字段。

- [ ] **Step 3: 最小实现设置字段与兼容验证**

修改类型和默认值：

```ts
export const DEFAULT_TAB_TITLE_FONT_SIZE = 14;
export const MIN_TAB_TITLE_FONT_SIZE = 12;
export const MAX_TAB_TITLE_FONT_SIZE = 18;

export type ShortcutSettings = {
  enabled: boolean;
  items: Shortcut[];
  tabTitleFontSize: number;
};
```

`createDefaultShortcutSettings()` 显式返回 14。`validateShortcutSettings()` 在字段为 `undefined` 时迁移为 14；字段存在时必须为有限整数且处于闭区间 12–18。返回的标准化对象始终包含该字段。更新所有测试工厂和直接构造的设置对象。

- [ ] **Step 4: 写设置弹窗即时预览、取消恢复和保存的失败测试**

在测试 DOM 中增加 `#tab-title-font-size` 数字输入。扩展回调为：

```ts
onFontSizePreview(size: number): void;
```

测试流程：`render()` 应用已保存的 14；打开设置后输入 18 立即调用预览 18；点击取消、触发 dialog `cancel` 或未保存 `close` 时恢复 14；重新打开输入 16 并保存后保留 16；Reset 将草稿和预览恢复为 14；无效输入不触发预览且提交显示验证错误。

- [ ] **Step 5: 运行渲染器测试并确认缺少输入与回调**

Run: `npm test -- --run tests/shortcut-renderer.test.ts`

Expected: FAIL，渲染器元素和回调没有字号支持。

- [ ] **Step 6: 实现设置弹窗与预览生命周期**

在 `index.html` 中把弹窗标题改为“设置”，在快捷网站开关之前加入：

```html
<section class="appearance-settings" aria-labelledby="appearance-settings-title">
  <h3 id="appearance-settings-title">外观</h3>
  <label for="tab-title-font-size">标签标题字号</label>
  <input id="tab-title-font-size" type="number" min="12" max="18" step="1" inputmode="numeric" />
</section>
```

`ShortcutRendererElements` 增加 `fontSize`，`ShortcutRendererCallbacks` 增加 `onFontSizePreview`。打开弹窗时用当前保存值建立 draft；数字输入为 12–18 的整数时更新 draft 并调用预览。取消、`cancel` 和未保存 `close` 调用 `onFontSizePreview(current.tabTitleFontSize)`；保存成功先更新 `current`，再关闭，避免 close 恢复旧值。

`copySettings()`、Reset、Submit 全部保留显式字号字段。保存失败保持弹窗和当前预览，用户取消后仍恢复已保存值。

- [ ] **Step 7: 在侧边栏根节点应用 CSS 变量**

`SidebarElements` 获取字号输入并传给渲染器；回调只执行：

```ts
onFontSizePreview(size) {
  deps.document.documentElement.style.setProperty(
    "--tab-title-font-size",
    `${size}px`,
  );
},
```

CSS 提供无脚本回退并只作用于标题：

```css
:root {
  --tab-title-font-size: 14px;
}

.tab-title {
  font-size: var(--tab-title-font-size);
}
```

- [ ] **Step 8: 写并验证侧边栏持久化集成测试**

在 `tests/sidebar.test.ts` 断言旧存储加载后根变量为 `14px`；设置为 17 保存后 `chrome.storage.local.set` 收到 `tabTitleFontSize: 17`；重新启动侧边栏后变量仍为 `17px`。同时断言搜索框和设置弹窗的计算字号规则未引用该变量。

Run: `npm test -- --run tests/shortcut-model.test.ts tests/shortcut-store.test.ts tests/shortcut-renderer.test.ts tests/sidebar.test.ts`

Expected: PASS。

- [ ] **Step 9: 提交字号设置功能**

```powershell
git add src/sidepanel/shortcut-model.ts src/sidepanel/shortcut-store.ts src/sidepanel/index.html src/sidepanel/shortcut-renderer.ts src/sidepanel/sidebar.ts src/sidepanel/sidebar.css tests/shortcut-model.test.ts tests/shortcut-store.test.ts tests/shortcut-renderer.test.ts tests/sidebar.test.ts
git commit -m "feat: configure tab title font size"
```

### Task 3: 为标签渲染器加入 favIconUrl 优先回退链和固定占位列

**Files:**
- Modify: `src/sidepanel/tab-renderer.ts`
- Modify: `tests/tab-renderer.test.ts`

- [ ] **Step 1: 修改测试，要求所有标签保留图钉列**

在现有首个渲染测试中，将普通标签断言改为始终存在 `.pin-indicator`，但普通标签的图钉不可见：

```ts
const ordinaryPin = ordinaryRow.querySelector<HTMLElement>(".pin-indicator");
expect(ordinaryPin).not.toBeNull();
expect(ordinaryPin?.dataset.visible).toBe("false");
expect(ordinaryPin?.getAttribute("aria-hidden")).toBe("true");
expect(Array.from(ordinaryRow.querySelector(".tab-main")?.children ?? [], (child) => child.className))
  .toEqual(["pin-indicator", "tab-favicon", "tab-title"]);
```

- [ ] **Step 2: 添加 favicon 逐级回退和节点复用测试**

添加测试：初始使用 `favIconUrl`，第一次 `error` 切到根 favicon，第二次 `error` 显示首字；仅标题或 active 变化时复用当前图片节点：

```ts
it("falls back from the Chrome favicon to the root favicon and then a letter", () => {
  const renderer = createTabRenderer({ list, empty });
  renderer.render([tab({ favIconUrl: "https://cdn.example/icon.png" })]);
  const image = list.querySelector<HTMLImageElement>("img")!;
  expect(image.src).toBe("https://cdn.example/icon.png");

  image.dispatchEvent(new Event("error"));
  expect(image.src).toBe("https://example.com/favicon.ico");

  image.dispatchEvent(new Event("error"));
  expect(list.querySelector("img")).toBeNull();
  expect(list.querySelector(".tab-favicon-fallback")?.textContent).toBe("E");
});
```

- [ ] **Step 3: 运行标签渲染测试并确认失败原因正确**

Run: `npm test -- --run tests/tab-renderer.test.ts`

Expected: FAIL，普通标签没有占位图钉，且第一次图片错误直接显示首字。

- [ ] **Step 4: 最小实现固定图钉节点和候选回退**

修改 `tab-renderer.ts`：

```ts
import { createFaviconCandidates } from "./favicon-model";

function updatePin(main: HTMLElement, pinned: boolean): void {
  let pin = main.querySelector<HTMLElement>(":scope > .pin-indicator");
  if (!pin) {
    pin = document.createElement("span");
    pin.className = "pin-indicator";
    pin.setAttribute("aria-hidden", "true");
    main.prepend(pin);
  }
  pin.dataset.visible = String(pinned);
}
```

将 favicon 更新改为使用 `createFaviconCandidates(tab.favIconUrl, tab.url)`。图片保存唯一候选键和下一候选 URL：

```ts
function createFaviconImage(candidates: readonly string[], fallback: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "tab-favicon-image";
  image.src = candidates[0] ?? "";
  image.dataset.nextUrl = candidates[1] ?? "";
  image.dataset.fallback = fallback;
  image.width = 16;
  image.height = 16;
  image.alt = "";
  image.loading = "lazy";
  return image;
}
```

错误监听先读取并清空 `data-next-url`；有下一候选时只更新 `src`，否则替换为首字符。`updateFavicon` 只在 `candidates.join("\n")` 改变时重建节点。

- [ ] **Step 5: 更新已有协议测试并验证标签渲染器**

把旧的 HTTP 回退断言改为允许 HTTP 图片；保留 `javascript:`、`file:` 等危险协议回退测试。

Run: `npm test -- --run tests/tab-renderer.test.ts tests/favicon-model.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交标签渲染修改**

```powershell
git add src/sidepanel/tab-renderer.ts tests/tab-renderer.test.ts
git commit -m "feat: add tab favicon fallback chain"
```

### Task 4: 让快捷入口复用同源标签 favicon 并改为无边框图标

**Files:**
- Modify: `src/sidepanel/shortcut-renderer.ts`
- Modify: `tests/shortcut-renderer.test.ts`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写快捷入口候选与关闭状态的失败测试**

扩展 `ShortcutRenderer` API，测试 `setFaviconsByOrigin()`；启用时优先同源映射，失败切根 favicon再切首字，禁用时没有 `<img>`：

```ts
renderer.setFaviconsByOrigin(
  new Map([["https://example.com", "data:image/png;base64,tab-icon"]]),
);
renderer.render(settings({ enabled: true }));
const image = elements.strip.querySelector<HTMLImageElement>("img")!;
expect(image.src).toBe("data:image/png;base64,tab-icon");
image.dispatchEvent(new Event("error"));
expect(image.src).toBe("https://example.com/favicon.ico");
image.dispatchEvent(new Event("error"));
expect(elements.strip.querySelector(".shortcut-letter")?.textContent).toBe("E");

renderer.render(settings({ enabled: false }));
expect(elements.strip.querySelector("img")).toBeNull();
```

- [ ] **Step 2: 运行测试并确认 API 尚不存在**

Run: `npm test -- --run tests/shortcut-renderer.test.ts`

Expected: FAIL，提示 `setFaviconsByOrigin` 不存在。

- [ ] **Step 3: 实现快捷入口映射与回退链**

修改公开类型并在渲染器闭包中保存映射：

```ts
export type ShortcutRenderer = {
  render(settings: ShortcutSettings): void;
  setFaviconsByOrigin(favicons: ReadonlyMap<string, string>): void;
  openSettings(settings: ShortcutSettings): void;
  setError(message: string): void;
  destroy(): void;
};

let faviconsByOrigin: ReadonlyMap<string, string> = new Map();
```

`createShortcutButton()` 使用 `getHttpOrigin(shortcut.url)` 查映射，再调用 `createFaviconCandidates(mapped, shortcut.url)`。图片保存 `data-next-url` 和首字符；错误处理与标签渲染器一致。删除 `shortcutIconPaths` 的运行时选择逻辑，但保留设置模型中的 `icon` 字段。

`setFaviconsByOrigin()` 比较键值内容；映射未变化时不重绘，变化且快捷入口开启时才调用 `renderStrip(current)`。

- [ ] **Step 4: 写无边框快捷按钮与标签字体的 CSS 失败测试**

在 `tests/sidepanel-css.test.ts` 添加：

```ts
expect(css).toMatch(/\.shortcut-button\s*{[^}]*border(?:-color)?:\s*(?:0|transparent)[^}]*background:\s*transparent/s);
expect(css).toMatch(/\.shortcut-button\s*{[^}]*width:\s*32px[^}]*height:\s*32px/s);
expect(css).toMatch(/\.tab-title\s*{[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑"[^}]*font-size:\s*var\(--tab-title-font-size\)/s);
```

- [ ] **Step 5: 运行 CSS 测试并确认失败**

Run: `npm test -- --run tests/sidepanel-css.test.ts`

Expected: FAIL，快捷按钮仍继承可见边框，标签标题没有 14px 微软雅黑。

- [ ] **Step 6: 实现对齐、字体和无边框样式**

修改 `sidebar.css`：

```css
.shortcut-button {
  width: 32px;
  height: 32px;
  border-color: transparent;
  background: transparent;
}

.tab-main,
.tab-row[data-has-pin="true"] .tab-main {
  grid-template-columns: 12px 16px minmax(0, 1fr);
}

.pin-indicator[data-visible="false"] {
  visibility: hidden;
}

.tab-title {
  font-family: "Microsoft YaHei", "微软雅黑", "Segoe UI", system-ui, sans-serif;
  font-size: var(--tab-title-font-size);
}
```

保留现有 `:focus-visible` 轮廓和悬停反馈；不得给普通占位图钉增加文字或可访问名称。

- [ ] **Step 7: 验证快捷渲染和 CSS 测试并提交**

Run: `npm test -- --run tests/shortcut-renderer.test.ts tests/sidepanel-css.test.ts`

Expected: PASS。

```powershell
git add src/sidepanel/shortcut-renderer.ts tests/shortcut-renderer.test.ts src/sidepanel/sidebar.css tests/sidepanel-css.test.ts
git commit -m "feat: align tab content and render shortcut favicons"
```

### Task 5: 将标签 favicon 映射同步给快捷入口

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写初始快照和标签事件同步的失败测试**

在 `tests/sidebar.test.ts` 使用已启用的 `https://docs.example/` 快捷入口和同源标签：

```ts
const fake = createFakeChrome({
  tabs: [{
    id: 7,
    windowId: 1,
    index: 0,
    title: "Docs",
    url: "https://docs.example/page",
    favIconUrl: "data:image/png;base64,docs",
    active: true,
    pinned: false,
  }],
  shortcutSettings: {
    enabled: true,
    items: [{ id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" }],
  },
});
await startSidebar(fake.dependencies);
expect(document.querySelector<HTMLImageElement>(".shortcut-button img")?.src)
  .toBe("data:image/png;base64,docs");
```

再触发 `onUpdated` 提供新的同源 `favIconUrl`，等待事件处理完成后断言快捷入口图片更新；触发移除后断言回退为 `https://docs.example/favicon.ico`。

- [ ] **Step 2: 运行集成测试并确认快捷入口仍使用旧本地图标或根回退**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，同源标签 favicon 没有传给快捷入口。

- [ ] **Step 3: 在标签快照和事件边界同步 Origin 映射**

修改 `sidebar.ts`：

```ts
import { createOriginFaviconMap } from "./favicon-model";

const syncShortcutFavicons = (): void => {
  shortcutRenderer.setFaviconsByOrigin(createOriginFaviconMap(tabStore.list()));
};
```

在非缓冲 `applyTabEvent` 中于 `mutate()` 后调用 `syncShortcutFavicons()`；初始快照及全部缓冲事件应用完成后调用一次。这样 created、updated、activated、removed、attached、detached、moved 均共享同一同步边界，不在每个事件分支复制逻辑。

- [ ] **Step 4: 验证集成测试和相关事件测试**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-events.test.ts tests/tab-store.test.ts`

Expected: PASS；关闭快捷入口时 DOM 中没有快捷网站图片。

- [ ] **Step 5: 提交侧边栏协调修改**

```powershell
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts
git commit -m "feat: sync tab favicons to shortcuts"
```

### Task 6: 更新 CSP、发布契约和隐私说明

**Files:**
- Modify: `manifest.json`
- Modify: `scripts/check-dist.mjs`
- Modify: `scripts/build.mjs`
- Modify: `scripts/release-files.mjs`
- Modify: `tests/release-scripts.test.ts`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`

- [ ] **Step 1: 先修改发布测试，要求精确允许 HTTP/HTTPS 图片**

把测试清单中的 CSP 改为：

```text
script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'
```

增加“缺少 HTTP 图片源”拒绝案例，并保留 wildcard、远程 `connect-src`、unsafe-inline、unsafe-eval 等拒绝案例。

同时将发布文件契约删除：

```text
assets/shortcuts/openai.png
assets/shortcuts/google.png
assets/shortcuts/github.png
```

期望发布文件数从 14 调整为 11。

- [ ] **Step 2: 运行发布测试并确认旧 CSP 与旧文件契约导致失败**

Run: `npm test -- --run tests/release-scripts.test.ts`

Expected: FAIL，CSP 缺少 `http:` 且构建仍包含三个未使用的快捷图标。

- [ ] **Step 3: 更新 Manifest、CSP 校验和构建复制范围**

修改 `manifest.json` 的 `img-src`，并让 `validateExtensionCsp()` 的精确允许集合包含 `http:`。

修改 `scripts/build.mjs`，只复制运行时仍引用的图标目录：

```js
await mkdir(resolve(dist, "assets"), { recursive: true });
await cp(resolve(root, "assets/icons"), resolve(dist, "assets/icons"), {
  recursive: true,
});
```

修改 `EXPECTED_FILES` 删除三个快捷网站 PNG；源仓库中的兼容资产可保留，但不得进入 `dist` 或 ZIP。

- [ ] **Step 4: 更新隐私与图标来源说明**

在 `README.md` 和 `docs/chrome-web-store-checklist.md` 明确：

```text
标签页优先使用 Chrome 提供的 favIconUrl；快捷网站优先复用当前窗口同源标签的 favIconUrl。必要时浏览器会向 HTTP 或 HTTPS 网站的 /favicon.ico 发起图片请求。扩展不使用 fetch、XHR、第三方 favicon 服务或远程代码。
```

删除“快捷入口默认使用本地图标”的旧说明。

- [ ] **Step 5: 验证发布审计并提交**

Run: `npm test -- --run tests/release-scripts.test.ts tests/assets.test.ts`

Expected: PASS，仓库资产仍有效，发布包契约精确为 11 个文件。

```powershell
git add manifest.json scripts/check-dist.mjs scripts/build.mjs scripts/release-files.mjs tests/release-scripts.test.ts README.md docs/chrome-web-store-checklist.md
git commit -m "chore: allow website favicon images in release"
```

### Task 7: 全量验证、视觉验收和重新打包

**Files:**
- Modify only if verification reveals a scoped defect.
- Generated (ignored): `dist/`
- Generated (ignored): `release/sidetab-lite-0.1.0.zip`

- [ ] **Step 1: 运行全量自动验证**

Run: `npm run check`

Expected: 类型检查通过，全部 Vitest 测试通过，构建成功，`dist check passed`，无失败或未处理异常。

- [ ] **Step 2: 启动本地构建预览并注入 Chrome API 测试数据**

使用最终 `dist/sidepanel/index.html`，在页面脚本执行前注入包含固定/普通标签、HTTP/HTTPS favicon、失败 favicon、同源快捷网站和长中文标题的最小 `chrome.tabs`、`chrome.windows`、`chrome.storage.local` 模拟。该预览只用于渲染验收，不替代扩展 API 自动测试。

- [ ] **Step 3: 在四个宽度完成视觉和交互检查**

在 180、240、300、360px × 720px 下截图并检查：

```text
- 固定与普通标签均为 30px，favicon 和标题列完全对齐
- 普通标签的图钉占位不可见且不留下额外文字
- 标题为 14px 微软雅黑优先字体，长标题单行省略
- 设置弹窗可在 12–18px 间即时预览；取消恢复，保存后重新载入仍生效
- 12px 与 18px 均不改变 30px 行高，不造成垂直裁切
- 快捷入口只有图标、无可见边框，失败时为首字符
- 搜索过滤正常，设置弹窗可打开
- 搜索框和设置按钮始终贴住整个视口底边
- document.documentElement.scrollWidth === window.innerWidth
- 控制台无应用错误或未处理异常
```

明暗配色至少各检查一个宽度。

- [ ] **Step 4: 重新生成并验证 Chrome 安装包**

Run: `npm run package`

Expected: 全量检查再次通过，生成 `release/sidetab-lite-0.1.0.zip`，ZIP 精确包含 11 个发布文件且逐字节匹配 `dist`。

- [ ] **Step 5: 记录发布证据并提交必要的最终修复**

Run:

```powershell
git status --short
git diff --check
Get-FileHash -Algorithm SHA256 release/sidetab-lite-0.1.0.zip
```

Expected: 工作树干净，`git diff --check` 无输出，显示最终 ZIP SHA-256。若视觉验收发现缺陷，必须先按测试驱动方式增加失败测试、最小修复、重新执行 Task 7 全部步骤并单独提交；不得把生成的 `dist/` 或 `release/` 加入 Git。
