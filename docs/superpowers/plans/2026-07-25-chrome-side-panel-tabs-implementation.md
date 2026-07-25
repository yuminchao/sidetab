# Chrome 左侧标签栏扩展实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个性能优先、可加载到 Chrome 的 Manifest V3 左侧标签栏扩展，支持当前窗口标签搜索、切换、关闭，以及默认关闭的可配置网站快捷入口。

**Architecture:** 侧边栏页面是唯一的运行时状态所有者：标签状态只保存在内存中并由 `chrome.tabs` 事件更新，快捷网站设置只保存在 `chrome.storage.local`。运行时使用原生 TypeScript、DOM 和 CSS；Chrome API 通过小型适配器隔离，领域逻辑保持纯函数，便于使用 Vitest 测试。Service Worker 仅配置扩展图标打开侧边栏，不维护业务状态。

**Tech Stack:** Chrome Manifest V3、Chrome Side Panel API、TypeScript、原生 DOM/CSS、esbuild、Vitest、jsdom、Node.js 20+

---

## 文件结构与职责

```text
assets/
  icons/                         # 扩展图标，构建时原样复制
  shortcuts/                     # 三个默认网站的本地 PNG 图标
docs/
  chrome-web-store-checklist.md  # 权限、隐私和人工验收清单
scripts/
  build.mjs                      # 清理 dist、编译入口并复制静态文件
  check-dist.mjs                 # 检查发布包权限、远程代码和体积
  generate-icons.mjs             # 一次性生成本地 PNG 图标
src/
  background/
    service-worker.ts            # 点击扩展图标时打开侧边栏
  sidepanel/
    index.html                   # 侧边栏语义结构与设置对话框
    sidebar.css                  # 紧凑、响应式、无框架样式
    sidebar.ts                   # 页面启动与依赖装配
    shortcut-actions.ts          # 打开快捷网站
    shortcut-model.ts            # 默认值、URL 与设置校验
    shortcut-store.ts            # chrome.storage.local 适配器
    shortcut-renderer.ts         # 快捷区和设置对话框渲染
    tab-actions.ts               # 激活、关闭、新建标签页
    tab-events.ts                # Chrome 标签事件订阅和窗口过滤
    tab-model.ts                 # Chrome Tab 到视图模型转换
    tab-store.ts                 # 内存标签状态、排序和搜索
    tab-renderer.ts              # 首次渲染、筛选重绘和单行更新
tests/
  helpers/fake-chrome.ts         # 测试用 Chrome API 假实现
  *.test.ts                      # 与领域文件一一对应的测试
manifest.json                    # 仅声明 tabs、sidePanel、storage
package.json
tsconfig.json
vitest.config.ts
```

## Task 1：建立可构建、可测试的 MV3 工程

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `manifest.json`
- Create: `scripts/build.mjs`
- Create: `src/background/service-worker.ts`
- Create: `src/sidepanel/index.html`
- Create: `src/sidepanel/sidebar.ts`
- Create: `src/sidepanel/sidebar.css`
- Create: `tests/smoke.test.ts`
- Create: `.gitignore`

- [ ] **Step 1：写一个失败的工程冒烟测试**

创建 `tests/smoke.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("extension manifest", () => {
  it("uses MV3 with only the approved permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["sidePanel", "tabs", "storage"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
  });
});
```

- [ ] **Step 2：运行测试并确认因缺少工程文件而失败**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，提示缺少 `package.json`、Vitest 命令或 `manifest.json`。

- [ ] **Step 3：创建最小工具链与清单**

`package.json`：

```json
{
  "name": "sidetab-lite",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "npm run typecheck && npm test -- --run && npm run build && node scripts/check-dist.mjs",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.1.0",
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0",
    "sharp": "^0.34.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

安装时使用 `npm install`，由 npm 生成并提交 `package-lock.json`。如果实际安装解析到兼容的新补丁版本，保留 lockfile 的精确结果，不手改锁文件。

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["chrome", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    restoreMocks: true,
  },
});
```

`manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "SideTab Lite",
  "version": "0.1.0",
  "description": "A fast side panel for managing tabs in the current Chrome window.",
  "permissions": ["sidePanel", "tabs", "storage"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": {
    "default_title": "打开 SideTab Lite",
    "default_icon": {
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png"
    }
  },
  "icons": {
    "16": "assets/icons/icon-16.png",
    "32": "assets/icons/icon-32.png",
    "48": "assets/icons/icon-48.png",
    "128": "assets/icons/icon-128.png"
  },
  "side_panel": { "default_path": "sidepanel/index.html" }
}
```

`scripts/build.mjs`：

```js
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "background"), { recursive: true });
await mkdir(resolve(dist, "sidepanel"), { recursive: true });

await build({
  entryPoints: {
    "background/service-worker": resolve(root, "src/background/service-worker.ts"),
    "sidepanel/sidebar": resolve(root, "src/sidepanel/sidebar.ts"),
  },
  bundle: true,
  format: "esm",
  target: "chrome114",
  minify: true,
  outdir: dist,
  sourcemap: false,
});

try {
  await cp(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
await cp(resolve(root, "src/sidepanel/sidebar.css"), resolve(dist, "sidepanel/sidebar.css"));
await cp(resolve(root, "src/sidepanel/index.html"), resolve(dist, "sidepanel/index.html"));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
```

初始 `service-worker.ts` 只包含：

```ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
```

初始 `sidebar.ts` 只包含 `document.documentElement.dataset.ready = "true";`；`index.html` 引用本地 `sidebar.css` 和 `sidebar.js`，不包含内联脚本；`sidebar.css` 先设置 `color-scheme: light dark`、`body { margin: 0; }`。`.gitignore` 忽略 `node_modules/`、`dist/` 和 `coverage/`。

- [ ] **Step 4：运行冒烟测试、类型检查和首次构建**

Run: `npm install`

Expected: PASS，生成 `package-lock.json`，无安装错误。

Run: `npm test -- --run tests/smoke.test.ts && npm run typecheck && npm run build`

Expected: 1 个测试通过，TypeScript 退出码 0，`dist/manifest.json`、两个 JS 入口和侧边栏静态文件生成成功。图标尚未生成时构建跳过不存在的 `assets` 目录；Task 8 会补齐并验证引用。

- [ ] **Step 5：提交工程骨架**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts manifest.json scripts/build.mjs src tests/smoke.test.ts
git commit -m "build: scaffold MV3 extension"
```

## Task 2：实现快捷网站模型与校验

**Files:**
- Create: `src/sidepanel/shortcut-model.ts`
- Create: `tests/shortcut-model.test.ts`

- [ ] **Step 1：写默认关闭、URL 规范化和边界校验的失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  createDefaultShortcutSettings,
  normalizeShortcutUrl,
  validateShortcutSettings,
} from "../src/sidepanel/shortcut-model";

describe("shortcut model", () => {
  it("starts disabled with the three defaults", () => {
    expect(createDefaultShortcutSettings()).toEqual({
      enabled: false,
      items: [
        { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
        { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
        { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
      ],
    });
  });

  it.each([
    ["example.com", "https://example.com/"],
    ["https://example.com/docs", "https://example.com/docs"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeShortcutUrl(input)).toBe(expected);
  });

  it.each(["javascript:alert(1)", "data:text/plain,x", "file:///tmp/x", "not a host"])(
    "rejects %s",
    (input) => expect(() => normalizeShortcutUrl(input)).toThrow("仅支持 HTTP 或 HTTPS 地址"),
  );

  it("rejects duplicates and more than twelve items", () => {
    const base = createDefaultShortcutSettings();
    expect(validateShortcutSettings({ ...base, items: [...base.items, { ...base.items[0]!, id: "copy" }] })).toEqual({
      ok: false,
      message: "快捷网站地址不能重复",
    });
    expect(validateShortcutSettings({ enabled: true, items: Array.from({ length: 13 }, (_, i) => ({
      id: `id-${i}`, name: `Site ${i}`, url: `https://site-${i}.example/`, icon: "letter" as const,
    })) })).toEqual({ ok: false, message: "最多只能添加 12 个快捷网站" });
  });

  it("rejects malformed persisted values without throwing", () => {
    expect(validateShortcutSettings({ enabled: false } as unknown)).toEqual({
      ok: false,
      message: "快捷网站设置格式无效",
    });
  });
});
```

- [ ] **Step 2：运行测试并确认模块不存在**

Run: `npm test -- --run tests/shortcut-model.test.ts`

Expected: FAIL，提示无法解析 `shortcut-model`。

- [ ] **Step 3：实现明确、无副作用的模型 API**

`shortcut-model.ts` 必须导出以下完整公共接口：

```ts
export type ShortcutIcon = "openai" | "google" | "github" | "letter";
export type Shortcut = { id: string; name: string; url: string; icon: ShortcutIcon };
export type ShortcutSettings = { enabled: boolean; items: Shortcut[] };
export type ValidationResult = { ok: true; value: ShortcutSettings } | { ok: false; message: string };

const DEFAULT_ITEMS: readonly Shortcut[] = [
  { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
  { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
  { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
];

export function createDefaultShortcutSettings(): ShortcutSettings {
  return { enabled: false, items: DEFAULT_ITEMS.map((item) => ({ ...item })) };
}

export function normalizeShortcutUrl(raw: string): string {
  const value = raw.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) throw new Error();
    return url.href;
  } catch {
    throw new Error("仅支持 HTTP 或 HTTPS 地址");
  }
}

export function validateShortcutSettings(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, message: "快捷网站设置格式无效" };
  const candidate = input as { enabled?: unknown; items?: unknown };
  if (typeof candidate.enabled !== "boolean" || !Array.isArray(candidate.items)) {
    return { ok: false, message: "快捷网站设置格式无效" };
  }
  if (candidate.items.length > 12) return { ok: false, message: "最多只能添加 12 个快捷网站" };
  const ids = new Set<string>();
  const urls = new Set<string>();
  const items: Shortcut[] = [];
  for (const rawItem of candidate.items) {
    if (!rawItem || typeof rawItem !== "object") return { ok: false, message: "快捷网站设置格式无效" };
    const item = rawItem as Partial<Shortcut>;
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.url !== "string") {
      return { ok: false, message: "快捷网站设置格式无效" };
    }
    if (!(["openai", "google", "github", "letter"] as const).includes(item.icon as ShortcutIcon)) {
      return { ok: false, message: "快捷网站设置格式无效" };
    }
    const name = item.name.trim();
    if (!name) return { ok: false, message: "网站名称不能为空" };
    if (ids.has(item.id)) return { ok: false, message: "快捷网站 ID 不能重复" };
    let url: string;
    try { url = normalizeShortcutUrl(item.url); } catch { return { ok: false, message: "仅支持 HTTP 或 HTTPS 地址" }; }
    if (urls.has(url)) return { ok: false, message: "快捷网站地址不能重复" };
    ids.add(item.id);
    urls.add(url);
    items.push({ id: item.id, name, url, icon: item.icon as ShortcutIcon });
  }
  return { ok: true, value: { enabled: candidate.enabled, items } };
}
```

- [ ] **Step 4：运行测试和类型检查**

Run: `npm test -- --run tests/shortcut-model.test.ts && npm run typecheck`

Expected: 所有快捷模型测试通过，类型检查退出码 0。

- [ ] **Step 5：提交快捷网站领域逻辑**

```bash
git add src/sidepanel/shortcut-model.ts tests/shortcut-model.test.ts
git commit -m "feat: validate shortcut settings"
```

## Task 3：实现快捷配置的本地持久化

**Files:**
- Create: `src/sidepanel/shortcut-store.ts`
- Create: `tests/shortcut-store.test.ts`

- [ ] **Step 1：写读取默认值、保存校验和存储失败的测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { createShortcutStore } from "../src/sidepanel/shortcut-store";

describe("shortcut store", () => {
  it("returns defaults when storage is empty", async () => {
    const area = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    await expect(createShortcutStore(area).load()).resolves.toMatchObject({ enabled: false });
  });

  it("validates before writing", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = createShortcutStore(area);
    await expect(store.save({ enabled: true, items: [] })).resolves.toEqual({ enabled: true, items: [] });
    expect(area.set).toHaveBeenCalledWith({ shortcutSettings: { enabled: true, items: [] } });
  });

  it("does not hide storage write failures", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockRejectedValue(new Error("quota")) };
    await expect(createShortcutStore(area).save({ enabled: true, items: [] })).rejects.toThrow("无法保存快捷网站设置");
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npm test -- --run tests/shortcut-store.test.ts`

Expected: FAIL，提示无法解析 `shortcut-store`。

- [ ] **Step 3：实现可注入的存储适配器**

```ts
import {
  createDefaultShortcutSettings,
  validateShortcutSettings,
  type ShortcutSettings,
} from "./shortcut-model";

const STORAGE_KEY = "shortcutSettings";

export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function createShortcutStore(area: StorageArea) {
  return {
    async load(): Promise<ShortcutSettings> {
      let stored: Record<string, unknown>;
      try { stored = await area.get(STORAGE_KEY); } catch { throw new Error("无法读取快捷网站设置"); }
      if (!(STORAGE_KEY in stored)) return createDefaultShortcutSettings();
      const result = validateShortcutSettings(stored[STORAGE_KEY] as ShortcutSettings);
      return result.ok ? result.value : createDefaultShortcutSettings();
    },
    async save(settings: ShortcutSettings): Promise<ShortcutSettings> {
      const result = validateShortcutSettings(settings);
      if (!result.ok) throw new Error(result.message);
      try { await area.set({ [STORAGE_KEY]: result.value }); } catch { throw new Error("无法保存快捷网站设置"); }
      return result.value;
    },
    async reset(): Promise<ShortcutSettings> {
      const defaults = createDefaultShortcutSettings();
      try { await area.set({ [STORAGE_KEY]: defaults }); } catch { throw new Error("无法恢复默认设置"); }
      return defaults;
    },
  };
}
```

- [ ] **Step 4：运行相关测试和类型检查**

Run: `npm test -- --run tests/shortcut-model.test.ts tests/shortcut-store.test.ts && npm run typecheck`

Expected: 两个测试文件全部通过，类型检查退出码 0。

- [ ] **Step 5：提交持久化适配器**

```bash
git add src/sidepanel/shortcut-store.ts tests/shortcut-store.test.ts
git commit -m "feat: persist shortcut settings locally"
```

## Task 4：实现标签视图模型、排序和搜索仓库

**Files:**
- Create: `src/sidepanel/tab-model.ts`
- Create: `src/sidepanel/tab-store.ts`
- Create: `tests/tab-model.test.ts`
- Create: `tests/tab-store.test.ts`

- [ ] **Step 1：写转换、排序、更新和搜索测试**

```ts
import { describe, expect, it } from "vitest";
import { toTabViewModel } from "../src/sidepanel/tab-model";
import { TabStore } from "../src/sidepanel/tab-store";

const tab = (id: number, index: number, title = `Tab ${id}`): chrome.tabs.Tab => ({
  id, index, windowId: 7, active: id === 2, highlighted: false, incognito: false,
  pinned: id === 1, selected: false, discarded: false, autoDiscardable: true,
  groupId: -1, title, url: `https://example${id}.com/path`,
});

describe("tab model and store", () => {
  it("maps domain and fallback title", () => {
    expect(toTabViewModel(tab(1, 0))).toMatchObject({ id: 1, domain: "example1.com", pinned: true });
    expect(toTabViewModel({ ...tab(1, 0), title: "", url: "chrome://newtab/" }).title).toBe("新标签页");
  });

  it("sorts by Chrome index and filters case-insensitively", () => {
    const store = new TabStore();
    store.initialize([tab(2, 1, "GitHub Issues"), tab(1, 0, "Docs")]);
    expect(store.list().map((item) => item.id)).toEqual([1, 2]);
    expect(store.filter("github").map((item) => item.id)).toEqual([2]);
    expect(store.filter("EXAMPLE1").map((item) => item.id)).toEqual([1]);
  });

  it("updates, removes and ignores stale IDs", () => {
    const store = new TabStore();
    store.initialize([tab(1, 0)]);
    expect(store.update(1, { title: "Changed", active: true })?.title).toBe("Changed");
    expect(store.remove(99)).toBe(false);
    expect(store.remove(1)).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npm test -- --run tests/tab-model.test.ts tests/tab-store.test.ts`

Expected: FAIL，提示两个模块不存在。

- [ ] **Step 3：实现稳定的数据模型和仓库接口**

`tab-model.ts` 导出：

```ts
export type TabViewModel = {
  id: number; windowId: number; index: number; title: string; url: string;
  domain: string; favIconUrl?: string; active: boolean; pinned: boolean;
};

export function toTabViewModel(tab: chrome.tabs.Tab): TabViewModel {
  if (tab.id === undefined) throw new Error("标签页缺少 ID");
  const url = tab.url ?? tab.pendingUrl ?? "";
  let domain = "";
  try { domain = new URL(url).hostname || new URL(url).protocol.replace(":", ""); } catch { domain = url; }
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title?.trim() || "新标签页",
    url,
    domain,
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
    active: tab.active,
    pinned: tab.pinned,
  };
}
```

`TabStore` 使用私有 `Map<number, TabViewModel>`，并提供以下确定接口：

```ts
export class TabStore {
  initialize(tabs: chrome.tabs.Tab[]): void;
  list(): TabViewModel[];
  filter(query: string): TabViewModel[];
  add(tab: chrome.tabs.Tab): TabViewModel | undefined;
  update(id: number, patch: Partial<TabViewModel>): TabViewModel | undefined;
  replace(tab: chrome.tabs.Tab): TabViewModel | undefined;
  remove(id: number): boolean;
  activate(id: number): void;
  move(id: number, index: number): void;
}
```

实现要求：`list()` 每次返回按 `index` 升序的新数组；`filter()` 对查询执行 `trim().toLocaleLowerCase()`，匹配标题、URL 或域名；`add/replace` 忽略没有 ID 的 Chrome Tab；`activate()` 确保同一时刻只有一个条目为 active；`move()` 调整目标索引并根据 Chrome 事件给出的最终顺序重新编号。

- [ ] **Step 4：运行单元测试、类型检查**

Run: `npm test -- --run tests/tab-model.test.ts tests/tab-store.test.ts && npm run typecheck`

Expected: 所有标签领域测试通过，类型检查退出码 0。

- [ ] **Step 5：提交标签状态层**

```bash
git add src/sidepanel/tab-model.ts src/sidepanel/tab-store.ts tests/tab-model.test.ts tests/tab-store.test.ts
git commit -m "feat: model and filter current-window tabs"
```

## Task 5：隔离 Chrome 标签操作并订阅事件

**Files:**
- Create: `src/sidepanel/tab-actions.ts`
- Create: `src/sidepanel/shortcut-actions.ts`
- Create: `src/sidepanel/tab-events.ts`
- Create: `tests/tab-actions.test.ts`
- Create: `tests/tab-events.test.ts`

- [ ] **Step 1：写操作参数、错误归一化和窗口过滤测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTabActions } from "../src/sidepanel/tab-actions";
import { createShortcutActions } from "../src/sidepanel/shortcut-actions";

describe("browser actions", () => {
  it("activates, removes and opens with exact Chrome arguments", async () => {
    const api = { update: vi.fn().mockResolvedValue({}), remove: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue({}) };
    const tabs = createTabActions(api);
    await tabs.activate(3);
    await tabs.close(4);
    await createShortcutActions(api).open("https://github.com/");
    expect(api.update).toHaveBeenCalledWith(3, { active: true });
    expect(api.remove).toHaveBeenCalledWith(4);
    expect(api.create).toHaveBeenCalledWith({ url: "https://github.com/", active: true });
  });

  it("returns a stable Chinese error", async () => {
    const api = { update: vi.fn().mockRejectedValue(new Error("No tab")), remove: vi.fn(), create: vi.fn() };
    await expect(createTabActions(api).activate(3)).rejects.toThrow("无法切换到该标签页");
  });
});
```

为 `tab-events` 创建一个简单事件桩，验证 `onCreated` 中 `windowId !== currentWindowId` 的标签被忽略，`onActivated` 只有窗口匹配时调用仓库，调用返回的取消订阅函数后所有监听器都被移除。

- [ ] **Step 2：运行测试并确认失败**

Run: `npm test -- --run tests/tab-actions.test.ts tests/tab-events.test.ts`

Expected: FAIL，提示操作与事件模块不存在。

- [ ] **Step 3：实现窄接口适配器**

`tab-actions.ts`：

```ts
type TabsApi = {
  update(tabId: number, properties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab>;
  remove(tabId: number): Promise<void>;
};

export function createTabActions(api: TabsApi) {
  return {
    async activate(id: number): Promise<void> {
      try { await api.update(id, { active: true }); } catch { throw new Error("无法切换到该标签页"); }
    },
    async close(id: number): Promise<void> {
      try { await api.remove(id); } catch { throw new Error("无法关闭该标签页"); }
    },
  };
}
```

`shortcut-actions.ts` 复用 `normalizeShortcutUrl()` 后调用 `api.create({ url, active: true })`，失败时抛出 `无法打开快捷网站`。

`tab-events.ts` 导出：

```ts
export type TabEventHandlers = {
  created(tab: chrome.tabs.Tab): void;
  removed(tabId: number): void;
  updated(tab: chrome.tabs.Tab): void;
  activated(tabId: number): void;
  moved(tabId: number, index: number): void;
  detached(tabId: number): void;
  attached(tab: chrome.tabs.Tab): void;
};

export function subscribeToTabEvents(
  tabsApi: typeof chrome.tabs,
  currentWindowId: number,
  handlers: TabEventHandlers,
): () => void;
```

订阅七个规格要求的事件。`onUpdated` 使用事件参数中的完整 `tab`；`onAttached` 仅在 `newWindowId` 匹配时调用 `tabsApi.get(tabId)` 后 `attached(tab)`；`onDetached` 仅在 `oldWindowId` 匹配时删除；所有异步读取失败都安全忽略。取消函数逐个执行对应的 `removeListener`。

- [ ] **Step 4：运行操作和事件测试**

Run: `npm test -- --run tests/tab-actions.test.ts tests/tab-events.test.ts && npm run typecheck`

Expected: 全部通过；测试明确覆盖当前窗口过滤与取消订阅。

- [ ] **Step 5：提交 Chrome API 边界**

```bash
git add src/sidepanel/tab-actions.ts src/sidepanel/shortcut-actions.ts src/sidepanel/tab-events.ts tests/tab-actions.test.ts tests/tab-events.test.ts
git commit -m "feat: handle tab actions and browser events"
```

## Task 6：构建紧凑侧边栏与两个渲染器

**Files:**
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Create: `src/sidepanel/tab-renderer.ts`
- Create: `src/sidepanel/shortcut-renderer.ts`
- Create: `tests/tab-renderer.test.ts`
- Create: `tests/shortcut-renderer.test.ts`

- [ ] **Step 1：写 DOM 行为失败测试**

`tests/tab-renderer.test.ts` 至少验证：

```ts
document.body.innerHTML = `<div id="tab-empty"></div><div id="tab-list"></div>`;
const renderer = createTabRenderer({
  list: document.querySelector("#tab-list")!,
  empty: document.querySelector("#tab-empty")!,
});
renderer.render([{
  id: 1, windowId: 7, index: 0, title: "Example", url: "https://example.com/",
  domain: "example.com", active: true, pinned: false,
}]);
expect(document.querySelector('[data-tab-id="1"]')?.getAttribute("aria-current")).toBe("page");
expect(document.querySelector(".tab-title")?.textContent).toBe("Example");
renderer.patch({ id: 1, active: false, title: "Changed" });
expect(document.querySelector(".tab-title")?.textContent).toBe("Changed");
```

`tests/shortcut-renderer.test.ts` 至少验证：`enabled: false` 时容器设置 `hidden` 且没有子项；开启时出现三个按钮；点击 `data-shortcut-id` 调用 `onOpen`；点击设置按钮打开原生 `<dialog>`；保存非法协议时显示错误且不关闭；上下移动按钮会改变草稿顺序；关闭对话框不保存草稿。

- [ ] **Step 2：运行渲染测试并确认失败**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/shortcut-renderer.test.ts`

Expected: FAIL，提示渲染器模块不存在。

- [ ] **Step 3：完成语义 HTML**

`index.html` 必须包含：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SideTab Lite</title>
    <link rel="stylesheet" href="./sidebar.css" />
  </head>
  <body>
    <main class="sidebar-shell">
      <header class="toolbar">
        <div id="shortcut-strip" class="shortcut-strip" hidden></div>
        <div class="search-row">
          <input id="tab-search" type="search" placeholder="搜索标签页" aria-label="搜索标签页" autocomplete="off" />
          <button id="shortcut-settings" class="icon-button" type="button" title="快捷网站设置" aria-label="快捷网站设置">&#9881;</button>
        </div>
        <p id="status-message" class="status-message" role="status" aria-live="polite"></p>
      </header>
      <section class="tab-region" aria-label="当前窗口标签页">
        <div id="tab-empty" class="empty-state" hidden>没有匹配的标签页</div>
        <div id="tab-list" class="tab-list" role="list"></div>
      </section>
    </main>
    <dialog id="shortcut-dialog" aria-labelledby="shortcut-dialog-title">
      <form id="shortcut-form" method="dialog">
        <div class="dialog-header">
          <h2 id="shortcut-dialog-title">快捷网站</h2>
          <label class="switch-row"><input id="shortcut-enabled" type="checkbox" />启用快捷入口</label>
        </div>
        <div id="shortcut-editor-list"></div>
        <p id="shortcut-error" class="form-error" role="alert"></p>
        <div class="dialog-actions">
          <button id="shortcut-add" type="button">添加网站</button>
          <button id="shortcut-reset" type="button">恢复默认</button>
          <button value="cancel">取消</button>
          <button id="shortcut-save" type="submit" value="default">保存</button>
        </div>
      </form>
    </dialog>
    <script type="module" src="./sidebar.js"></script>
  </body>
</html>
```

- [ ] **Step 4：实现渲染器与稳定布局 CSS**

`createTabRenderer()` 接受 `{ list, empty }`，提供 `render(tabs)`、`patch(tab)`、`remove(id)`。首次和搜索重绘使用 `DocumentFragment`；每行由一个 `.tab-main` 按钮和一个固定 32px 的 `.tab-close` 图标按钮组成；根节点携带 `data-tab-id`，favicon 使用 `loading="lazy"`、16×16 固定尺寸和加载失败回退；所有用户文本通过 `textContent` 写入，不使用 `innerHTML`。

`createShortcutRenderer()` 接受 DOM 节点及 `onOpen(url)`、`onSave(settings)` 回调，提供 `render(settings)`、`openSettings(settings)`、`setError(message)`。关闭状态执行 `strip.replaceChildren(); strip.hidden = true`；开启状态用单个 `DocumentFragment` 生成按钮，默认三项引用本地 `/assets/shortcuts/*.png`，自定义项显示名称首字母。设置列表每行提供名称、URL、上移、下移和删除控件；新增项 ID 使用 `crypto.randomUUID()`。表单 `submit` 监听器首先执行 `event.preventDefault()`，只在异步 `onSave()` 成功后调用 `dialog.close()`；保存失败时保留对话框、草稿和错误信息。

`sidebar.css` 必须实现这些固定约束：

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; font-size: 13px; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
button, input { font: inherit; letter-spacing: 0; }
.sidebar-shell { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; background: Canvas; color: CanvasText; }
.toolbar { border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); padding: 8px; }
.shortcut-strip { display: flex; gap: 4px; overflow-x: auto; min-height: 32px; margin-bottom: 6px; }
.shortcut-strip[hidden] { display: none; }
.shortcut-button, .icon-button, .tab-close { inline-size: 32px; block-size: 32px; flex: 0 0 32px; border: 0; border-radius: 6px; background: transparent; }
.shortcut-button:hover, .icon-button:hover, .tab-close:hover { background: color-mix(in srgb, CanvasText 10%, transparent); }
.shortcut-button img, .favicon { width: 16px; height: 16px; object-fit: contain; }
.search-row { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 6px; }
#tab-search { min-width: 0; height: 32px; padding: 0 9px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; }
.tab-region, .tab-list { min-height: 0; }
.tab-region { overflow-y: auto; }
.tab-row { display: grid; grid-template-columns: minmax(0, 1fr) 32px; min-height: 46px; border-inline-start: 3px solid transparent; }
.tab-row[data-active="true"] { border-inline-start-color: AccentColor; background: color-mix(in srgb, AccentColor 10%, transparent); }
.tab-main { min-width: 0; display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 7px; align-items: center; border: 0; background: transparent; text-align: left; }
.tab-title, .tab-domain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-title { font-size: 13px; }
.tab-domain { font-size: 11px; opacity: .65; }
.empty-state { padding: 24px 12px; text-align: center; opacity: .65; }
dialog { width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 12px; }
.dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
```

补齐焦点可见样式、编辑行网格、错误态和窄于 240px 时的折行规则；禁止渐变、动画和会引发布局变化的 hover 尺寸。

- [ ] **Step 5：运行 DOM 测试和类型检查**

Run: `npm test -- --run tests/tab-renderer.test.ts tests/shortcut-renderer.test.ts && npm run typecheck`

Expected: 渲染、隐藏、事件委托、草稿排序和校验测试全部通过。

- [ ] **Step 6：提交侧边栏界面**

```bash
git add src/sidepanel/index.html src/sidepanel/sidebar.css src/sidepanel/tab-renderer.ts src/sidepanel/shortcut-renderer.ts tests/tab-renderer.test.ts tests/shortcut-renderer.test.ts
git commit -m "feat: render compact side panel UI"
```

## Task 7：装配启动流程并保证事件驱动更新

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Create: `tests/sidebar.test.ts`

- [ ] **Step 1：写初始化、搜索防抖和事件更新测试**

测试通过依赖注入调用 `startSidebar({ tabs, windows, storage, document })`，验证：

```ts
expect(windows.getCurrent).toHaveBeenCalledWith();
expect(tabs.query).toHaveBeenCalledWith({ windowId: 7 });
expect(storage.get).toHaveBeenCalledWith("shortcutSettings");
expect(document.querySelectorAll(".tab-row")).toHaveLength(2);
expect(document.querySelector("#shortcut-strip")).toHaveProperty("hidden", true);
```

使用 `vi.useFakeTimers()` 输入 `git`：79ms 时列表未变化，100ms 后完成筛选。触发假 `onCreated/onRemoved/onUpdated/onActivated/onMoved/onAttached/onDetached`，确认只更新当前窗口并尽可能调用 `patch/remove`，而非所有事件都重绘。模拟 `tabs.query` 失败时，`#status-message` 显示 `无法读取当前窗口的标签页`，页面仍可打开设置。

- [ ] **Step 2：运行启动测试并确认失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，因为 `sidebar.ts` 尚未导出 `startSidebar`。

- [ ] **Step 3：实现启动装配**

`sidebar.ts` 导出并在模块末尾调用：

```ts
export type SidebarDependencies = {
  tabs: typeof chrome.tabs;
  windows: typeof chrome.windows;
  storage: chrome.storage.StorageArea;
  document: Document;
};

export async function startSidebar(deps: SidebarDependencies): Promise<() => void>;

if (typeof chrome !== "undefined") {
  void startSidebar({ tabs: chrome.tabs, windows: chrome.windows, storage: chrome.storage.local, document });
}
```

实现顺序固定为：缓存必需 DOM 节点；创建 store/actions/renderers；并行执行 `windows.getCurrent()` 与 shortcut load；拿到窗口 ID 后查询当前窗口标签；渲染快捷设置与标签列表；订阅标签事件；绑定单个列表点击监听器和单个搜索 `input` 监听器。搜索使用 100ms 防抖；标签操作不做乐观删除，等待 Chrome 事件校准；关闭页面时返回的清理函数移除 Chrome 监听器、DOM 监听器并清除定时器。

事件到渲染策略：

- `created/attached`：写入 store，当前无搜索条件时插入或重绘有序列表。
- `updated`：`store.replace(tab)` 后 `renderer.patch(model)`；存在搜索条件时重绘筛选结果。
- `activated`：更新旧、当前 active 两行。
- `removed/detached`：从 store 和 DOM 删除。
- `moved`：更新索引并重绘当前有序列表。
- 任何非当前窗口事件：不进入 store。

快捷设置保存成功后才替换内存中的 `ShortcutSettings` 并重绘；失败时调用 `shortcutRenderer.setError()`，保留对话框和草稿。

- [ ] **Step 4：运行启动测试、全量单测和类型检查**

Run: `npm test -- --run tests/sidebar.test.ts && npm test -- --run && npm run typecheck`

Expected: 启动测试通过；全量测试 0 失败；类型检查退出码 0。

- [ ] **Step 5：提交完整启动流程**

```bash
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts tests/helpers/fake-chrome.ts
git commit -m "feat: wire side panel lifecycle"
```

## Task 8：生成本地图标并建立发布包硬性检查

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create: `scripts/check-dist.mjs`
- Create: `assets/icons/icon-16.png`
- Create: `assets/icons/icon-32.png`
- Create: `assets/icons/icon-48.png`
- Create: `assets/icons/icon-128.png`
- Create: `assets/shortcuts/openai.png`
- Create: `assets/shortcuts/google.png`
- Create: `assets/shortcuts/github.png`
- Create: `docs/chrome-web-store-checklist.md`
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1：扩展冒烟测试，先要求所有本地资产存在**

```ts
import { access } from "node:fs/promises";

it.each([
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png",
  "assets/shortcuts/openai.png",
  "assets/shortcuts/google.png",
  "assets/shortcuts/github.png",
])("packages local asset %s", async (path) => {
  await expect(access(path)).resolves.toBeUndefined();
});
```

- [ ] **Step 2：运行冒烟测试并确认资产缺失**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，逐项指出缺失的 PNG 文件。

- [ ] **Step 3：创建确定性图标生成脚本并生成资产**

`scripts/generate-icons.mjs` 使用以下确定性内容；快捷图标使用字母标识，不复制品牌商标路径：

```js
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const iconDir = resolve(root, "assets/icons");
const shortcutDir = resolve(root, "assets/shortcuts");
await mkdir(iconDir, { recursive: true });
await mkdir(shortcutDir, { recursive: true });

function extensionSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="20" fill="#f7f7f5"/>
    <rect x="18" y="18" width="30" height="92" rx="8" fill="#202124"/>
    <rect x="58" y="27" width="52" height="14" rx="7" fill="#4285f4"/>
    <rect x="58" y="57" width="43" height="14" rx="7" fill="#5f6368"/>
    <rect x="58" y="87" width="48" height="14" rx="7" fill="#5f6368"/>
  </svg>`;
}

function shortcutSvg(label, background, foreground) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="${background}"/>
    <text x="32" y="34" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial, sans-serif" font-size="${label.length > 1 ? 22 : 30}" font-weight="700"
      fill="${foreground}">${label}</text>
  </svg>`;
}

for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(extensionSvg())).resize(size, size).png().toFile(resolve(iconDir, `icon-${size}.png`));
}
for (const [file, label, background, foreground] of [
  ["openai.png", "AI", "#202123", "#ffffff"],
  ["google.png", "G", "#ffffff", "#1a73e8"],
  ["github.png", "GH", "#24292f", "#ffffff"],
]) {
  await sharp(Buffer.from(shortcutSvg(label, background, foreground))).resize(32, 32).png().toFile(resolve(shortcutDir, file));
}
```

运行：

Run: `node scripts/generate-icons.mjs`

Expected: 在 `assets/icons` 和 `assets/shortcuts` 生成七个非空 PNG 文件。

- [ ] **Step 4：实现发布包检查**

`scripts/check-dist.mjs` 必须读取 `dist/manifest.json` 并执行以下断言：

```js
import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const expectedPermissions = ["sidePanel", "tabs", "storage"];
if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) throw new Error("权限集不符合规格");
if (manifest.host_permissions || manifest.content_scripts) throw new Error("发布包不得包含主机权限或 Content Scripts");

const required = [
  "background/service-worker.js", "sidepanel/index.html", "sidepanel/sidebar.js", "sidepanel/sidebar.css",
  "assets/icons/icon-16.png", "assets/icons/icon-32.png", "assets/icons/icon-48.png", "assets/icons/icon-128.png",
  "assets/shortcuts/openai.png", "assets/shortcuts/google.png", "assets/shortcuts/github.png",
];
for (const file of required) await access(resolve(dist, file));

const html = await readFile(resolve(dist, "sidepanel/index.html"), "utf8");
const js = `${await readFile(resolve(dist, "background/service-worker.js"), "utf8")}\n${await readFile(resolve(dist, "sidepanel/sidebar.js"), "utf8")}`;
if (/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i.test(html)) throw new Error("页面引用了远程脚本或样式");
if (/(?:import\s*\(|fetch\s*\(|new\s+WebSocket\s*\()["']https?:\/\//.test(js)) throw new Error("运行时代码会加载远程资源");
if (/eval\(|new Function\(/.test(js)) throw new Error("运行时代码包含动态执行");

async function totalSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    total += entry.isDirectory() ? await totalSize(path) : (await stat(path)).size;
  }
  return total;
}
const bytes = await totalSize(dist);
if (bytes > 300_000) throw new Error(`发布包超过 300KB: ${bytes}`);
console.log(`dist check passed: ${bytes} bytes`);
```

- [ ] **Step 5：编写人工上架与验收清单**

`docs/chrome-web-store-checklist.md` 明确记录：

- 加载 `dist/` 为未打包扩展。
- 点击扩展图标后侧边栏打开。
- 默认快捷入口关闭且不占高度；开启后显示 AI/G/GH 三个本地图标。
- 分别验证 1、20、100+ 标签页的搜索、激活、关闭、移动、固定和 favicon 回退。
- 验证快捷项新增、编辑、上下排序、删除、恢复默认、12 项上限和持久化。
- DevTools Network 在使用扩展自身功能期间没有扩展发起的请求。
- `chrome://extensions` 中只显示 `sidePanel`、`tabs`、`storage` 权限，无站点访问权限。
- 商店隐私声明：不收集、不传输、不出售用户数据，不使用远程代码。
- 商店权限理由使用规格文档中的三条说明。

- [ ] **Step 6：执行完整发布验证**

Run: `npm test -- --run && npm run typecheck && npm run build && node scripts/check-dist.mjs`

Expected: 所有测试 0 失败；类型检查退出码 0；构建成功；最后输出 `dist check passed: <bytes> bytes` 且 `<bytes>` 小于等于 300000。

随后在本机 Chrome 加载 `dist/`，逐项执行 `docs/chrome-web-store-checklist.md`。任何失败都必须先新增能复现的自动化测试（浏览器专属行为无法自动化时，在清单中记录 Chrome 版本、复现步骤和结果），修复后重新执行完整命令。

- [ ] **Step 7：提交资产与发布检查**

```bash
git add scripts/generate-icons.mjs scripts/check-dist.mjs assets docs/chrome-web-store-checklist.md tests/smoke.test.ts
git commit -m "chore: add local assets and release checks"
```

## 最终验收

- [ ] `git status --short` 无未提交的实现文件。
- [ ] `npm run check` 退出码为 0。
- [ ] `dist/` 体积不超过 300KB，且没有远程 URL、动态代码、Content Scripts 或主机权限。
- [ ] 首次运行快捷入口开关为关闭，关闭状态不占布局空间。
- [ ] 开启后默认显示 OpenAI、Google、GitHub，并能新建激活标签页。
- [ ] 快捷网站配置在关闭、重开侧边栏后保持一致。
- [ ] 当前窗口的标签创建、更新、激活、移动、附加、分离和关闭都能同步到侧边栏。
- [ ] 100+ 标签页场景手动操作流畅，搜索防抖为 100ms，无轮询和网页注入。
- [ ] Chrome 人工验收清单完整记录实际结果。
