# Chrome 左侧标签栏扩展设计文档

## 概述

构建一个基于 Chrome Manifest V3 的扩展，通过 Chrome 官方 Side Panel API 提供类似 Edge 的左侧标签列表。首个版本以性能、最小权限和 Chrome 应用商店上架准备为优先，只实现当前窗口标签页的查看、搜索、切换和关闭，以及一组可配置的网站快捷入口。

扩展不会替换 Chrome 顶部原生标签栏，不会向网页注入界面，不会收集浏览数据，也不会执行远程代码。

## 目标

- 在常驻侧边栏中显示当前 Chrome 窗口的标签页。
- 快速完成搜索、切换和关闭，并清楚标识当前标签页和固定标签页。
- 在侧边栏顶部提供可配置、可整体关闭的网站图标快捷入口。
- 默认提供 OpenAI、Google 和 GitHub 三个快捷网站。
- 保持较低的启动耗时、内存占用和运行时开销。
- 使用满足 Chrome 应用商店审核要求的最小权限集。
- 保持架构简单，为后续扩展更多 Edge 风格功能留出空间。

## MVP 不包含的功能

- 替换或隐藏 Chrome 顶部原生标签栏。
- 向每个网页注入悬浮侧边栏。
- 标签页休眠、冻结或内存管理。
- 云同步、账号、遥测、分析或服务器通信。
- 会话恢复、工作区或跨设备状态。
- 复杂标签分组、树状标签或自动按域名聚类。
- 自动抓取网站图标或请求第三方 favicon 服务。
- 使用 React、Vue 或其他重型 UI 框架。

## 产品行为

用户通过扩展图标或 Chrome 的侧边栏控件打开扩展。快捷网站功能默认关闭；关闭时，面板从上到下仅包含搜索框和当前窗口标签列表。用户开启快捷网站后，快捷网站区显示在搜索框上方。

### 快捷网站区

- 以紧凑的单行图标展示快捷网站，空间不足时允许横向滚动，不挤压标签列表。
- 提供快捷网站总开关，默认关闭。
- 总开关关闭时不渲染快捷网站区，也不为该区域保留布局空间。
- 默认包含 OpenAI、Google 和 GitHub。
- 点击图标后，在当前窗口新建并激活对应标签页。
- 提供一个设置入口，用于新增、编辑、删除和调整快捷网站顺序。
- 支持恢复默认配置。
- 每个快捷网站包含名称、URL 和图标标识。
- 默认网站使用随扩展打包的本地图标；自定义网站优先使用用户选择的内置图标或文字首字母占位，MVP 不访问远程 favicon 服务。
- 开关状态和网站配置保存在 `chrome.storage.local`，只存储快捷网站设置，不存储浏览历史或标签页快照。
- MVP 最多保存 12 个快捷网站，避免工具区无限增长。

### 标签列表

每个标签行包含：

- favicon 或回退标识。
- 页面标题，超出宽度时显示省略号。
- 域名或缩短后的 URL。
- 当前激活状态标识。
- 固定状态标识。
- 关闭按钮。

MVP 支持以下操作：

- 点击标签行激活该标签页。
- 点击关闭按钮关闭标签页。
- 在搜索框中按标题、URL 或域名筛选标签页。
- 标签页创建、删除、激活、移动或内容更新时，侧边栏同步更新。
- 搜索框保留浏览器默认键盘可用性；更完整的键盘导航延后到 v1.1。

## 推荐实现方案

采用：

- Manifest V3。
- Chrome Side Panel API。
- 原生 TypeScript。
- 原生 DOM 渲染。
- 普通 CSS。
- 仅在 TypeScript 构建确有需要时使用轻量构建流程。

避免：

- Content Scripts。
- `<all_urls>` 等主机权限。
- 远程 JavaScript 或远程图标请求。
- 长时间轮询。
- 大型组件框架。

这套方案体积小、行为可预测，也便于在 Chrome 应用商店审核时解释权限和数据使用方式。

## 扩展结构

```text
manifest.json
assets/
  shortcuts/
    openai.png
    google.png
    github.png
src/
  background/
    service-worker.ts
  sidepanel/
    index.html
    sidebar.ts
    sidebar.css
    tab-store.ts
    tab-renderer.ts
    tab-actions.ts
    shortcut-store.ts
    shortcut-renderer.ts
    shortcut-actions.ts
```

### `manifest.json`

声明 MV3 扩展、侧边栏入口、Service Worker、扩展操作图标和最小权限。

初始权限：

- `sidePanel`：显示侧边栏界面。
- `tabs`：读取和管理浏览器标签页。
- `storage`：在本地保存用户配置的快捷网站。

MVP 不申请任何主机权限。

### `src/background/service-worker.ts`

职责：

- 配置点击扩展图标时打开侧边栏。
- 保持后台工作量最小。
- 不保存标签页快照。

MV3 Service Worker 由事件驱动，并可能在事件之间停止运行，因此不能作为标签页状态的数据源。

### `src/sidepanel/sidebar.ts`

职责：

- 初始化侧边栏界面。
- 面板加载时查询当前窗口标签页。
- 连接 Chrome 标签事件与标签状态仓库。
- 加载快捷网站配置。
- 连接搜索、点击和快捷网站设置等界面事件。
- 协调渲染，但不承担底层 DOM 细节。

### `src/sidepanel/tab-store.ts`

职责：

- 在侧边栏打开期间维护内存中的标签页状态。
- 使用以标签页 ID 为键的 `Map<number, TabViewModel>`。
- 记录当前激活标签页 ID 和搜索条件。
- 提供初始化、新增、更新、删除、移动、激活和筛选方法。

标签状态只保存在内存中。每次打开侧边栏时，都通过 `chrome.tabs.query` 重建。

### `src/sidepanel/tab-renderer.ts`

职责：

- 渲染标签列表。
- 尽可能只更新受影响的标签行。
- 小范围变化不重绘整个列表。
- 首次渲染和较大筛选结果使用 `DocumentFragment`。

MVP 在搜索时允许全量重绘，但必须保证至少 100 个标签页时仍保持流畅。标题、favicon、激活状态等常见变化使用增量更新。

### `src/sidepanel/tab-actions.ts`

职责：

- 封装 Chrome 标签操作，包括 `chrome.tabs.update`、`chrome.tabs.remove` 和 `chrome.tabs.create`。
- 统一处理标签页已关闭或不可用等错误。

### `src/sidepanel/shortcut-store.ts`

职责：

- 从 `chrome.storage.local` 读取和保存快捷网站配置。
- 首次运行时返回关闭状态，以及默认的 OpenAI、Google 和 GitHub 配置。
- 保存和读取快捷网站总开关状态。
- 校验名称、URL、数量和顺序。
- 支持恢复默认配置。

### `src/sidepanel/shortcut-renderer.ts`

职责：

- 渲染快捷网站图标和设置入口。
- 使用事件委托处理点击。
- 图标加载失败时显示名称首字母占位。
- 控制设置界面的打开、保存、取消和错误提示状态。

### `src/sidepanel/shortcut-actions.ts`

职责：

- 校验 URL，仅接受 `http:` 和 `https:` 地址。
- 点击快捷网站时调用 `chrome.tabs.create({ url, active: true })`。
- 拒绝 `javascript:`、`data:`、`file:` 等不适合作为快捷入口的协议。

## 数据模型

```ts
type TabViewModel = {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
};

type Shortcut = {
  id: string;
  name: string;
  url: string;
  icon: "openai" | "google" | "github" | "letter";
};

type ShortcutSettings = {
  enabled: boolean;
  items: Shortcut[];
};
```

只存储渲染和 MVP 操作所必需的字段。快捷网站 ID 在创建时生成，并在排序和编辑时保持稳定。

## 数据流

1. 侧边栏加载。
2. `sidebar.ts` 调用 `chrome.windows.getCurrent()` 和 `chrome.tabs.query({ windowId })`。
3. `tab-store.ts` 创建内存标签映射。
4. `shortcut-store.ts` 从本地存储加载快捷网站设置；无配置时使用关闭状态和默认网站列表。
5. 标签列表完成首次渲染；仅当 `enabled` 为 `true` 时渲染快捷网站区。
6. Chrome 标签事件更新标签状态仓库。
7. 渲染器局部更新受影响的标签行，或重绘筛选后的列表。
8. 用户的标签操作调用 `tab-actions.ts`，再由 Chrome 事件校准最终状态。
9. 用户切换总开关或保存快捷网站设置后，先校验数据，再写入本地存储并按开关状态显示或移除快捷网站区。

## 标签事件处理

侧边栏打开期间监听：

- `chrome.tabs.onCreated`
- `chrome.tabs.onRemoved`
- `chrome.tabs.onUpdated`
- `chrome.tabs.onActivated`
- `chrome.tabs.onMoved`
- `chrome.tabs.onAttached`
- `chrome.tabs.onDetached`

除非后续明确增加跨窗口支持，否则所有事件都忽略不属于当前窗口的标签页。

## 性能要求

目标：

- HTML 加载后，在常见现代设备上 100 毫秒内可交互。
- 100 个标签页时列表滚动、搜索和切换保持流畅。
- 快捷网站区初始化不产生网络请求。
- 不在网页上运行 Content Script。
- 不使用轮询。
- 不产生框架 hydration 开销。

实现规则：

- 仅在侧边栏打开时初始化。
- Service Worker 只承担最小配置职责。
- 标签页变化完全由事件驱动。
- 搜索输入使用约 80 至 120 毫秒防抖。
- 必要时在标签更新时预先生成搜索用规范化字符串，避免每次按键重复处理。
- 标签行和快捷图标使用事件委托，避免为每个元素绑定独立监听器。
- 不保存大型标签历史或快照。
- 快捷网站配置最多 12 项，渲染成本保持恒定且可预测。

## 隐私与 Chrome 应用商店准备

MVP 必须满足以下声明：

- 扩展不收集用户数据。
- 扩展不传输浏览历史、标签标题、URL 或快捷网站配置。
- 扩展不使用分析工具。
- 扩展不执行远程托管代码。
- 扩展仅申请侧边栏标签管理和本地设置所需权限。

应用商店说明应明确：

- `tabs` 权限用于显示和管理用户当前窗口的标签列表，以及打开用户主动点击的快捷网站。
- `sidePanel` 权限用于在 Chrome 侧边栏中显示扩展界面。
- `storage` 权限仅用于在用户设备本地保存快捷网站设置。

如果后续版本加入同步、分析、云备份或主机权限，发布前必须重新评估隐私政策和权限说明。

## 错误处理

预期错误：

- 操作完成前标签页已关闭。
- 标签页被移动到另一个窗口。
- favicon 或快捷图标加载失败。
- Chrome 标签事件到达顺序异常。
- 当前环境中不存在普通浏览器窗口。
- 用户输入空名称、无效 URL、重复快捷项或超过 12 项。
- 本地设置读取或写入失败。

处理方式：

- 安全忽略过期的标签事件。
- 从仓库移除已不存在的标签页。
- 图标失败时使用稳定的文字占位。
- 没有标签页或没有搜索结果时显示紧凑空状态。
- 设置校验失败时保留用户输入并就地显示简短错误信息。
- 本地存储失败时不覆盖当前内存配置，并提示保存失败。
- 开发环境可记录警告，生产版本避免产生大量控制台输出。

## 测试策略

MVP 手动验证：

- 在 Chrome 中加载未打包扩展。
- 通过扩展图标打开侧边栏。
- 确认当前窗口标签页正确渲染。
- 打开、关闭、移动、固定和激活标签页。
- 按标题、域名和 URL 搜索。
- 分别测试 1、20 和 100 个以上标签页。
- 确认开启快捷网站功能后显示 OpenAI、Google 和 GitHub。
- 确认首次安装时快捷网站功能默认关闭，快捷网站区不占布局空间。
- 确认开启后显示 OpenAI、Google 和 GitHub，关闭后立即隐藏。
- 确认重新打开侧边栏后仍保持用户设置的开关状态。
- 确认点击快捷图标会在当前窗口新建并激活标签页。
- 测试新增、编辑、删除、排序和恢复默认快捷网站。
- 测试无效协议、重复配置、数量上限和存储失败。
- 确认没有向网页注入界面。
- 确认扩展不发出网络请求。

自动化或半自动检查：

- TypeScript 编译。
- 如果加入相应工具，执行 lint 或静态检查。
- 为 URL 校验、域名规范化、标签筛选和快捷配置校验编写小型单元测试。

## 后续演进

- v1.1：完整键盘导航、拖动调整标签顺序、快捷网站拖动排序。
- v1.2：最近关闭的标签页和多窗口感知。
- v1.3：Chrome 标签组支持。
- v1.4：重复标签检测和域名分组。
- v2：工作区、会话保存与恢复、可选同步。

每项新功能都应遵循 MVP 原则：只有当用户价值足够明确时，才增加权限或持久后台工作。

## 实现默认值

- 暂定产品名：`SideTab Lite`。
- 默认快捷网站：OpenAI（`https://chatgpt.com/`）、Google（`https://www.google.com/`）和 GitHub（`https://github.com/`）。
- 快捷网站总开关默认关闭；关闭时不渲染快捷网站区。
- 快捷网站点击行为：在当前窗口新建并激活标签页。
- 快捷网站最多 12 个，配置保存在 `chrome.storage.local`。
- 除浏览器默认焦点行为和搜索框可用性外，完整键盘导航延后到 v1.1。
- 使用 TypeScript 和最小构建步骤。
- MVP 采用中性色、紧凑布局和本地静态资源，不使用远程品牌素材。

这些默认值作为首个实现计划的基线，后续可以通过独立设计变更进行调整。
