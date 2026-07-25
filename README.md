# SideTab Lite

SideTab Lite 是一个 Chrome 侧边栏标签页管理扩展。它支持搜索、切换和关闭当前窗口的标签页，并提供可选的本地快捷网站入口。快捷入口默认关闭，设置保存在 Chrome 本地存储中。

## 安装到 Chrome

1. 运行 `npm install` 和 `npm run package`，生成 `dist/`。
2. 打开 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目的 `dist` 目录。
5. 点击工具栏中的 SideTab Lite 图标打开侧边栏。

`release/sidetab-lite-0.1.0.zip` 用于上传 Chrome Web Store 或传输构建产物。Chrome 通常不能直接双击 ZIP 安装扩展；本地测试请加载已解压的 `dist` 目录。

## 开发与打包

需要 Node.js 20.11 或更高版本。项目直接锁定 Vite 6.4.3，其 Node 引擎范围覆盖 Node 20.11；请使用仓库中的 `package-lock.json` 安装一致的依赖版本。

```powershell
npm install
npm test -- --run
npm run package
```

`npm run package` 会依次执行类型检查、测试、构建和发布检查，再按固定文件顺序与时间戳生成并自验 ZIP。重复打包会稳定覆盖目标 ZIP，但不会删除 `release/` 中的其他文件。`npm run generate:icons` 可从仓库内的确定性 SVG 定义重新生成全部本地图标。

## 隐私与权限

扩展只申请 `sidePanel`、`tabs` 和 `storage` 权限，不申请主机权限，也不注入 content script。扩展自身不执行主动网络请求；默认快捷入口图标来自本地资源。为避免 favicon 带来的扩展网络请求，只有 Chrome 已提供的 `data:image/` favicon 会显示为图片，HTTP/HTTPS favicon 使用标题首字符回退。用户点击快捷入口后才会由 Chrome 打开对应网站。
