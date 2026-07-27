# 右键快捷网站与界面细节优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为标签右键菜单增加可见交互反馈和“设为快捷网站”命令，将加号改为有边框的紧凑按钮，并完成底部搜索区的无分割线圆角样式及 `0.4.0` 发布包。

**Architecture:** `tab-context-menu.ts` 只负责第三个菜单命令和键盘行为，`shortcut-model.ts` 提供无副作用的标签转快捷网站函数，`sidebar.ts` 负责读取、保存和渲染。CSS 继续使用系统颜色，布局调整不改变 `tab-scroll`、底部工具栏或 Chrome 标签操作的职责边界。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM/CSS、Vitest、JSDOM、esbuild、现有 Node 发布脚本。

---

## 文件结构

- 修改 `src/sidepanel/shortcut-model.ts`：把标签标题和 URL 安全地追加为 `letter` 类型快捷网站。
- 修改 `tests/shortcut-model.test.ts`：锁定标题回退、URL 校验、重复、上限、ID 冲突和不可变性。
- 修改 `src/sidepanel/tab-context-menu.ts`：增加 `add-shortcut` 命令、第三个菜单项和三项键盘导航。
- 修改 `tests/tab-context-menu.test.ts`：锁定菜单顺序、命令和键盘循环。
- 修改 `src/sidepanel/sidebar.ts`：把菜单命令写入现有快捷网站存储并刷新渲染。
- 修改 `tests/sidebar.test.ts`：验证保存、错误、并发、生命周期和标签操作隔离。
- 修改 `src/sidepanel/sidebar.css`、`tests/sidepanel-css.test.ts`：实现并锁定菜单、加号和搜索区域样式。
- 修改版本、smoke 测试、README 和商店清单：发布 `0.4.0`。

### Task 1: 建立标签转快捷网站纯模型

**Files:**
- Modify: `src/sidepanel/shortcut-model.ts`
- Modify: `tests/shortcut-model.test.ts`

- [ ] **Step 1: 写入标签追加快捷网站的失败测试**

在 `tests/shortcut-model.test.ts` 的 import 中加入 `appendTabShortcut`，并在现有 `describe("shortcut model")` 中新增：

```ts
it("appends a normalized letter shortcut from a tab", () => {
  const settings = createDefaultShortcutSettings();
  const result = appendTabShortcut(settings, {
    id: "tab-1",
    title: "  Example page  ",
    url: "example.com/path",
  });

  expect(result.items.at(-1)).toEqual({
    id: "tab-1",
    name: "Example page",
    url: "https://example.com/path",
    icon: "letter",
  });
  expect(settings).toEqual(createDefaultShortcutSettings());
});

it("uses the hostname when a tab has no title", () => {
  const result = appendTabShortcut(createDefaultShortcutSettings(), {
    id: "tab-empty-title",
    title: "   ",
    url: "https://docs.example.test/guide",
  });
  expect(result.items.at(-1)?.name).toBe("docs.example.test");
});

it.each([
  ["chrome://settings/", "仅支持 HTTP 或 HTTPS 地址"],
  ["https://chatgpt.com/", "快捷网站地址不能重复"],
])("rejects %s without mutating settings", (url, message) => {
  const settings = createDefaultShortcutSettings();
  const before = structuredClone(settings);
  expect(() => appendTabShortcut(settings, { id: "rejected", title: "Rejected", url })).toThrow(message);
  expect(settings).toEqual(before);
});

it("rejects a thirteenth item and duplicate ID", () => {
  const full = {
    enabled: true,
    tabTitleFontSize: 14,
    items: Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      url: `https://item-${index}.example/`,
      icon: "letter" as const,
    })),
  };
  expect(() => appendTabShortcut(full, {
    id: "item-12", title: "Overflow", url: "https://overflow.example/",
  })).toThrow("最多只能添加 12 个快捷网站");
  expect(() => appendTabShortcut(createDefaultShortcutSettings(), {
    id: "openai", title: "Different", url: "https://different.example/",
  })).toThrow("快捷网站 ID 不能重复");
});
```

- [ ] **Step 2: 运行模型测试确认失败**

Run: `npm test -- --run tests/shortcut-model.test.ts`

Expected: FAIL，提示 `appendTabShortcut` 尚未导出。

- [ ] **Step 3: 实现最小纯函数**

在 `src/sidepanel/shortcut-model.ts` 的 `normalizeShortcutUrl()` 后加入：

```ts
export function appendTabShortcut(
  settings: ShortcutSettings,
  tab: { id: string; title: string; url: string },
): ShortcutSettings {
  const url = normalizeShortcutUrl(tab.url);
  const name = tab.title.trim() || new URL(url).hostname;
  const validation = validateShortcutSettings({
    enabled: settings.enabled,
    tabTitleFontSize: settings.tabTitleFontSize,
    items: [
      ...settings.items.map((item) => ({ ...item })),
      { id: tab.id, name, url, icon: "letter" },
    ],
  });
  if (!validation.ok) throw new Error(validation.message);
  return validation.value;
}
```

- [ ] **Step 4: 运行模型测试和类型检查**

Run: `npm test -- --run tests/shortcut-model.test.ts && npm run typecheck`

Expected: 模型测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交模型层**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后：

```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/shortcut-model.ts tests/shortcut-model.test.ts
git commit -m "$timestamp feat 新增标签快捷网站转换模型"
```

### Task 2: 扩展右键菜单命令和键盘行为

**Files:**
- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1: 写入菜单第三项和键盘循环的失败测试**

在第一个菜单测试中增加：

```ts
expect(Array.from(popup.querySelectorAll("[role='menuitem']"), (item) => item.textContent)).toEqual([
  "复制标签页",
  "固定标签",
  "设为快捷网站",
]);
```

新增：

```ts
it("dispatches add-shortcut from mouse and keyboard", () => {
  const onCommand = vi.fn();
  const menu = createTabContextMenu(
    { document, list, viewport: window },
    { getTab: (id) => tabs.find((tab) => tab.id === id), onCommand },
  );
  const popup = document.querySelector<HTMLElement>(".tab-context-menu")!;
  context(row(1));
  (popup.querySelector("[data-menu-action='add-shortcut']") as HTMLButtonElement).click();
  expect(onCommand).toHaveBeenLastCalledWith({ action: "add-shortcut", tabId: 1 });

  context(row(2));
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(popup.querySelector("[data-menu-action='add-shortcut']"));
  popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(onCommand).toHaveBeenLastCalledWith({ action: "add-shortcut", tabId: 2 });
  menu.destroy();
});
```

将首个测试的菜单矩形高度从 `60` 改为 `90`，并把顶部边界预期调整为 `window.innerHeight - 90`。

- [ ] **Step 2: 运行菜单测试确认失败**

Run: `npm test -- --run tests/tab-context-menu.test.ts`

Expected: FAIL，菜单中不存在 `add-shortcut` 项。

- [ ] **Step 3: 实现第三个命令和三项导航**

把命令类型改为：

```ts
export type TabContextCommand =
  | { action: "duplicate"; tabId: number }
  | { action: "set-pinned"; tabId: number; pinned: boolean }
  | { action: "add-shortcut"; tabId: number };
```

创建并追加第三项：

```ts
const addShortcut = createItem("add-shortcut", "设为快捷网站");
menu.append(duplicate, setPinned, addShortcut);
```

将 `onMenuClick` 的映射改为显式分支：

```ts
let command: TabContextCommand;
switch (button.dataset.menuAction) {
  case "duplicate":
    command = { action: "duplicate", tabId: openTabId };
    break;
  case "set-pinned":
    command = { action: "set-pinned", tabId: openTabId, pinned: button.dataset.nextPinned === "true" };
    break;
  case "add-shortcut":
    command = { action: "add-shortcut", tabId: openTabId };
    break;
  default:
    return;
}
```

键盘循环数组改为 `const items = [duplicate, setPinned, addShortcut];`。其余焦点恢复、定位和销毁逻辑保持不变。

- [ ] **Step 4: 运行菜单测试和类型检查**

Run: `npm test -- --run tests/tab-context-menu.test.ts && npm run typecheck`

Expected: 所有菜单测试 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交菜单层**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后：

```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/tab-context-menu.ts tests/tab-context-menu.test.ts
git commit -m "$timestamp feat 新增右键快捷网站命令"
```

### Task 3: 在侧边栏保存并刷新快捷网站

**Files:**
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 写入成功、开关保留、失败和并发的失败测试**

在 `tests/sidebar.test.ts` 的 model import 中加入 `type ShortcutSettings`，并增加：

```ts
function contextMenuItem(action: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-menu-action='${action}']`)!;
}
```

在 lifecycle 测试组新增：

```ts
it("persists the current tab as a shortcut without Chrome tab actions", async () => {
  const fake = createFakeChrome({ tabs: [fakeTab({ id: 7, title: "Example", url: "https://example.com/path" })] });
  const cleanup = await startSidebar(fake);
  row(7).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  await flush();

  await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
  const saved = fake.methods.storageSet.mock.calls.at(-1)?.[0].shortcutSettings as ShortcutSettings;
  expect(saved.items.at(-1)).toMatchObject({ name: "Example", url: "https://example.com/path", icon: "letter" });
  expect(saved.enabled).toBe(false);
  expect(element("shortcut-strip").hidden).toBe(true);
  expect(element("status-message").textContent).toBe("已添加到快捷网站");
  expect(fake.methods.create).not.toHaveBeenCalled();
  expect(fake.methods.duplicate).not.toHaveBeenCalled();
  expect(fake.methods.move).not.toHaveBeenCalled();
  expect(fake.methods.update).not.toHaveBeenCalled();
  cleanup();
});

it("renders a saved context-menu shortcut immediately when shortcuts are enabled", async () => {
  const fake = createFakeChrome({
    stored: enabledShortcuts([]),
    tabs: [fakeTab({
      id: 8,
      title: "Docs",
      url: "https://docs.example/guide",
      favIconUrl: "data:image/png;base64,docs-menu",
    })],
  });
  const cleanup = await startSidebar(fake);
  row(8).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());

  expect(element("shortcut-strip").hidden).toBe(false);
  expect(element("shortcut-strip").children).toHaveLength(1);
  expect(element("shortcut-strip").querySelector("img")?.getAttribute("src"))
    .toBe("data:image/png;base64,docs-menu");
  cleanup();
});

it("ignores a repeated pending add and reports save failure", async () => {
  const pending = deferred<void>();
  const fake = createFakeChrome({ tabs: [fakeTab({ id: 9, url: "https://pending.example/" })] });
  fake.methods.storageSet.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  row(9).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  row(9).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());

  pending.reject(new Error("storage failed"));
  await flush();
  expect(element("status-message").textContent).toBe("无法保存快捷网站设置");
  cleanup();
});

it.each([
  ["chrome://settings/", "仅支持 HTTP 或 HTTPS 地址"],
  ["https://chatgpt.com/", "快捷网站地址不能重复"],
])("reports a rejected shortcut URL %s without persisting", async (url, message) => {
  const fake = createFakeChrome({ tabs: [fakeTab({ id: 10, url })] });
  const cleanup = await startSidebar(fake);
  row(10).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  await vi.waitFor(() => expect(element("status-message").textContent).toBe(message));

  expect(fake.methods.storageSet).not.toHaveBeenCalled();
  cleanup();
});

it("ignores a pending shortcut save completion after cleanup", async () => {
  const pending = deferred<void>();
  const fake = createFakeChrome({ tabs: [fakeTab({ id: 11, url: "https://late.example/" })] });
  fake.methods.storageSet.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  row(11).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  contextMenuItem("add-shortcut").click();
  await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
  const statusBefore = element("status-message").textContent;
  const shortcutsBefore = element("shortcut-strip").innerHTML;

  cleanup();
  pending.resolve();
  await flush();

  expect(element("status-message").textContent).toBe(statusBefore);
  expect(element("shortcut-strip").innerHTML).toBe(shortcutsBefore);
});
```

- [ ] **Step 2: 运行侧边栏测试确认失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，`add-shortcut` 尚未触发 Storage 保存。

- [ ] **Step 3: 实现串行保存流程**

在现有 model import 中加入 `appendTabShortcut`，并在状态区加入 `let addShortcutBusy = false;`。在创建菜单前定义：

```ts
const addTabShortcut = async (tabId: number): Promise<void> => {
  if (addShortcutBusy) return;
  addShortcutBusy = true;
  try {
    const tab = tabStore.list().find((item) => item.id === tabId);
    if (!tab) throw new Error("标签页已不存在");
    const settings = await shortcutStore.load();
    if (!active) return;
    const next = appendTabShortcut(settings, {
      id: crypto.randomUUID(),
      title: tab.title,
      url: tab.url,
    });
    const saved = await shortcutStore.save(next);
    if (!active) return;
    shortcutRenderer.render(saved);
    syncShortcutFavicons();
    setStatus("shortcuts", "已添加到快捷网站");
  } catch (error) {
    if (active) setStatus("shortcuts", error instanceof Error ? error.message : "无法保存快捷网站设置");
  } finally {
    addShortcutBusy = false;
  }
};
```

将菜单回调改为：

```ts
onCommand(command) {
  if (command.action === "add-shortcut") {
    void addTabShortcut(command.tabId);
    return;
  }
  const operation = command.action === "duplicate"
    ? tabActions.duplicate(command.tabId)
    : tabActions.setPinned(command.tabId, command.pinned);
  runTabOperation(operation);
},
```

添加快捷网站只写 `shortcuts` 状态槽，不调用 `runTabOperation()`。

- [ ] **Step 4: 运行集成、菜单、模型测试和类型检查**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-context-menu.test.ts tests/shortcut-model.test.ts && npm run typecheck`

Expected: 三个测试文件全部 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交协调层**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后：

```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts
git commit -m "$timestamp feat 支持右键设为快捷网站"
```

### Task 4: 调整菜单、加号与搜索区域样式

**Files:**
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写入样式契约的失败测试**

在 `tests/sidepanel-css.test.ts` 中把新建按钮断言改为：

```ts
expect(css).toMatch(
  /\.new-tab-button\s*{[^}]*width:\s*44px[^}]*height:\s*24px[^}]*margin:\s*3px\s+auto[^}]*border:\s*1px\s+solid\s+ButtonBorder[^}]*border-radius:\s*5px/s,
);
```

新增：

```ts
it("styles context-menu states and the rounded search field", () => {
  expect(css).toMatch(/\.tab-context-menu\s*>\s*button:hover:not\(:disabled\)\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+8%,\s*transparent\)/s);
  expect(css).toMatch(/\.tab-context-menu\s*>\s*button:active:not\(:disabled\)\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+13%,\s*transparent\)/s);
  expect(css).toMatch(/\.tab-context-menu\s*>\s*button:focus-visible\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+8%,\s*transparent\)/s);
  expect(css).not.toMatch(/\.bottom-toolbar\s*{[^}]*border-top/s);
  expect(css).toMatch(/#tab-search\s*{[^}]*height:\s*32px[^}]*border-radius:\s*16px/s);
});
```

保留 `empty-message` 的 `inset: 30px 0 0` 断言，确保加号总占位没有变化。

- [ ] **Step 2: 运行 CSS 测试确认失败**

Run: `npm test -- --run tests/sidepanel-css.test.ts`

Expected: FAIL；当前加号无边框且占满宽度，底栏有顶边，搜索框圆角为 6px。

- [ ] **Step 3: 实现最小 CSS 调整**

将 `.new-tab-button` 主体替换为：

```css
.new-tab-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 24px;
  margin: 3px auto;
  padding: 0;
  border: 1px solid ButtonBorder;
  border-radius: 5px;
  background: transparent;
  color: CanvasText;
  font: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
```

在菜单项主体后加入：

```css
.tab-context-menu > button:hover:not(:disabled) {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}

.tab-context-menu > button:focus-visible {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}

.tab-context-menu > button:active:not(:disabled) {
  background: color-mix(in srgb, CanvasText 13%, transparent);
}

.tab-context-menu > button:disabled {
  color: GrayText;
}
```

删除 `.bottom-toolbar` 的 `border-top: 1px solid ButtonBorder;`，将 `#tab-search` 的圆角改为 `border-radius: 16px;`。不要改变高度、网格列、内边距、设置按钮或媒体查询。

- [ ] **Step 4: 运行 CSS 和侧边栏回归测试**

Run: `npm test -- --run tests/sidepanel-css.test.ts tests/sidebar.test.ts`

Expected: 全部 PASS；空状态、底栏固定和搜索交互的原有断言继续通过。

- [ ] **Step 5: 提交样式层**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后：

```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/sidebar.css tests/sidepanel-css.test.ts
git commit -m "$timestamp feat 优化菜单与搜索界面样式"
```

### Task 5: 发布 `0.4.0` 并完成验收

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `tests/smoke.test.ts`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`

- [ ] **Step 1: 先更新发布一致性测试**

把 `tests/smoke.test.ts` 的版本断言改为：

```ts
expect(manifest.version).toBe("0.4.0");
expect(packageJson.version).toBe("0.4.0");
expect(packageLock.version).toBe("0.4.0");
expect(packageLock.packages[""]?.version).toBe("0.4.0");
```

README 包名测试继续使用 `manifest.version` 拼接，不增加第二份硬编码断言。

- [ ] **Step 2: 运行 smoke 测试确认失败**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前版本仍为 `0.3.0`。

- [ ] **Step 3: 同步版本和文档**

Run: `npm version 0.4.0 --no-git-tag-version`

将 `manifest.json` 改为 `"version": "0.4.0"`，README 包名改为 `release/sidetab-lite-0.4.0.zip`。

在 `docs/chrome-web-store-checklist.md` 的“标签页与快捷入口”增加：

```markdown
- [ ] 标签右键菜单的三项命令在鼠标悬停、键盘焦点和按下时均有清晰反馈；`Shift+F10`、方向键、`Enter`、空格和 `Esc` 可操作。
- [ ] “设为快捷网站”可保存当前 HTTP/HTTPS 标签；重复地址、12 项上限、无效地址和保存失败均有明确反馈，且不会自动开启快捷入口总开关。
- [ ] 标签列表末尾的加号为有边框的居中按钮；搜索区域上方无分割线，搜索框为圆角，底部工具栏仍固定。
```

- [ ] **Step 4: 运行完整检查与打包**

Run: `npm run package`

Expected: 类型检查、全部 Vitest 测试、构建、dist 审计均 PASS，并生成 `release/sidetab-lite-0.4.0.zip`。

- [ ] **Step 5: 审计 ZIP、版本和工作树**

Run:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = (Resolve-Path 'release\sidetab-lite-0.4.0.zip').Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $manifestEntry = $archive.GetEntry('manifest.json')
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($archive.Entries.Count -ne 11) { throw 'unexpected ZIP entry count' }
  if ($manifest.version -ne '0.4.0') { throw 'unexpected ZIP version' }
} finally {
  $archive.Dispose()
}
Get-FileHash $zipPath -Algorithm SHA256
git diff --check
git status --short
```

Expected: ZIP 恰好 11 项，内部版本为 `0.4.0`，输出 SHA-256，差异检查无错误。

- [ ] **Step 6: 进行 180px 视觉和交互验收**

在 `180 × 720` 浅色和深色主题中检查：

```text
标签数量：0、3、30
快捷入口：关闭、开启
搜索：无匹配结果
右键：三项菜单、hover、focus-visible、active、Shift+F10 键盘执行
```

确认加号总占位仍为 30px、实际按钮为 44×24px；滚到底时紧接最后一行；底栏无分割线且始终固定；搜索框为 16px 圆角；添加快捷网站只写 Storage，不调用 `tabs.create`、`duplicate`、`move` 或 `update`。

优先使用应用内 Browser。若连接失败，记录精确原因后使用本机 Chrome + Playwright Core 回退，截图保存到仓库外临时目录。

- [ ] **Step 7: 提交发布变更**

先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，然后：

```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add package.json package-lock.json manifest.json tests/smoke.test.ts README.md docs/chrome-web-store-checklist.md
git commit -m "$timestamp feat 发布右键快捷网站优化 0.4.0"
```

- [ ] **Step 8: 最终独立复核**

Run: `npm run package`

Expected: 全量检查再次 PASS，`release/sidetab-lite-0.4.0.zip` 再次通过 11 项和版本审计，`git status --short` 为空。
