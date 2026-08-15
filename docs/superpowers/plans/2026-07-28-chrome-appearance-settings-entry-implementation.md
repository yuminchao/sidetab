# Chrome 外观设置入口与设置图标优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在扩展设置中增加 Chrome 外观设置提示与跳转入口，将底部设置入口简化为纯齿轮，并以 `0.6.0` 版本发布可安装 ZIP。

**Architecture:** 使用静态 DOM 展示固定提示，不读取或保存侧边栏位置；在现有 `sidebar.ts` 生命周期中注册一个受 pending 和 cleanup 保护的 `chrome.tabs.create` 跳转动作；样式继续集中在 `sidebar.css`，不新增控制器或 Chrome Side Panel API 依赖。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3、Vitest、JSDOM、Vite、PowerShell。

---

## 文件职责

- 新建 `tests/sidepanel-markup.test.ts`：用 JSDOM 验证设置提示、链接按钮和纯图标可访问语义。
- 修改 `tests/sidepanel-css.test.ts`：锁定位置提示紧凑布局、纯齿轮样式及右键菜单微软雅黑字体栈。
- 修改 `src/sidepanel/index.html`：增加 Chrome 外观设置提示和跳转按钮，更新底部齿轮可访问名称。
- 修改 `src/sidepanel/sidebar.css`：实现提示行、跳转图标、纯齿轮和菜单字体样式。
- 修改 `tests/sidebar.test.ts`：覆盖跳转参数、防重复、失败反馈和 cleanup 生命周期。
- 修改 `src/sidepanel/sidebar.ts`：接入 `chrome://settings/appearance` 打开动作。
- 修改 `manifest.json`、`package.json`、`package-lock.json`：统一发布版本 `0.6.0`，权限保持不变。
- 修改 `tests/smoke.test.ts`：先锁定 `0.6.0` 元数据并驱动版本升级。
- 修改 `README.md`、`docs/chrome-web-store-checklist.md`：补充新入口、纯齿轮、菜单字体和发布验收说明。

### Task 1: 设置提示、齿轮和菜单字体

**Files:**
- Create: `tests/sidepanel-markup.test.ts`
- Modify: `tests/sidepanel-css.test.ts`
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`

- [ ] **Step 1: 写 DOM 失败测试**

新建 `tests/sidepanel-markup.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const document = new JSDOM(
  readFileSync("src/sidepanel/index.html", "utf8"),
).window.document;

describe("side panel settings markup", () => {
  it("provides a static Chrome appearance settings entry", () => {
    const row = document.querySelector<HTMLElement>(".appearance-setting");
    const link = document.querySelector<HTMLButtonElement>("#chrome-appearance-settings");

    expect(row?.textContent).toContain("侧边栏位置");
    expect(row?.textContent).toContain("请在 Chrome 外观设置中修改");
    expect(link?.type).toBe("button");
    expect(link?.title).toBe("打开 Chrome 外观设置");
    expect(link?.getAttribute("aria-label")).toBe("打开 Chrome 外观设置");
  });

  it("keeps the bottom settings control as an accessible icon button", () => {
    const button = document.querySelector<HTMLButtonElement>("#shortcut-settings");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.title).toBe("设置");
    expect(button?.getAttribute("aria-label")).toBe("设置");
    expect(button?.textContent?.trim()).toBe("⚙");
  });
});
```

- [ ] **Step 2: 写 CSS 失败测试**

在 `tests/sidepanel-css.test.ts` 增加：

```ts
it("styles the appearance entry and settings gear without button chrome", () => {
  expect(css).toMatch(
    /\.appearance-setting\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+32px[^}]*min-width:\s*0/s,
  );
  expect(css).toMatch(
    /\.appearance-setting-hint\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s,
  );
  expect(css).toMatch(
    /#shortcut-settings\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
  );
  expect(css).toMatch(
    /#shortcut-settings:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent/s,
  );
});

it("uses Microsoft YaHei for the context menu", () => {
  expect(css).toMatch(
    /\.tab-context-menu\s*\{[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/s,
  );
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run: `npm test -- --run tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Expected: FAIL，提示缺少 `.appearance-setting`、`#chrome-appearance-settings`、纯齿轮覆盖样式和菜单字体栈。

- [ ] **Step 4: 写最小 HTML 实现**

在 `src/sidepanel/index.html` 的字号设置下方加入：

```html
<div class="appearance-setting">
  <span>侧边栏位置</span>
  <span class="appearance-setting-hint">请在 Chrome 外观设置中修改</span>
  <button
    id="chrome-appearance-settings"
    class="appearance-settings-link"
    type="button"
    title="打开 Chrome 外观设置"
    aria-label="打开 Chrome 外观设置"
  >
    ↗
  </button>
</div>
```

把 `#shortcut-settings` 的 `title` 和 `aria-label` 均改为“设置”，保留原生 `button` 与齿轮字符。

- [ ] **Step 5: 写最小 CSS 实现**

在 `src/sidepanel/sidebar.css` 增加：

```css
#shortcut-settings {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

#shortcut-settings:hover:not(:disabled) {
  background: transparent;
  color: color-mix(in srgb, CanvasText 78%, transparent);
}

#shortcut-settings:active:not(:disabled) {
  opacity: 0.72;
}

.appearance-setting {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 32px;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.appearance-setting-hint {
  min-width: 0;
  color: GrayText;
  overflow-wrap: anywhere;
}

.appearance-settings-link {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
}
```

在现有 `.tab-context-menu` 规则中加入：

```css
font-family: "Microsoft YaHei", "微软雅黑", "Segoe UI", system-ui, sans-serif;
```

- [ ] **Step 6: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts`

Expected: 两个测试文件全部 PASS。

- [ ] **Step 7: 提交界面改动**

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`，生成本地时间戳：

```powershell
git add src/sidepanel/index.html src/sidepanel/sidebar.css tests/sidepanel-markup.test.ts tests/sidepanel-css.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 新增Chrome外观设置入口界面"
```

### Task 2: Chrome 外观设置跳转行为

**Files:**
- Modify: `tests/sidebar.test.ts`
- Modify: `src/sidepanel/sidebar.ts`

- [ ] **Step 1: 扩展测试夹具并写成功与防重复失败测试**

在 `installFixture()` 的字号输入框后加入：

```html
<button id="chrome-appearance-settings" type="button"></button>
```

在 `tests/sidebar.test.ts` 增加：

```ts
it("opens Chrome appearance settings once while the request is pending", async () => {
  const pending = deferred<chrome.tabs.Tab>();
  const fake = createFakeChrome();
  fake.methods.create.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  const button = element<HTMLButtonElement>("chrome-appearance-settings");

  click(button);
  click(button);

  expect(fake.methods.create).toHaveBeenCalledOnce();
  expect(fake.methods.create).toHaveBeenCalledWith({
    url: "chrome://settings/appearance",
    active: true,
  });
  expect(button.disabled).toBe(true);

  pending.resolve(fakeTab({ id: 999 }));
  await flush();
  expect(button.disabled).toBe(false);
  cleanup();
});
```

- [ ] **Step 2: 写失败反馈和 cleanup 失败测试**

```ts
it("reports a rejected Chrome appearance settings request", async () => {
  const fake = createFakeChrome();
  fake.methods.create.mockRejectedValueOnce(new Error("browser failed"));
  const cleanup = await startSidebar(fake);
  const button = element<HTMLButtonElement>("chrome-appearance-settings");

  click(button);
  await flush();

  expect(button.disabled).toBe(false);
  expect(element("shortcut-error").textContent).toBe("无法打开 Chrome 外观设置");
  cleanup();
});

it("does not update or reopen Chrome settings after cleanup", async () => {
  const pending = deferred<chrome.tabs.Tab>();
  const fake = createFakeChrome();
  fake.methods.create.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  const button = element<HTMLButtonElement>("chrome-appearance-settings");

  click(button);
  cleanup();
  pending.reject(new Error("late failure"));
  await flush();
  click(button);

  expect(fake.methods.create).toHaveBeenCalledOnce();
  expect(element("shortcut-error").textContent).toBe("");
});
```

- [ ] **Step 3: 运行测试并确认 RED**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，外部跳转按钮点击后尚未调用 `tabs.create`。

- [ ] **Step 4: 接入元素与生命周期**

在 `SidebarElements` 增加：

```ts
chromeAppearanceSettings: HTMLButtonElement;
```

在 `getSidebarElements()` 增加：

```ts
chromeAppearanceSettings: requireElement(
  document,
  "chrome-appearance-settings",
  HTMLButtonElement,
),
```

在 `startSidebarInternal()` 的 busy 状态中加入：

```ts
let appearanceSettingsBusy = false;
```

在事件绑定前定义：

```ts
const onChromeAppearanceSettingsClick = (): void => {
  if (appearanceSettingsBusy) return;
  appearanceSettingsBusy = true;
  elements.chromeAppearanceSettings.disabled = true;
  elements.shortcutError.textContent = "";

  void (async () => {
    try {
      await deps.tabs.create({
        url: "chrome://settings/appearance",
        active: true,
      });
    } catch {
      if (active) {
        elements.shortcutError.textContent = "无法打开 Chrome 外观设置";
      }
    } finally {
      if (active) {
        appearanceSettingsBusy = false;
        elements.chromeAppearanceSettings.disabled = false;
      }
    }
  })();
};
```

绑定：

```ts
elements.chromeAppearanceSettings.addEventListener(
  "click",
  onChromeAppearanceSettingsClick,
);
```

在 `cleanup()` 中移除同一个监听器。cleanup 不重置按钮和错误文本，保证晚到 Promise 不修改 DOM。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: 全部 PASS，包含成功、防重复、失败和 cleanup 场景。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交行为改动**

提交前读取 Git 规则并生成本地时间戳：

```powershell
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 接入Chrome外观设置跳转"
```

### Task 3: 发布 `0.6.0`

**Files:**
- Modify: `tests/smoke.test.ts`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`

- [ ] **Step 1: 先更新版本测试并确认 RED**

把 `tests/smoke.test.ts` 的版本用例改为：

```ts
it("keeps the npm and extension release versions aligned at 0.6.0", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.version).toBe("0.6.0");
  expect(packageJson.version).toBe("0.6.0");
  expect(packageLock.version).toBe("0.6.0");
  expect(packageLock.packages[""].version).toBe("0.6.0");
});
```

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前 manifest 和 npm 元数据仍为 `0.5.0`。

- [ ] **Step 2: 升级版本元数据**

Run: `npm version 0.6.0 --no-git-tag-version`

把 `manifest.json` 的 `version` 改为 `0.6.0`。权限继续精确保持：

```json
["sidePanel", "tabs", "storage", "history"]
```

- [ ] **Step 3: 更新中文发布文档**

在 `README.md` 增加：

```markdown
设置对话框提供 Chrome 外观设置入口，用于调整整个 Chrome 侧边栏位于左侧或右侧；扩展不读取或保存该位置。底部设置入口仅显示齿轮图标，标签右键菜单优先使用微软雅黑。
```

把发布包名更新为 `release/sidetab-lite-0.6.0.zip`。

在 `docs/chrome-web-store-checklist.md` 增加验收项：

```markdown
- [ ] 设置中的“侧边栏位置”提示可打开 `chrome://settings/appearance`，连续点击只创建一个标签页，失败反馈明确。
- [ ] 底部设置入口只显示齿轮，无普通按钮边框或背景，键盘焦点轮廓清晰。
- [ ] 标签右键菜单使用微软雅黑字体栈，四项菜单在 180px 宽度下不溢出。
```

- [ ] **Step 4: 运行发布测试和完整打包**

Run: `npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

Expected: 全部 PASS。

Run: `npm run package`

Expected: 类型检查、全部测试、构建和 dist 审计通过，生成 `release/sidetab-lite-0.6.0.zip`。

- [ ] **Step 5: 审计 ZIP**

使用 PowerShell `System.IO.Compression.ZipFile` 读取 `release/sidetab-lite-0.6.0.zip`：

- 根目录精确包含 11 个发布文件。
- ZIP 内 `manifest.json` 版本为 `0.6.0`。
- 权限仍为 `sidePanel,tabs,storage,history`。
- 不含 TypeScript 源码、source map、测试、预览 mock 或其他开发文件。
- 使用 `Get-FileHash -Algorithm SHA256` 记录摘要。

- [ ] **Step 6: 提交发布变更**

提交前读取 Git 规则并生成本地时间戳：

```powershell
git add manifest.json package.json package-lock.json README.md docs/chrome-web-store-checklist.md tests/smoke.test.ts
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$timestamp feat 发布Chrome外观设置入口0.6.0"
```

### Task 4: 视觉验收与最终验证

**Files:**
- Verify only

- [ ] **Step 1: 重新执行完整验证**

Run: `npm run package`

Expected: 类型检查、全部测试、构建、dist 审计和 ZIP 自验全部通过。

- [ ] **Step 2: 浏览器视觉和交互验收**

使用内置浏览器打开构建后的 `sidepanel/index.html`，分别检查常规宽度和 180px 最窄宽度：

- “侧边栏位置”提示可读，长提示自然换行，不覆盖跳转图标。
- 底部只显示齿轮，搜索框宽度和固定底栏位置不变。
- 齿轮和跳转图标的鼠标、按下、键盘焦点状态清晰。
- 右键菜单使用微软雅黑，四项菜单不溢出。
- 浅色、深色主题均无重叠、横向滚动或控制台错误。

- [ ] **Step 3: 检查工作区和提交**

Run: `git status --short`

Expected: 无输出。

Run: `git log -5 --oneline`

Expected: 包含设计、计划、界面、跳转行为和 `0.6.0` 发布提交。

- [ ] **Step 4: 报告交付信息**

报告 ZIP 绝对路径、SHA-256、测试文件与测试数量、扩展版本、权限、视觉验收结果，以及真实 Chrome 中“加载已解压扩展”的剩余冒烟检查。
