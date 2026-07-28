# 设置齿轮图标尺寸优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将底部设置齿轮图标放大到 18px，同时保持 32px 点击区域和侧边栏底部布局不变，并发布 0.6.1。

**Architecture:** 复用现有 `.icon-button` 的 32px 尺寸，仅在 `#shortcut-settings` 上覆盖字号。通过 CSS 回归测试锁定图标字号和按钮无边框样式；版本号同步更新后使用现有 package 脚本完成完整验证。

**Tech Stack:** TypeScript、原生 CSS、Vitest、Vite、Chrome Extension Manifest V3。

---

### Task 1: 锁定齿轮字号回归行为

**Files:**
- Modify: `tests/sidepanel-css.test.ts`

- [ ] **Step 1: 写入失败测试**

在现有 `styles the appearance entry and settings gear without button chrome` 测试中增加断言：

```ts
expect(css).toMatch(/#shortcut-settings\s*{[^}]*font-size:\s*18px/s);
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npm test -- --run tests/sidepanel-css.test.ts`

预期：该测试失败，原因是当前规则没有为 `#shortcut-settings` 声明 `font-size: 18px`。

### Task 2: 实现 18px 齿轮样式

**Files:**
- Modify: `src/sidepanel/sidebar.css:110-124`

- [ ] **Step 1: 添加最小 CSS 覆盖**

将 `#shortcut-settings` 规则调整为：

```css
#shortcut-settings {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  font-size: 18px;
}
```

保留原有 hover、active、focus-visible 行为和 `.icon-button` 的 32px 宽高。

- [ ] **Step 2: 运行 CSS 测试确认通过**

运行：`npm test -- --run tests/sidepanel-css.test.ts`

预期：CSS 测试全部通过。

### Task 3: 发布版本升级到 0.6.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `docs/chrome-web-store-checklist.md`
- Modify: `tests/smoke.test.ts`

- [ ] **Step 1: 更新版本号**

将所有当前 `0.6.0` 发布版本引用更新为 `0.6.1`，保持 package、扩展 manifest、文档和发布脚本测试的一致性。

- [ ] **Step 2: 运行发布版本测试**

运行：`npm test -- --run tests/smoke.test.ts tests/release-scripts.test.ts`

预期：版本号和发布文件断言全部通过。

### Task 4: 完整验证并生成安装包

**Files:**
- Generated: `release/sidetab-lite-0.6.1.zip`

- [ ] **Step 1: 运行完整打包流程**

运行：`npm run package`

预期：类型检查、20 个测试文件、构建、dist 检查均通过，并生成 `release/sidetab-lite-0.6.1.zip`。

- [ ] **Step 2: 审计 ZIP 内容**

确认 ZIP 中 manifest 版本为 `0.6.1`，权限仍为 `sidePanel,tabs,storage,history`，且不包含 `src`、`tests`、`node_modules`、文档源文件或 source map。

- [ ] **Step 3: 检查工作区并提交**

运行：`git status --short`，仅允许预期源码、测试、版本文档和发布包变化；使用符合仓库规则的提交消息：

```text
yyyyMMddHHmmss feat 放大设置齿轮图标并发布0.6.1
```
