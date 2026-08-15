# 搜索结果点击失效修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复收藏夹和历史记录搜索结果在真实鼠标慢速点击时无反应的问题，并保证成功打开后清空搜索框、失败时保留查询。

**Architecture:** 保留现有 `click -> openResult()` 打开链路，在结果容器增加一个委托式主按钮 `pointerdown` 处理器，通过 `preventDefault()` 阻止该交互让搜索框失焦。结果定位抽成同文件私有 helper，供 `pointerdown` 和 `click` 共享；新增监听器在 `destroy()` 中对称移除。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、原生 DOM 事件、Vitest、jsdom。

---

## 前置条件

- 在 `E:\java\sidebar\.worktrees\feature-side-panel-tabs` 执行。
- 设计依据：`docs/superpowers/specs/2026-08-04-search-result-click-design.md`。
- 严格使用 TDD，必须先观察新增测试因缺少 `pointerdown` 保护而失败。
- 提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`。
- 本修复不升级版本、不修改 Manifest、不打包。

## 文件结构

- Modify: `src/sidepanel/history-search.ts`：共享结果行定位、主按钮 `pointerdown` 焦点保护、监听器销毁。
- Modify: `tests/history-search.test.ts`：真实慢速点击时序、成功清空、失败保留、非主按钮和销毁回归。

### Task 1：用真实指针时序复现点击失效

**Files:**
- Modify: `tests/history-search.test.ts`

- [ ] **Step 1：增加慢速点击测试 helper**

在 `describe("history search controller")` 内增加只用于测试的 helper。它先派发可取消的主按钮 `pointerdown`；只有事件没有被取消时才模拟浏览器执行输入框失焦，然后推进零延迟定时器并派发 `click`：

```ts
const slowPrimaryClick = async (option: HTMLElement): Promise<MouseEvent> => {
  const pointerDown = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  option.dispatchEvent(pointerDown);
  if (!pointerDown.defaultPrevented) input.blur();
  await vi.advanceTimersByTimeAsync(0);
  option.click();
  await flush();
  return pointerDown;
};
```

helper 必须放在能访问当前 `input` 的测试作用域内，不加入生产代码。

- [ ] **Step 2：写历史记录慢速点击红灯测试**

新增测试：

```ts
it("keeps history results available through a slow primary click", async () => {
  vi.useFakeTimers();
  const onOpen = vi.fn(async () => undefined);
  const controller = createHistorySearchController(
    { document, input, results },
    {
      bookmarks: emptyBookmarks(),
      history: {
        search: vi.fn(async () => [
          historyItem("history", "https://history.example/", "History"),
        ]),
      },
      onOpen,
    },
  );

  input.value = "history";
  input.focus();
  await flush();
  const option = results.querySelector<HTMLElement>("[role='option']")!;
  const pointerDown = await slowPrimaryClick(option);

  expect(pointerDown.defaultPrevented).toBe(true);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onOpen).toHaveBeenCalledWith("https://history.example/");
  expect(input.value).toBe("");
  expect(results.hidden).toBe(true);
  controller.destroy();
});
```

- [ ] **Step 3：写收藏夹慢速点击红灯测试**

使用非空查询让收藏夹结果位于第一项，并断言相同行为：

```ts
it("keeps bookmark results available through a slow primary click", async () => {
  vi.useFakeTimers();
  const onOpen = vi.fn(async () => undefined);
  const controller = createHistorySearchController(
    { document, input, results },
    {
      bookmarks: {
        search: vi.fn(async () => [
          bookmark("bookmark", "https://bookmark.example/", "Bookmark"),
        ]),
      },
      history: { search: vi.fn(async () => []) },
      onOpen,
    },
  );

  input.value = "bookmark";
  input.focus();
  await flush();
  const option = results.querySelector<HTMLElement>("[role='option']")!;
  const pointerDown = await slowPrimaryClick(option);

  expect(pointerDown.defaultPrevented).toBe(true);
  expect(onOpen).toHaveBeenCalledWith("https://bookmark.example/");
  expect(input.value).toBe("");
  expect(results.hidden).toBe(true);
  controller.destroy();
});
```

- [ ] **Step 4：运行测试确认正确红灯**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 两个新测试 FAIL；`pointerDown.defaultPrevented` 为 `false`，模拟 blur 定时器先执行后 `onOpen` 未被调用。既有测试继续通过。

### Task 2：实现委托式焦点保护与生命周期清理

**Files:**
- Modify: `src/sidepanel/history-search.ts`
- Modify: `tests/history-search.test.ts`

- [ ] **Step 1：集中结果行定位逻辑**

在 `onResultsClick` 前增加同文件私有函数，确保两种事件使用完全相同的有效结果判断：

```ts
const findResultOption = (target: EventTarget | null): HTMLElement | undefined => {
  const option = target instanceof Element
    ? target.closest<HTMLElement>("[data-history-index]")
    : null;
  return option && elements.results.contains(option) ? option : undefined;
};
```

把现有点击处理器改为：

```ts
const onResultsClick = (event: MouseEvent): void => {
  const option = findResultOption(event.target);
  if (!option) return;
  void openResult(Number(option.dataset.historyIndex));
};
```

- [ ] **Step 2：增加主按钮 pointerdown 处理器**

只拦截有效结果行上的主按钮，非主按钮和空白区域保持默认行为：

```ts
const onResultsPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0 || !findResultOption(event.target)) return;
  event.preventDefault();
};
```

注册顺序放在结果容器的 `click` 前：

```ts
elements.results.addEventListener("pointerdown", onResultsPointerDown);
elements.results.addEventListener("click", onResultsClick);
```

`destroy()` 必须从同一对象移除：

```ts
elements.results.removeEventListener("pointerdown", onResultsPointerDown);
elements.results.removeEventListener("click", onResultsClick);
```

- [ ] **Step 3：运行慢速点击测试确认绿灯**

Run: `npm test -- --run tests/history-search.test.ts`

Expected: 新增收藏夹和历史记录慢速点击测试 PASS；全部既有历史搜索测试通过。

- [ ] **Step 4：补非主按钮、空白区域和销毁测试**

增加边界断言：

```ts
const secondary = new MouseEvent("pointerdown", {
  bubbles: true,
  cancelable: true,
  button: 2,
});
option.dispatchEvent(secondary);
expect(secondary.defaultPrevented).toBe(false);

const blank = new MouseEvent("pointerdown", {
  bubbles: true,
  cancelable: true,
  button: 0,
});
results.dispatchEvent(blank);
expect(blank.defaultPrevented).toBe(false);

controller.destroy();
const afterDestroy = new MouseEvent("pointerdown", {
  bubbles: true,
  cancelable: true,
  button: 0,
});
option.dispatchEvent(afterDestroy);
expect(afterDestroy.defaultPrevented).toBe(false);
```

在既有打开失败测试中补充：

```ts
expect(input.value).toBe("keep");
expect(results.hidden).toBe(false);
```

既有 Enter 测试必须继续断言成功后 `input.value === ""` 和面板隐藏。

- [ ] **Step 5：运行专项和全量验证**

Run: `npm test -- --run tests/history-search.test.ts tests/sidebar.test.ts`

Expected: PASS；鼠标、Enter、Escape、Tab、外部点击、失焦和销毁场景全部通过。

Run: `npm run typecheck`

Expected: PASS；`pointerdown` 监听器使用 DOM 的 `PointerEvent` overload，无类型错误。

Run: `npm run check`

Expected: PASS；全部测试、构建和 14 文件 dist 审计通过。

Run: `git diff --check`

Expected: 无输出。

- [ ] **Step 6：性能与权限审计**

Run:

```powershell
rg -n "setInterval|chrome\.tabs\.query|chrome\.tabGroups\.query" `
  src/sidepanel/history-search.ts
```

Expected: 无新增匹配；既有两个 `setTimeout` 用途仍仅为 100ms 输入防抖和失焦收起。

确认 `manifest.json` 无 diff，版本仍为 `0.10.0`，不生成新的 ZIP。

- [ ] **Step 7：提交修复**

提交前读取 `C:\Users\NUC\.codex\rules\git-commit.md`。

只暂存：

```powershell
git add -- src/sidepanel/history-search.ts tests/history-search.test.ts
```

提交消息：`yyyyMMddHHmmss fix 修复搜索结果慢速点击失效`。

提交后运行：

```powershell
git status --short
git show --stat --oneline HEAD
```

Expected: 工作树干净，提交只包含上述两个文件。
