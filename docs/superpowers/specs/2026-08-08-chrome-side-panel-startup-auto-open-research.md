# Chrome 扩展侧边栏启动自动打开调研

日期：2026-08-08

## 结论

Chrome 扩展**不能可靠地在浏览器重新打开或配置文件启动时，自动打开原生 Side Panel**。

`chrome.runtime.onStartup` 会在安装了该扩展的配置文件首次启动时触发，但它不是用户操作。`chrome.sidePanel.open()` 从 Chrome 116 引入至当前 Chromium HEAD 仍要求调用发生在用户操作之后；缺少用户手势时，Chromium 会直接返回错误。因此不能实现 `runtime.onStartup -> sidePanel.open()`。

Chrome 官方也没有承诺在会话恢复时恢复扩展 Side Panel 的“已打开、当前选中扩展”状态。即使某个 Chrome 版本、退出方式或平台偶尔表现为保留状态，也不能将其作为扩展的稳定能力。

## API 限制

### `sidePanel.open()` 必须由用户操作触发

Chrome Side Panel API 文档明确说明，`sidePanel.open()` 只能响应用户操作调用。官方列出的有效入口包括：

- 点击扩展 action 图标；
- 键盘快捷键；
- 上下文菜单；
- 用户在扩展页面或 content script 页面元素上的操作。

来源：[Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

Chromium 当前实现仍在 `SidePanelOpenFunction::RunFunction()` 中检查 `user_gesture()`。检查失败时返回：

```text
`sidePanel.open()` may only be called in response to a user gesture.
```

来源：[Chromium `side_panel_api.cc`](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/extensions/api/side_panel/side_panel_api.cc)

### `runtime.onStartup` 不提供用户手势

`runtime.onStartup` 只表示安装该扩展的配置文件首次启动。官方文档没有赋予该事件用户手势，并特别说明启动隐身配置文件不会触发该事件。

因此下面的调用不能用于启动自动打开：

```js
chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});
```

该调用会因缺少用户手势而失败，而不是在窗口创建后自动显示侧边栏。

来源：[Chrome Runtime API：`onStartup`](https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onStartup)

## 会话恢复边界

Chrome 的公开扩展 API 没有“下次启动自动显示 Side Panel”或“恢复 Side Panel 可见状态”的配置项：

- Manifest 的 `side_panel.default_path` 只注册默认页面；
- `sidePanel.setOptions()` 只配置 `path`、`enabled` 和可选的 `tabId`；
- `sidePanel.setPanelBehavior()` 只能配置用户点击 action 图标时是否打开侧边栏；
- `sidePanel.open()` 仍受用户手势限制。

Chromium 当前注册的通用 Side Panel 配置包括侧栏左右位置、Google Search Side Panel 开关、各面板宽度和对齐覆盖，没有扩展 Side Panel 的“窗口启动时打开”持久化项。当前条目的 `active_entry`、`last_active_entry` 由每个浏览器窗口或标签页的 Side Panel registry 在运行期维护。

因此可以推断：Chrome 的普通标签页会话恢复并不构成扩展 Side Panel 自动恢复的 API 契约。扩展不应依赖观察到的偶发恢复行为。

来源：

- [Chromium Side Panel prefs](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/ui/side_panel/side_panel_prefs.cc)
- [Chromium Side Panel registry](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/ui/side_panel/side_panel_registry.h)
- [Chromium Side Panel coordinator](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/ui/views/side_panel/side_panel_coordinator.h)

## 策略与版本差异

Chrome Enterprise 的 `RestoreOnStartup` 策略控制启动时恢复浏览器窗口和标签页或打开指定 URL，不提供扩展 Side Panel 自动打开能力，也不能绕过 `sidePanel.open()` 的用户手势检查。

来源：[Chrome Enterprise `RestoreOnStartup`](https://chromeenterprise.google/policies/restore-on-startup/)

主要版本变化如下：

| Chrome 版本 | Side Panel API 变化 | 对启动自动打开的影响 |
| --- | --- | --- |
| 116 | 增加 `sidePanel.open()` | 从引入起即要求用户操作 |
| 140 | 增加布局相关能力 | 没有启动自动打开能力 |
| 141 | 增加 `close()`、`onOpened` 等能力 | 可以记录打开事件，但不能在启动时无手势打开 |
| 142 | 增加 `onClosed` | 可以记录关闭事件，但不能绕过用户手势限制 |

截至当前 Chromium HEAD，没有启动事件豁免、企业策略豁免或 `autoOpenOnStartup` 一类配置。

## 推荐实现

可实现的最接近方案是把启动后的操作压缩为一次用户点击：

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
```

用户重新打开 Chrome 后点击扩展 action 图标，即可打开 Side Panel。还可以提供键盘快捷键或上下文菜单作为用户触发入口。

如果需要记住用户偏好，可用 `sidePanel.onOpened` 和 `sidePanel.onClosed`（分别要求 Chrome 141+、142+）记录“用户上次是否保持打开”，但启动后只能据此展示提示或更新 action 状态，仍不能直接调用 `sidePanel.open()`。

## 最终建议

不要实现 `onStartup -> sidePanel.open()`，该方案违反当前 API 的用户手势前置条件。产品交互应设计为“浏览器启动后用户点击一次扩展图标打开”，并配置 `openPanelOnActionClick: true`。
