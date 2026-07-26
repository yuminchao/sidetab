# Chrome Web Store 发布检查清单

## 安装与基础界面

- [ ] 在 `chrome://extensions` 开启开发者模式并加载 `dist`。
- [ ] 扩展图标在 16、32、48、128 像素场景显示清晰。
- [ ] 点击工具栏图标可以打开侧边栏。
- [ ] 快捷入口默认关闭，关闭时不占用空白区域。
- [ ] 开启快捷入口后，默认 OpenAI、Google、GitHub 入口可见且可打开。

## 标签页与快捷入口

- [ ] 标签页搜索、切换、关闭、固定状态显示正常。
- [ ] 快捷入口支持新增、编辑、删除、排序、重置并持久化。
- [ ] 快捷入口最多 12 项；添加第 13 项时操作被阻止并显示错误。
- [ ] “标签标题字号”可设置为 12 至 18 像素，默认值为 14 像素。
- [ ] 分别验证 1、50、500 个标签页及创建、更新、移动、关闭事件。
- [ ] 搜索对标题和域名生效，清空后恢复完整列表。
- [ ] 无效网址、保存失败、打开失败等错误有明确反馈。

## 隐私、安全与权限

- [ ] 标签页图标优先使用 Chrome 提供的 `favIconUrl`。
- [ ] 快捷入口优先使用当前窗口内同源标签页的 `favIconUrl`；没有可用图标时尝试站点的 `origin/favicon.ico`，加载失败后显示名称首字符。
- [ ] DevTools Network 记录符合披露：浏览器可能读取缓存，也可能请求 HTTP/HTTPS `favIconUrl`；必要时还可能请求 HTTP/HTTPS 站点的 `origin/favicon.ico`。
- [ ] 确认扩展没有使用 `fetch`、`XMLHttpRequest` 或第三方 favicon 服务，没有脚本网络连接，也没有远程代码。
- [ ] 权限精确为 `sidePanel`、`tabs`、`storage`，没有 host permission 和 content script。
- [ ] CSP 精确为 `script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'`。
- [ ] 商店隐私声明明确说明：扩展不收集、不出售或向开发者服务传输用户数据；浏览器加载 favicon 时可能直接向对应站点发送图片请求。
- [ ] 权限理由分别说明：侧边栏展示、当前窗口标签管理、本地保存快捷入口和字号设置。

## 兼容与视觉

- [ ] Chrome 114 或更高版本可以加载扩展。
- [ ] 浅色、深色系统主题下均可辨识。
- [ ] 在 240、300、440、560 像素侧边栏宽度下检查布局、对话框和长文本。

## 构建产物

- [ ] `npm run package` 完整通过。
- [ ] `dist` 和 ZIP 精确包含 11 个审核文件，不包含 `assets/shortcuts/openai.png`、`google.png`、`github.png`。
- [ ] ZIP 根目录直接包含 `manifest.json`，不包含 `dist/` 顶层目录。
- [ ] ZIP 不包含源码、source map、测试、项目文档或 `node_modules`。
- [ ] 在全新目录解压 ZIP 后重新执行一次“加载已解压”检查。

## 实际结果

- 测试 Chrome 版本：待填写
- 测试操作系统：待填写
- 测试日期：待填写
- 测试人员：待填写
- 结果与遗留问题：待填写
