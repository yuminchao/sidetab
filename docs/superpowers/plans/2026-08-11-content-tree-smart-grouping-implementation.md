# 内容树开关与智能分组 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将设置中的“新 Tab 行为”迁移为默认关闭的“内容树”开关，把右键命令改名为“同网站快速分组”并复用匹配分组，同时新增可按网站和特殊页面分类的一键分组。

**Architecture:** 继续沿用现有侧边栏内存快照和 Chrome 事件同步，但把分类与规划收敛到一个无副作用的纯模型，把 Chrome API 调用收敛到顺序执行器；“其他”系统分组的身份按窗口保存在 `storage.session`，不依赖可修改标题。设置读取兼容旧字段，保存只写新字段。规划复杂度保持 O(n + g)，执行期间使用一个共享忙碌门禁，并在失败后只触发一次真实状态重同步。

**Tech Stack:** TypeScript、Chrome Extensions Manifest V3 API、原生 DOM、Vitest、JSDOM、esbuild

---

## 实施前约束

- 工作目录：`E:\java\sidebar\.worktrees\feature-side-panel-tabs`。
- 开始编码前重新读取 `C:\Users\NUC\.codex\rules\coding.md`，并检查仓库内适用的 `AGENTS.md`。
- 当前工作树包含用户已有修改；不得回滚、覆盖或顺手整理范围外差异。
- 用户尚未授权 Git 提交。本计划各任务只执行测试和 `git diff --check`；若后续明确授权提交，先读取 `C:\Users\NUC\.codex\rules\git-commit.md`，再只提交对应任务文件。
- 本计划不升级版本、不写 `update.log`、不生成 ZIP。只有用户后续明确要求打包时，才按仓库规则进行敏感信息检查、版本升级、更新日志和打包验证。

## Task 1：迁移内容树设置模型与存储

**Files:**

- Modify: `src/sidepanel/shortcut-model.ts`
- Modify: `src/sidepanel/shortcut-store.ts`
- Modify: `tests/shortcut-model.test.ts`
- Modify: `tests/shortcut-store.test.ts`

- [ ] **Step 1：先写迁移失败测试**

在 `tests/shortcut-model.test.ts` 增加以下矩阵：

```ts
it.each([
  [{ contentTreeEnabled: true, newTabBehavior: "root" }, true],
  [{ contentTreeEnabled: false, newTabBehavior: "child" }, false],
  [{ newTabBehavior: "child" }, true],
  [{ newTabBehavior: "root" }, false],
  [{}, false],
  [{ newTabBehavior: "unknown" }, false],
])("migrates content tree settings", (extra, expected) => {
  const result = validateShortcutSettings({
    enabled: true,
    tabTitleFontSize: 14,
    items: [],
    ...extra,
  });

  expect(result).toMatchObject({
    ok: true,
    value: { contentTreeEnabled: expected },
  });
});
```

在 `tests/shortcut-store.test.ts` 增加断言：旧 `child` 读取为开启、旧 `root` 读取为关闭、新字段优先；保存结果包含 `contentTreeEnabled` 且不包含 `newTabBehavior`。

- [ ] **Step 2：运行测试确认 RED**

Run:

```powershell
npx vitest run tests/shortcut-model.test.ts tests/shortcut-store.test.ts
```

Expected: FAIL，失败点集中在缺少 `contentTreeEnabled`、默认值仍为 child，以及保存仍写旧字段。

- [ ] **Step 3：最小实现新字段和迁移规则**

在 `shortcut-model.ts` 将设置契约改为：

```ts
export interface ShortcutSettings {
  enabled: boolean;
  tabTitleFontSize: number;
  contentTreeEnabled: boolean;
  items: ShortcutItem[];
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  enabled: true,
  tabTitleFontSize: 14,
  contentTreeEnabled: false,
  items: [],
};

function readContentTreeEnabled(input: Record<string, unknown>): boolean {
  if (typeof input.contentTreeEnabled === "boolean") {
    return input.contentTreeEnabled;
  }
  if (input.newTabBehavior === "child") return true;
  if (input.newTabBehavior === "root") return false;
  return false;
}
```

验证器不再把非法或缺失旧字段判为整个设置无效；其他现有字段仍按原规则校验。`shortcut-store.ts` 的规范化保存对象只写：

```ts
{
  enabled: settings.enabled,
  tabTitleFontSize: settings.tabTitleFontSize,
  contentTreeEnabled: settings.contentTreeEnabled,
  items: settings.items,
}
```

- [ ] **Step 4：运行 GREEN 和类型检查**

```powershell
npx vitest run tests/shortcut-model.test.ts tests/shortcut-store.test.ts
npm run typecheck
git diff --check -- src/sidepanel/shortcut-model.ts src/sidepanel/shortcut-store.ts tests/shortcut-model.test.ts tests/shortcut-store.test.ts
```

Expected: 两个测试文件通过；类型检查只允许出现后续任务尚未迁移的旧字段调用点，不允许本任务文件出现错误；diff check 通过。

## Task 2：把设置界面改为单一内容树开关

**Files:**

- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/shortcut-renderer.ts`
- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidepanel-markup.test.ts`
- Modify: `tests/shortcut-renderer.test.ts`
- Modify: `tests/sidebar.test.ts`

- [ ] **Step 1：写界面与行为失败测试**

覆盖以下契约：

- 设置标题显示“内容树”，旧的两个 radio 和“新 Tab 行为”文案不存在。
- 使用一个 checkbox，初始状态读取 `contentTreeEnabled`。
- 编辑、取消、重置、保存都使用 boolean，不丢失其他快捷网站设置。
- 新安装默认关闭，开启后新标签带当前活动标签 opener；关闭后新标签不带 opener。
- 从开启切到关闭继续推进现有 mode/session revision，并清理当前窗口折叠、脱离和手动父关系。

测试元素改成明确的单节点：

```ts
contentTreeEnabled: form.querySelector<HTMLInputElement>(
  "#content-tree-enabled",
)!;
```

- [ ] **Step 2：运行测试确认 RED**

```powershell
npx vitest run tests/sidepanel-markup.test.ts tests/shortcut-renderer.test.ts tests/sidebar.test.ts
```

Expected: FAIL，旧 radio、旧字段和默认 child 断言暴露出来。

- [ ] **Step 3：替换标记与渲染器接口**

`index.html` 使用现有设置行/开关样式，不新增自定义图形：

```html
<label class="settings-toggle" for="content-tree-enabled">
  <span>内容树</span>
  <input id="content-tree-enabled" type="checkbox">
</label>
```

将 `ShortcutRendererElements.newTabBehavior` 改为 `contentTreeEnabled: HTMLInputElement`。打开设置、同步草稿和重置时直接读写 `.checked`：

```ts
elements.contentTreeEnabled.checked = session.draft.contentTreeEnabled;
editorSession.draft.contentTreeEnabled = elements.contentTreeEnabled.checked;
```

- [ ] **Step 4：迁移侧边栏树开关调用点**

把所有运行期判断统一为：

```ts
const isTreeEnabled = (): boolean =>
  treeSessionReady && shortcutSettings.contentTreeEnabled;
```

需要设置已加载但 session 尚未水合的入口，继续使用现有 readiness 门禁，不用 boolean 绕过拖放/复制保护。保存处理改为比较 boolean；从 `true` 切到 `false` 时沿用现有关系清理事务和 generation/revision 保护。

- [ ] **Step 5：运行 GREEN**

```powershell
npx vitest run tests/sidepanel-markup.test.ts tests/shortcut-renderer.test.ts tests/sidebar.test.ts
npm run typecheck
git diff --check -- src/sidepanel/index.html src/sidepanel/shortcut-renderer.ts src/sidepanel/sidebar.ts tests/sidepanel-markup.test.ts tests/shortcut-renderer.test.ts tests/sidebar.test.ts
```

Expected: 测试和类型检查通过，生产代码中 `newTabBehavior` 只允许保留在 Task 1 的兼容读取路径。

## Task 3：建立统一分类器和纯分组规划器

**Files:**

- Create: `src/sidepanel/smart-group-model.ts`
- Create: `tests/smart-group-model.test.ts`
- Modify: `src/sidepanel/same-site-tab-model.ts`
- Modify: `tests/same-site-tab-model.test.ts`

- [ ] **Step 1：写分类器失败测试**

测试固定标签和不支持协议返回 `undefined`，并精确覆盖：

```ts
expect(classifySmartGroupTab(tab("https://www.example.com/a"))).toEqual({
  key: "site:www.example.com",
  title: "www.example.com",
  kind: "site",
});
expect(classifySmartGroupTab(tab("file:///C:/a.txt"))).toMatchObject({
  key: "special:file",
  title: "本地文件",
});
expect(classifySmartGroupTab(tab("chrome://settings/privacy"))).toMatchObject({
  key: "special:chrome-settings",
  title: "Chrome 设置",
});
expect(classifySmartGroupTab(tab("chrome://extensions"))).toMatchObject({
  key: "special:chrome",
  title: "Chrome 页面",
});
```

- [ ] **Step 2：写同网站快速分组规划失败测试**

覆盖：

- 从右键目标分类收集所有非固定同类标签，包括其他分组中的成员。
- 匹配组按同类成员数量降序、最早成员位置升序选择，不看标题。
- 复用组时只输出不在目标组中的 tab ID；零变化返回 `undefined`。
- 无匹配组时单标签也输出 create；颜色避开当前窗口已用颜色。
- `file://`、Chrome 设置和其他 `chrome://` 各自独立。

- [ ] **Step 3：写一键分组规划失败测试**

覆盖：

- 只移动未固定、未分组、受支持标签；已有组成员只用于选择复用目标。
- 普通网站候选 >1 创建 hostname 组，=1 汇入 Other。
- 三种特殊分类即使一项也创建各自组，不进入 Other。
- 有匹配组时优先 reuse；有效 `otherGroupId` 才复用系统 Other。
- 新建多个组的颜色在同一计划内继续占用，避免重复。
- 操作顺序按候选最早 tab index 稳定排列；总复杂度保持 O(n + g)。

- [ ] **Step 4：运行测试确认 RED**

```powershell
npx vitest run tests/smart-group-model.test.ts tests/same-site-tab-model.test.ts
```

Expected: 新模块不存在或导出缺失，所有新规划测试失败。

- [ ] **Step 5：实现纯模型接口**

公开最小接口：

```ts
export type SmartGroupCategory = Readonly<{
  key: string;
  title: string;
  kind: "site" | "special";
}>;

export type SmartGroupOperation =
  | Readonly<{ kind: "reuse"; groupId: number; tabIds: readonly number[] }>
  | Readonly<{
      kind: "create";
      title: string;
      color: TabGroupColor;
      tabIds: readonly number[];
      role?: "other";
    }>;

export type SmartGroupPlan = Readonly<{
  windowId: number;
  operations: readonly SmartGroupOperation[];
}>;

export function classifySmartGroupTab(tab: TabViewModel): SmartGroupCategory | undefined;
export function createQuickGroupPlan(
  tabs: readonly TabViewModel[],
  groups: readonly chrome.tabGroups.TabGroup[],
  tabId: number,
): SmartGroupPlan | undefined;
export function createOneClickGroupPlan(
  tabs: readonly TabViewModel[],
  groups: readonly chrome.tabGroups.TabGroup[],
  otherGroupId?: number,
): SmartGroupPlan | undefined;
```

实现时单次排序/扫描建立 category、group membership、earliest index 和 used colors 索引；不要在分类循环中再次扫描全部 tabs/groups。复用 `TabGroupColor` 和现有稳定选色序列。

`same-site-tab-model.ts` 只保留“关闭其他同网站标签”所需 hostname/目标计算，删除已经由新规划器替代的 `createSameSiteGroupPlan` 与分组可用性字段，避免两套规则漂移。

- [ ] **Step 6：运行 GREEN 与 500 标签线性回归**

```powershell
npx vitest run tests/smart-group-model.test.ts tests/same-site-tab-model.test.ts
npm run typecheck
git diff --check -- src/sidepanel/smart-group-model.ts src/sidepanel/same-site-tab-model.ts tests/smart-group-model.test.ts tests/same-site-tab-model.test.ts
```

Expected: 全部通过；500 标签测试不调用 Chrome API，不依赖 DOM，不出现逐分类全表扫描的可观察次数增长。

## Task 4：保存按窗口的 Other 分组角色

**Files:**

- Create: `src/sidepanel/smart-group-session-store.ts`
- Create: `tests/smart-group-session-store.test.ts`

- [ ] **Step 1：写 session store 失败测试**

参考 `tab-tree-session-store` 的 fake storage，覆盖：

- key 按 window ID 隔离。
- 缺失/非法数据和读取失败降级为无角色。
- save 串行，较早慢写不会覆盖较新写入。
- clear 只清当前窗口角色。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run tests/smart-group-session-store.test.ts
```

Expected: FAIL，新模块不存在。

- [ ] **Step 3：实现窄接口**

```ts
export interface SmartGroupSessionState {
  otherGroupId?: number;
}

export interface SmartGroupSessionStore {
  load(windowId: number): Promise<SmartGroupSessionState>;
  saveOtherGroup(windowId: number, groupId: number): Promise<void>;
  clearOtherGroup(windowId: number): Promise<void>;
}
```

只接受正整数 group ID；使用 `storage.session` 和 window-scoped key，写队列沿用树 session store 的串行模式。该 store 不判断 group 是否仍存在，启动和事件处理由 Sidebar 用最新 `tabGroupStore` 校验。

- [ ] **Step 4：运行 GREEN**

```powershell
npx vitest run tests/smart-group-session-store.test.ts
npm run typecheck
git diff --check -- src/sidepanel/smart-group-session-store.ts tests/smart-group-session-store.test.ts
```

Expected: PASS。

## Task 5：实现顺序分组执行器和部分失败语义

**Files:**

- Create: `src/sidepanel/smart-group-actions.ts`
- Create: `tests/smart-group-actions.test.ts`
- Modify: `src/sidepanel/tab-group-actions.ts`
- Modify: `tests/tab-group-actions.test.ts`

- [ ] **Step 1：写执行器失败测试**

覆盖精确 API 调用：

```ts
// reuse
expect(tabs.group).toHaveBeenCalledWith({ tabIds: [2, 3], groupId: 9 });

// create
expect(tabs.group).toHaveBeenCalledWith({ tabIds: [4, 5] });
expect(tabGroups.update).toHaveBeenCalledWith(12, {
  title: "example.com",
  color: "blue",
});
```

并覆盖：空 `tabIds` 不执行；每步前 validate 返回 false 时停止；第二步失败不执行第三步；错误包含 completed count/partial 标志；Other 组只在 create 与 metadata update 成功后调用角色写入回调；角色写失败报告 partial，不回滚 Chrome 分组。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run tests/smart-group-actions.test.ts tests/tab-group-actions.test.ts
```

Expected: FAIL，新执行器不存在。

- [ ] **Step 3：实现顺序执行器**

```ts
export async function executeSmartGroupPlan(
  plan: SmartGroupPlan,
  deps: {
    tabs: Pick<typeof chrome.tabs, "group">;
    tabGroups: Pick<typeof chrome.tabGroups, "update">;
    validate(operation: SmartGroupOperation): boolean;
    onOtherGroupCreated(groupId: number): Promise<void>;
  },
): Promise<void>;
```

用普通 `for...of` 顺序 await，不使用 `Promise.all`。抽取或复用 `tab-group-actions.ts` 现有 metadata 更新和 group ID 校验，不保留两套错误规则。执行器只消费计划，不重新分类。

- [ ] **Step 4：运行 GREEN**

```powershell
npx vitest run tests/smart-group-actions.test.ts tests/tab-group-actions.test.ts
npm run typecheck
git diff --check -- src/sidepanel/smart-group-actions.ts src/sidepanel/tab-group-actions.ts tests/smart-group-actions.test.ts tests/tab-group-actions.test.ts
```

Expected: PASS。

## Task 6：更新右键菜单名称、命令与分区

**Files:**

- Modify: `src/sidepanel/tab-context-menu.ts`
- Modify: `tests/tab-context-menu.test.ts`

- [ ] **Step 1：写菜单失败测试**

断言分组区域顺序精确为：

```ts
[
  "添加到分组",
  "从分组中移除",
  "同网站快速分组",
  "一键分组",
]
```

新增命令：

```ts
| { action: "group-all"; tabId: number }
```

Context 新增 `canGroupAll`，并把现有 `canGroupSameSite` 命名同步为 `canQuickGroupSameSite`。测试鼠标、Enter、空格触发，方向键跳过禁用项/分隔线，Escape 和子菜单返回行为不回归。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run tests/tab-context-menu.test.ts
```

Expected: FAIL，旧标签仍为“快速分组”且缺少 group-all。

- [ ] **Step 3：最小实现菜单项**

保留现有 data action `group-same-site` 以减少无意义协议迁移，但可见文本改为“同网站快速分组”；新增 `group-all`。两项 disabled 分别由 context plan availability 决定，执行中由 Sidebar 传入的共享 busy 状态统一禁用。

- [ ] **Step 4：运行 GREEN**

```powershell
npx vitest run tests/tab-context-menu.test.ts
npm run typecheck
git diff --check -- src/sidepanel/tab-context-menu.ts tests/tab-context-menu.test.ts
```

Expected: PASS。

## Task 7：接入 Sidebar 最新快照、忙碌门禁和重同步

**Files:**

- Modify: `src/sidepanel/sidebar.ts`
- Modify: `tests/sidebar.test.ts`
- Modify: `src/sidepanel/tab-group-events.ts`
- Modify: `tests/tab-group-events.test.ts`

- [ ] **Step 1：写同网站快速分组集成失败测试**

覆盖：

- 菜单打开时基于内存快照决定可用性，分组快照未就绪时禁用。
- 点击时重新规划，已有匹配组直接调用 `tabs.group({ groupId, tabIds })`，不调用 `tabGroups.update`。
- 候选包括其他组内同类标签，固定标签始终排除。
- 无匹配组时单标签也创建；特殊分类标题正确。
- 没有状态变化时禁用且不调用 Chrome API。

- [ ] **Step 2：写一键分组集成失败测试**

至少覆盖：

- 两个同 hostname 标签创建 hostname 组。
- 两个不同 hostname 单例合并到 Other。
- file/settings/chrome 各建独立组，不进入 Other。
- 已分组成员不移动但可让未分组同类标签复用其组。
- 有效 Other session role 被复用；同名用户组不会被误用。
- fixed、unsupported 和已有组内非候选不会传入 group API。
- 批次颜色不重复；执行顺序与规划一致。

- [ ] **Step 3：写并发和失败失败测试**

覆盖：

- 任一智能分组执行中，“同网站快速分组”和“一键分组”同时禁用，重复点击不提交。
- 执行前 tab 被固定、关闭、换窗口或组状态不再满足时停止后续操作。
- 中途失败保留已成功 Chrome 结果，只触发一次 tabs/groups 合并重同步。
- Other role 保存失败提示部分失败并重同步，不回滚组。
- group removed 事件清除匹配的 Other role；无关 group removed 不清除。
- cleanup 后迟到 Promise 不更新已销毁 UI。

- [ ] **Step 4：运行 RED**

```powershell
npx vitest run tests/sidebar.test.ts tests/tab-group-events.test.ts
```

Expected: 新命令、role hydration、共享 busy 和执行器接线相关测试失败。

- [ ] **Step 5：接入角色水合和事件清理**

当前窗口 ID 获取后创建/加载 `SmartGroupSessionStore`。在一键规划前按以下条件校验 role：

```ts
const validOtherGroupId =
  otherGroupId !== undefined &&
  tabGroupStore.get(otherGroupId)?.windowId === currentWindowId
    ? otherGroupId
    : undefined;
```

无效时异步清除该 window role。扩展 `tab-group-events` removed 回调携带 group ID，让 Sidebar 在目标 ID 被移除时清 role；不要靠标题识别。

- [ ] **Step 6：接入菜单 context 和命令处理**

菜单打开时只运行纯规划器：

```ts
const quickPlan = createQuickGroupPlan(tabs, groups, tab.id);
const allPlan = createOneClickGroupPlan(tabs, groups, validOtherGroupId);
```

命令触发时必须再次从 `tabStore.list()` 和 `tabGroupStore.list()` 规划，不能执行打开菜单时的旧 plan。一个 `smartGroupingBusy` 同时门禁两个命令；执行器的 validate 每一步用最新 store 检查 window、pinned、group membership 和目标组存在性。

- [ ] **Step 7：统一成功、失败和重同步路径**

正常路径依赖 Chrome tab/group events 更新 UI。任何部分失败只调用一次现有合并 resync helper；不要在循环中逐次 query。错误信息区分“同网站快速分组失败”和“一键分组部分失败”，并保持现有 busy 恢复及 cleanup generation 保护。

- [ ] **Step 8：运行 GREEN**

```powershell
npx vitest run tests/sidebar.test.ts tests/tab-group-events.test.ts tests/smart-group-model.test.ts tests/smart-group-actions.test.ts tests/smart-group-session-store.test.ts tests/tab-context-menu.test.ts
npm run typecheck
git diff --check -- src/sidepanel/sidebar.ts src/sidepanel/tab-group-events.ts tests/sidebar.test.ts tests/tab-group-events.test.ts
```

Expected: 全部通过；没有新增逐标签 Chrome 查询、轮询或权限。

## Task 8：清理旧术语、补文档并做完整验证

**Files:**

- Modify: `README.md`（若存在对应设置/菜单说明）
- Modify: `docs/store-listing-checklist.md`（若存在对应验收项）
- Modify: `docs/superpowers/specs/2026-08-11-content-tree-and-smart-grouping-design.md`（仅在实现细节需要校正时）
- Verify: `manifest.json`
- Verify: `package.json`
- Verify: `update.log`

- [ ] **Step 1：扫描旧字段和旧文案**

```powershell
rg -n "新 Tab 行为|快速分组|newTabBehavior|canGroupSameSite|createSameSiteGroupPlan" src tests README.md docs
```

Expected:

- 当前生产 UI 和新测试只使用“内容树”“同网站快速分组”“一键分组”。
- `newTabBehavior` 只保留在兼容迁移代码与明确的 migration fixtures。
- 历史设计/实施文档允许保留当时术语，不进行批量改写。

- [ ] **Step 2：更新当前用户文档和商店验收清单**

中文说明明确：内容树默认关闭；同网站快速分组会复用匹配组；一键分组的普通单例进入 Other；file/Chrome 设置/Chrome 页面各自成组；固定标签不参加。

- [ ] **Step 3：运行完整质量门禁**

```powershell
npm run check
npm run benchmark:tabs
git diff --check
git status --short
```

Expected:

- `typecheck`、全部 Vitest、build 和 dist 检查通过。
- benchmark 无明显渲染回退；智能分组规划的 500 标签专项测试保持线性。
- diff check 无空白错误。
- status 仅包含本功能文件和用户原有差异，没有构建产物或意外文件。

- [ ] **Step 4：确认本轮不打包**

验证 `package.json`、manifest 版本和 `update.log` 未因本计划执行被修改。只有用户明确要求“打包”时，另行执行：敏感信息扫描、版本号升级、`update.log` 记录、`npm run package`、ZIP 内容检查与浏览器安装验收。

## 最终验收矩阵

- [ ] 新安装内容树关闭；旧 child 用户开启；旧 root 用户关闭；新字段覆盖旧字段。
- [ ] 设置 UI 只有一个“内容树”开关，关闭会清理当前窗口树会话关系。
- [ ] 菜单显示“同网站快速分组”，且在“一键分组”之前。
- [ ] 同网站快速分组按实际成员复用最优分组，可移动其他组中的同类非固定标签。
- [ ] 一键分组只移动未分组候选；网站多例独立成组、普通网站单例进入 Other。
- [ ] `file://`、Chrome 设置和其他 `chrome://` 分别成组，即使各只有一个标签。
- [ ] 固定标签和不支持协议始终不参加两种分组。
- [ ] Other 只按当前窗口 session role 复用，不误认用户同名分组。
- [ ] 新组颜色在当前窗口及本批次内优先避重。
- [ ] 中途失败停止后续操作、保留已成功结果、只重同步一次。
- [ ] 500 标签规划保持 O(n + g)，无逐标签 Chrome API 查询或 DOM 扫描。
