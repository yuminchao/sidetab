# SideTab Lite

SideTab Lite 是一个 Chrome 侧边栏标签页管理扩展。它支持搜索、切换、关闭和固定当前窗口的标签页，并提供可选的快捷网站入口。快捷入口默认关闭，设置保存在 Chrome 本地存储中。

## 安装到 Chrome

1. 运行 `npm install` 和 `npm run package`，生成 `dist/`。
2. 打开 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目的 `dist` 目录。
5. 点击工具栏中的 SideTab Lite 图标打开侧边栏。

`release/sidetab-lite-0.1.0.zip` 用于上传 Chrome Web Store 或传递构建产物。Chrome 通常不能直接双击 ZIP 安装扩展；本地测试请加载已解压的 `dist` 目录。

## 开发与打包

需要 Node.js 20.11 或更高版本。项目锁定 Vite 6.4.3，请使用仓库中的 `package-lock.json` 安装一致的依赖版本。

```powershell
npm install
npm test -- --run
npm run package
```

`npm run package` 会依次执行类型检查、测试、构建和发布检查，再按固定文件顺序与时间戳生成并自验 ZIP。重复打包会覆盖目标 ZIP，但不会删除 `release/` 中的其他文件。`npm run generate:icons` 可重新生成仓库中的图标资源；发布产物只包含四个扩展 PNG 图标和固定按钮使用的 SVG，不包含兼容保留的快捷网站 PNG。

## 使用说明

设置中的“标签标题字号”范围为 12 至 18 像素，默认值为 14 像素。快捷入口最多可配置 12 项。

标签页图标优先使用 Chrome 为该标签页提供的 `favIconUrl`。快捷入口优先使用当前窗口内同源标签页的 `favIconUrl`；没有可用图标时，再尝试对应 HTTP/HTTPS 站点的 `origin/favicon.ico`，失败后显示名称首字符。

## 隐私与权限

扩展只申请 `sidePanel`、`tabs` 和 `storage` 权限，不申请主机权限，也不注入 content script。它不收集、不出售，也不向开发者服务传输用户数据。

图标只通过页面中的图片元素显示。浏览器可能使用已有缓存，也可能为 Chrome 提供的 HTTP/HTTPS `favIconUrl` 发出图片请求；必要时，浏览器还可能请求 HTTP/HTTPS 站点的 `origin/favicon.ico`。这些请求会直接到达相应站点，并可能向站点暴露常规请求信息。

扩展不使用 `fetch`、`XMLHttpRequest` 或第三方 favicon 服务，不通过脚本建立网络连接，也不加载远程代码。扩展页面 CSP 保持 `connect-src 'none'` 和 `frame-src 'none'`，脚本与样式只允许扩展自身；仅图片来源允许扩展自身、`data:`、`http:` 和 `https:`。用户点击快捷入口后，Chrome 才会打开对应网站。
