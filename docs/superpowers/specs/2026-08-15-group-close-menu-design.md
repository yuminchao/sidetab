# 分组右键菜单新增“关闭分组”设计

日期：2026-08-15

## 目标

在分组标题行右键菜单中，于“解散分组”下方新增“关闭分组”菜单项：一次批量关闭该分组内的全部标签页。分组内没有标签时菜单项禁用。

## 现状

分组右键菜单（`tab-group-context-menu.ts`）当前包含四个主命令：

1. 在分组中新建标签页（new-tab）
2. 重命名分组（rename）
3. 修改颜色（set-color，二级菜单）
4. 解散分组（dissolve）

菜单项顺序固定为 `new-tab → rename → set-color → 分隔线 → dissolve`，主命令由 `dispatchMainCommand` 分派，键盘导航、busy 禁用、外部关闭语义对全部菜单项一致。

“解散分组”在 sidebar.ts 中通过 `executeGroupCommand` 执行：取组内全部标签 ID，调用 `groupActions.dissolve(tabIds)`（`chrome.tabs.ungroup`）。组内无标签时直接返回（不执行），但菜单项本身不禁用。

## 设计

### 菜单项

- 在“解散分组”下方新增“关闭分组”菜单项，action 为 `close`。
- 菜单顺序变为：`new-tab → rename → set-color → 分隔线 → dissolve → close`。
- 菜单项文案：“关闭分组”。

### 关闭语义

- “关闭分组”关闭**组内全部标签页**（包括普通标签；分组内不存在固定标签，固定标签位于 Chrome 固定区域且不属于原生标签组）。
- 实现：取组内全部标签 ID，调用 `chrome.tabs.remove(tabIds)` 单次批量关闭。
- 关闭后分组随最后一个成员消失而被 Chrome 自动移除，扩展不额外调用解散。

### 空组禁用

- 分组内没有标签时，“关闭分组”菜单项禁用（与 busy 禁用同等处理，但由调用方提供状态）。
- 复用一个新增回调 `canCloseGroup(groupId): boolean` 或 `hasMembers`；菜单打开时设置 `close.disabled`。

### 命令类型与执行

`TabGroupContextCommand` 增加：

```ts
| { action: "close"; groupId: number }
```

sidebar.ts 的 `onCommand` 增加 `close` 分支：复用 `executeGroupCommand` 忙碌门禁，取组内标签 ID，调用新增的 `groupActions.close(tabIds)`（`chrome.tabs.remove`），失败时沿用现有错误提示与一次重同步。

### 并发与错误

- 与“解散分组”一致：命令执行期间分组进入 `groupCommandBusy`，菜单项统一禁用，防止重复提交。
- Chrome 删除失败时显示现有稳定错误消息并触发一次完整重同步，保留真实 Chrome 状态。

## 非目标

- 不新增权限（`tabs.remove` 已在 `tabs` 权限内）。
- 不改变“解散分组”语义（保留标签、仅取消分组关系）。
- 不新增确认对话框；单次批量关闭与现有“关闭下方标签页”交互一致。
- 不升级版本、不修改发布说明。

## 测试设计

### 菜单层（tab-group-context-menu.test.ts）

- 菜单打开时按顺序包含 `dissolve → close` 两个相邻菜单项，文案“关闭分组”。
- 点击 `close` 分派 `{ action: "close", groupId }` 并关闭菜单。
- 组内无标签（`canCloseGroup` 返回 false）时 `close` 菜单项禁用，点击不触发命令。
- 组 busy 时 `close` 与其他菜单项一起禁用。

### Sidebar 集成（sidebar.test.ts）

- 右键分组点击“关闭分组”：调用 `tabs.remove` 一次，传入组内全部标签 ID。
- 组内无标签时菜单项禁用。
- 关闭失败时显示错误消息并触发一次重同步。
- 执行期间 busy 门禁阻止重复提交。

### 操作层（tab-group-actions.test.ts）

- `groupActions.close(tabIds)` 调用 `chrome.tabs.remove` 一次；空数组直接返回；失败抛“无法关闭标签组”错误。
