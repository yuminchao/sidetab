# Chrome 扩展侧边栏宽度 API 调研

调研日期：2026-08-08

## 结论

截至调研日期，Chrome 扩展仍然不能通过 `chrome.sidePanel` API 或 Manifest V3 的 `side_panel` 配置设置侧边栏宽度、最小宽度或最大宽度。

扩展只能让用户拖动 Chrome 提供的分隔线调整宽度，并让扩展页面通过响应式布局适应浏览器最终分配的空间。页面自身的 CSS `width`、`min-width` 或 `max-width` 只能影响扩展页面内容，不能改变 Chrome 浏览器外层侧边栏容器的尺寸约束。

## 证据

### `PanelOptions` 没有宽度配置

Chrome 官方 API 参考页当前列出的 `PanelOptions` 属性只有：

- `tabId`
- `path`
- `enabled`

`setOptions()` 只接收这个 `PanelOptions` 类型，因此不存在可传入的 `width`、`minWidth` 或 `maxWidth`。该参考页标注最后更新于 2026-01-19。

来源：[Chrome for Developers：chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

Chromium `main` 分支中的接口定义与文档一致：`PanelOptions` 只有 `tabId`、`path`、`enabled` 三个字段。

来源：[Chromium 源码：side_panel.idl](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/side_panel.idl)

### Manifest 的 `side_panel` 也没有宽度配置

同一份 Chromium IDL 把 Manifest 的 `side_panel` 定义为 `SidePanel` 字典，该字典只有必填的 `default_path`。官方文档给出的 Manifest 示例同样只有：

```json
{
  "side_panel": {
    "default_path": "sidepanel.html"
  }
}
```

因此不能在 `manifest.json` 中增加受支持的宽度或最小宽度字段。

来源：[Chromium 源码：side_panel.idl](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/side_panel.idl)、[Chrome for Developers：chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

### 最小宽度由 Chrome UI 控制

Chromium 当前源码将 `SidePanelEntry::kSidePanelDefaultContentWidth` 定义为 `360`，注释明确说明它是默认且可接受的最小侧边栏内容宽度。

`SidePanel::GetMinimumSize()` 使用该常量加上浏览器边框宽度计算侧边栏容器的最小宽度；用户拖动调整尺寸时，`SidePanel::OnResize()` 又通过 `std::max(proposed_width, minimum_width)` 执行下限裁剪。这些都位于浏览器 UI 实现中，不受扩展页面控制。

这里的 `360` 是内容区域的 Chrome UI 单位（DIP），不是扩展可配置参数；外层侧边栏还会包含 Chrome 自己的边框/间距，因此实际占用宽度会更大。

来源：[Chromium 源码：side_panel_entry.h](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/side_panel/side_panel_entry.h)、[Chromium 源码：side_panel.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/views/side_panel/side_panel.cc)

## 近期版本变化核对

官方参考页已经收录了近期新增能力，例如：

- Chrome 140：`getLayout()` 和 `PanelLayout`
- Chrome 141：`close()`、`onOpened`
- Chrome 142：`onClosed`
- Chrome 145：`close()` 的部分行为调整

这些变化涉及侧边栏所在方向、打开/关闭及事件通知，没有增加尺寸控制。Chromium 当前 `main` 的 `PanelOptions` 与 Manifest 定义也再次确认：宽度配置尚未进入公开接口。

Chrome 扩展团队在 Chromium Extensions 官方讨论区曾明确把尺寸控制称为仍在讨论的功能请求；2024 年的后续答复提到正在为“让用户更好控制尺寸”铺垫，但未承诺给扩展提供尺寸 API。当前正式文档和源码表明该功能截至本次调研仍未落地。

来源：[Chrome 131 行为变更公告](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/uqdhvMxJ6RM)、[侧边栏最小宽度讨论](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/xuk4ZuWTsBk)、[程序化控制宽度讨论](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/UcHL2GmjHiI)

## 对本项目的建议

继续使用 Chrome 原生侧边栏时，不应实现或声明“可设置最小宽度”。建议：

- 在较窄视口下保持页面可用，避免固定宽度布局。
- 用 CSS 容器查询或媒体查询压缩文字、间距和次要控件。
- 如业务必须精确控制窗口宽度，改用 `chrome.windows.create({ type: "popup", width: ... })` 等独立窗口方案，但这会失去原生侧边栏的停靠和持续显示体验。

