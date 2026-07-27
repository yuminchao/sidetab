# 标签列表新增按钮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标签列表末尾增加一个随列表滚动的加号按钮，点击后创建并激活新标签页，并发布 `0.3.0` 安装包。

**Architecture:** 将纵向滚动职责从 `tab-list` 移到新的 `tab-scroll` 容器，使标签列表与独立按钮作为一个整体滚动。创建动作扩展现有 `tab-actions`，协调层只管理单次请求的禁用状态和错误展示，标签 DOM 仍由 Chrome `onCreated` 事件更新。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM/CSS、Vitest、JSDOM、现有 Node 发布脚本。

---

## 文件结构

- 修改 `src/sidepanel/tab-actions.ts`：增加创建标签页动作和稳定错误映射。
- 修改 `src/sidepanel/index.html`：增加 `tab-scroll` 和 `new-tab-button`。
- 修改 `src/sidepanel/sidebar.css`：移动滚动职责，增加按钮状态样式，避免空状态覆盖按钮。
- 修改 `src/sidepanel/sidebar.ts`：绑定按钮、管理请求期间禁用状态和清理生命周期。
- 修改 `tests/tab-actions.test.ts`：覆盖创建动作成功、同步异常和 Promise 拒绝。
- 修改 `tests/sidebar.test.ts`：更新测试 DOM，覆盖点击、防重复、恢复、错误和清理。
- 修改 `tests/sidepanel-css.test.ts`：锁定滚动容器、按钮尺寸和空状态行为。
- 修改 `tests/smoke.test.ts`：锁定 `0.3.0` 三处版本一致性。
- 修改 `package.json`、`package-lock.json`、`manifest.json`：发布版本升级到 `0.3.0`。
- 修改 `docs/chrome-web-store-checklist.zh-CN.md`：增加新建按钮验收项。

### Task 1: 扩展标签创建动作

**Files:**
- Modify: `tests/tab-actions.test.ts`
- Modify: `src/sidepanel/tab-actions.ts`

- [ ] **Step 1: 编写创建动作失败测试**

在 `tabApi()` 返回值中保留现有 `create` 测试桩，并在 `describe("tab actions")` 中增加：

```ts
it("creates one active new tab", async () => {
  const create = vi.fn().mockResolvedValue(tab);

  await createTabActions(tabApi({ create })).create();

  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith({ active: true });
});

it.each([
  ["synchronous throw", () => vi.fn(() => { throw new Error("chrome failed"); })],
  ["promise rejection", () => vi.fn().mockRejectedValue(new Error("chrome failed"))],
])("maps a create %s to the user-facing error", async (_case, makeCreate) => {
  await expect(createTabActions(tabApi({ create: makeCreate() })).create()).rejects.toThrow(
    "无法新建标签页",
  );
});
```

同时把 `tabApi()` 的默认返回值补充为：

```ts
create: vi.fn().mockResolvedValue(tab),
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/tab-actions.test.ts`

Expected: FAIL，提示 `create` 不属于 `TabsActionApi` 或动作不存在。

- [ ] **Step 3: 实现最小创建动作**

将动作 API 类型改为：

```ts
export type TabsActionApi = Pick<
  typeof chrome.tabs,
  "create" | "duplicate" | "move" | "remove" | "update"
>;
```

在返回对象中加入：

```ts
async create(): Promise<void> {
  try {
    await api.create({ active: true });
  } catch {
    throw new Error("无法新建标签页");
  }
},
```

- [ ] **Step 4: 运行动作测试和类型检查**

Run: `npm test -- --run tests/tab-actions.test.ts && npm run typecheck`

Expected: 动作测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交动作层**

```powershell
Get-Content -Raw -Encoding UTF8 'C:\Users\NUC\.codex\rules\git-commit.md'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/tab-actions.ts tests/tab-actions.test.ts
git commit -m "$timestamp feat 新增创建标签页动作"
```

### Task 2: 建立滚动结构和紧凑按钮样式

**Files:**
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/sidebar.css`
- Modify: `tests/sidepanel-css.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1: 编写 DOM 与 CSS 失败测试**

在 `tests/sidebar.test.ts` 的真实文档结构测试中增加：

```ts
it("places the tab list and new-tab button together in the scrolling region", () => {
  const html = readFileSync("src/sidepanel/index.html", "utf8");
  const page = new DOMParser().parseFromString(html, "text/html");
  const scroll = page.querySelector("#tab-scroll");

  expect(Array.from(scroll?.children ?? [], (child) => child.id)).toEqual([
    "tab-list",
    "new-tab-button",
  ]);
  expect(page.querySelector("#tab-list")?.getAttribute("role")).toBe("list");
  expect(page.querySelector("#new-tab-button")?.getAttribute("aria-label")).toBe("新建标签页");
});
```

更新 `tests/sidepanel-css.test.ts` 的滚动断言并增加按钮断言：

```ts
expect(css).toMatch(
  /\.tab-scroll\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*overflow-x:\s*hidden/s,
);
expect(css).not.toMatch(/\.tab-list\s*\{[^}]*overflow-y:\s*auto/s);
expect(css).toMatch(
  /\.new-tab-button\s*\{[^}]*width:\s*100%[^}]*height:\s*30px[^}]*border:\s*0/s,
);
expect(css).toMatch(/\.empty-message\s*\{[^}]*pointer-events:\s*none/s);
```

- [ ] **Step 2: 运行结构和样式测试确认失败**

Run: `npm test -- --run tests/sidebar.test.ts tests/sidepanel-css.test.ts`

Expected: FAIL，缺少 `tab-scroll`、`new-tab-button` 和对应样式。

- [ ] **Step 3: 修改页面结构**

将标签区域改为：

```html
<section id="tab-region" class="tab-region" aria-label="当前窗口标签页">
  <p id="tab-empty" class="empty-message" hidden>没有匹配的标签页</p>
  <div id="tab-scroll" class="tab-scroll">
    <div id="tab-list" class="tab-list" role="list"></div>
    <button
      id="new-tab-button"
      class="new-tab-button"
      type="button"
      title="新建标签页"
      aria-label="新建标签页"
    >+</button>
  </div>
</section>
```

同步更新 `installFixture()`，加入相同 ID 和父子顺序。

- [ ] **Step 4: 移动滚动职责并实现按钮样式**

将 `.tab-list` 的滚动声明替换为：

```css
.tab-scroll {
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

.tab-list {
  min-width: 0;
}
```

增加按钮和空状态规则：

```css
.new-tab-button {
  display: grid;
  place-items: center;
  width: 100%;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  color: CanvasText;
  font: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.new-tab-button:hover {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}

.new-tab-button:active {
  background: color-mix(in srgb, CanvasText 12%, transparent);
}

.new-tab-button:disabled {
  color: GrayText;
  cursor: default;
}

.new-tab-button:disabled:hover {
  background: transparent;
}
```

将 `.empty-message` 调整为从按钮下方开始且不拦截点击：

```css
.empty-message {
  position: absolute;
  z-index: 1;
  inset: 30px 0 0;
  margin: 0;
  padding: 24px 12px;
  color: GrayText;
  text-align: center;
  pointer-events: none;
}
```

- [ ] **Step 5: 运行结构与样式测试**

Run: `npm test -- --run tests/sidebar.test.ts tests/sidepanel-css.test.ts`

Expected: 两个测试文件全部 PASS。

- [ ] **Step 6: 提交结构与样式**

```powershell
Get-Content -Raw -Encoding UTF8 'C:\Users\NUC\.codex\rules\git-commit.md'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/index.html src/sidepanel/sidebar.css tests/sidebar.test.ts tests/sidepanel-css.test.ts
git commit -m "$timestamp feat 新增标签列表滚动创建按钮"
```

### Task 3: 集成创建请求生命周期

**Files:**
- Modify: `tests/sidebar.test.ts`
- Modify: `src/sidepanel/sidebar.ts`

- [ ] **Step 1: 编写点击、防重复、错误与清理失败测试**

在 `tests/sidebar.test.ts` 中使用现有 `deferred` 和 `createFakeChrome` 增加：

```ts
it("creates one active tab and disables the button while the request is pending", async () => {
  const pending = deferred<chrome.tabs.Tab>();
  const fake = createFakeChrome();
  fake.methods.create.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  const button = element("new-tab-button") as HTMLButtonElement;

  click(button);
  click(button);

  expect(fake.methods.create).toHaveBeenCalledOnce();
  expect(fake.methods.create).toHaveBeenCalledWith({ active: true });
  expect(button.disabled).toBe(true);

  pending.resolve(fakeTab({ id: 99, active: true }));
  await flush();
  expect(button.disabled).toBe(false);
  cleanup();
});

it("restores the new-tab button and reports a create failure", async () => {
  const fake = createFakeChrome();
  fake.methods.create.mockRejectedValueOnce(new Error("browser failed"));
  const cleanup = await startSidebar(fake);
  const button = element("new-tab-button") as HTMLButtonElement;

  click(button);
  await flush();

  expect(button.disabled).toBe(false);
  expect(element("status-message").textContent).toBe("无法新建标签页");
  cleanup();
});

it("removes the new-tab listener and ignores pending completion after cleanup", async () => {
  const pending = deferred<chrome.tabs.Tab>();
  const fake = createFakeChrome();
  fake.methods.create.mockReturnValueOnce(pending.promise);
  const cleanup = await startSidebar(fake);
  const button = element("new-tab-button") as HTMLButtonElement;

  click(button);
  cleanup();
  pending.resolve(fakeTab({ id: 99 }));
  await flush();
  click(button);

  expect(fake.methods.create).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
});
```

- [ ] **Step 2: 运行集成测试确认失败**

Run: `npm test -- --run tests/sidebar.test.ts`

Expected: FAIL，按钮没有绑定创建动作或 `new-tab-button` 尚未注册为必需元素。

- [ ] **Step 3: 注册按钮并实现请求生命周期**

在 `SidebarElements` 中增加：

```ts
newTabButton: HTMLButtonElement;
```

在 `getSidebarElements()` 中增加：

```ts
newTabButton: requireElement(document, "new-tab-button", HTMLButtonElement),
```

在初始化区域增加：

```ts
const onNewTabClick = (): void => {
  if (elements.newTabButton.disabled) return;
  elements.newTabButton.disabled = true;
  runTabOperation(tabActions.create(), () => {
    if (active) {
      elements.newTabButton.disabled = false;
    }
  });
};

elements.newTabButton.addEventListener("click", onNewTabClick);
```

在 `cleanup()` 中移除监听器：

```ts
elements.newTabButton.removeEventListener("click", onNewTabClick);
```

- [ ] **Step 4: 运行集成、动作和类型测试**

Run: `npm test -- --run tests/sidebar.test.ts tests/tab-actions.test.ts && npm run typecheck`

Expected: 所有目标测试 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交协调层**

```powershell
Get-Content -Raw -Encoding UTF8 'C:\Users\NUC\.codex\rules\git-commit.md'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add src/sidepanel/sidebar.ts tests/sidebar.test.ts
git commit -m "$timestamp feat 集成新建标签页按钮交互"
```

### Task 4: 升级版本并完成发布验收

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `tests/smoke.test.ts`
- Modify: `docs/chrome-web-store-checklist.zh-CN.md`

- [ ] **Step 1: 先将版本测试更新为 `0.3.0`**

将 `tests/smoke.test.ts` 的版本断言改为：

```ts
it("keeps the npm and extension release versions aligned at 0.3.0", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.version).toBe("0.3.0");
  expect(packageJson.version).toBe("0.3.0");
  expect(packageLock.version).toBe("0.3.0");
  expect(packageLock.packages[""].version).toBe("0.3.0");
});
```

- [ ] **Step 2: 运行版本测试确认失败**

Run: `npm test -- --run tests/smoke.test.ts`

Expected: FAIL，当前版本仍为 `0.2.0`。

- [ ] **Step 3: 同步升级发布版本**

Run: `npm version 0.3.0 --no-git-tag-version`

然后将 `manifest.json` 中的版本改为：

```json
"version": "0.3.0"
```

- [ ] **Step 4: 更新中文商店验收清单**

在功能验收部分加入：

```markdown
- [ ] 加号按钮位于最后一个标签之后，并随标签列表滚动。
- [ ] 点击加号只创建并激活一个新标签页，请求期间无法重复点击。
- [ ] 空列表和搜索无结果时加号仍可见、可点击。
```

- [ ] **Step 5: 运行完整检查和打包**

Run: `npm run package`

Expected: 类型检查、全部测试、构建和 dist 审计 PASS，并生成 `release/sidetab-lite-0.3.0.zip`。

- [ ] **Step 6: 核验安装包版本、文件和哈希**

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = (Resolve-Path 'release\sidetab-lite-0.3.0.zip').Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = $archive.Entries | Sort-Object FullName
  $manifestEntry = $archive.GetEntry('manifest.json')
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($entries.Count -ne 11) { throw "unexpected ZIP entry count" }
  if ($manifest.version -ne '0.3.0') { throw "unexpected ZIP version" }
} finally {
  $archive.Dispose()
}
Get-FileHash $zipPath -Algorithm SHA256
git diff --check
git status --short
```

Expected: ZIP 恰好包含 11 个审核文件，内部版本为 `0.3.0`，输出完整 SHA-256，`git diff --check` 无错误。

- [ ] **Step 7: 提交发布变更**

```powershell
Get-Content -Raw -Encoding UTF8 'C:\Users\NUC\.codex\rules\git-commit.md'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
git add package.json package-lock.json manifest.json tests/smoke.test.ts docs/chrome-web-store-checklist.zh-CN.md
git commit -m "$timestamp feat 发布标签列表创建按钮 0.3.0"
```

### Task 5: 最终视觉和回归验收

**Files:**
- Verify: `dist/sidepanel/index.html`
- Verify: `dist/sidepanel/sidebar.css`
- Verify: `release/sidetab-lite-0.3.0.zip`

- [ ] **Step 1: 运行完整回归测试**

Run: `npm run check`

Expected: 类型检查、全部 Vitest 测试、构建和 dist 审计全部 PASS。

- [ ] **Step 2: 在 180px 宽度验证交互布局**

使用 Chrome 扩展侧栏或具备等价 Chrome API 测试桩的浏览器页面检查：

```text
视口：180 × 720
快捷网站：分别检查关闭和开启
标签数量：0、3、30
搜索：空查询和无匹配结果
主题：浅色和深色
```

Expected: 加号位于最后一行之后并随内容滚动；无标签和无搜索结果时可点击；底部搜索与设置固定；无横向溢出或控件重叠。

- [ ] **Step 3: 验证浏览器调用和拖动隔离**

点击加号并对按钮附近执行拖放，确认：

```text
chrome.tabs.create calls: 1，参数 { active: true }
chrome.tabs.move/update calls caused by button: 0
new-tab-button draggable: false
```

Expected: 创建动作和拖动排序完全隔离。

- [ ] **Step 4: 最终工作树检查**

Run: `git status --short && git diff --check`

Expected: 无未提交文件，`git diff --check` 无输出。
