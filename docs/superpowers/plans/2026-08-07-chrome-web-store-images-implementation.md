# Chrome 网上应用店宣传图片实施计划

> **供智能代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 为 SideTab Lite 0.10.2 生成一张 1280×800 屏幕截图、一张 440×280 小型宣传图块和一张 1400×560 顶部宣传图块，全部为无 Alpha 的 RGB PNG。

**架构：** 新增一个只用于商店素材的 Node 脚本，以确定性的 SVG 场景描述复用扩展图标、浅色侧边栏结构和双语文案，再通过仓库现有的 `sharp` 依赖输出 PNG。测试读取生成产物的元数据并检查尺寸、色彩空间、透明通道、文件签名和非空像素；最后用图片查看工具逐张做视觉验收。

**技术栈：** Node.js ESM、Sharp、SVG、Vitest、现有 SideTab Lite PNG/SVG 资产。

---

## 文件结构

- 新建 `scripts/generate-store-images.mjs`：定义共享配色、侧边栏预览、三种画布构图和 PNG 导出逻辑。
- 新建 `tests/store-images.test.ts`：验证生成脚本契约和三张最终图片的格式约束。
- 新建 `store-assets/0.10.2/`：保存三张最终 PNG，不进入扩展发布 ZIP。

### 任务 1：建立产物契约测试

**文件：**
- 新建：`tests/store-images.test.ts`

- [ ] **步骤 1：编写失败测试**

测试以 `sharp(...).metadata()` 读取三个固定路径，并精确断言：

```ts
const cases = [
  ["screenshot-1280x800.png", 1280, 800],
  ["small-promo-440x280.png", 440, 280],
  ["marquee-1400x560.png", 1400, 560],
] as const;

expect(metadata.format).toBe("png");
expect(metadata.width).toBe(width);
expect(metadata.height).toBe(height);
expect(metadata.space).toBe("srgb");
expect(metadata.channels).toBe(3);
expect(metadata.hasAlpha).toBe(false);
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm test -- --run tests/store-images.test.ts`

预期：失败，提示缺少商店图片文件。

- [ ] **步骤 3：提交测试契约**

只暂存 `tests/store-images.test.ts`，提交消息使用本地时间戳和 `feat` 类型。

### 任务 2：实现共享产品界面场景

**文件：**
- 新建：`scripts/generate-store-images.mjs`

- [ ] **步骤 1：定义输出规格和安全转义**

脚本固定输出目录与规格：

```js
const OUTPUT_DIR = resolve("store-assets/0.10.2");
const OUTPUTS = [
  { name: "screenshot-1280x800.png", width: 1280, height: 800 },
  { name: "small-promo-440x280.png", width: 440, height: 280 },
  { name: "marquee-1400x560.png", width: 1400, height: 560 },
];
```

提供 `escapeXml(value)`，对 `& < > " '` 做实体编码，所有可见字符串经过该函数进入 SVG。

- [ ] **步骤 2：构建共享侧边栏预览**

实现 `sidebarPreview({ x, y, width, height, compact })`，输出浅色侧边栏 SVG 片段。片段必须包含：

- 固定标签区；
- 蓝色“工作”标签组和绿色“阅读”标签组；
- 普通标签行与当前选中行；
- 快捷入口；
- 底部搜索框和设置图标；
- 14 像素标签标题，分组内活动标签不绘制左侧竖线。

示例标题仅使用 `项目看板`、`设计文档`、`发布检查`、`技术文章`、`稍后阅读`，不得包含账号、邮箱、公司名或真实历史记录。

- [ ] **步骤 3：复用现有品牌资产**

读取 `assets/icons/icon-128.png` 并转换为 data URL；宣传图块只使用这一现有产品图标，不生成或替换 Logo。底部设置和搜索符号使用现有 `assets/icons/settings.svg`、`assets/icons/search.svg` 的数据内容或等价引用。

- [ ] **步骤 4：运行脚本语法检查**

运行：`node --check scripts/generate-store-images.mjs`

预期：退出码 0，无语法错误。

- [ ] **步骤 5：提交共享场景实现**

只暂存 `scripts/generate-store-images.mjs`，提交消息使用本地时间戳和 `feat` 类型。

### 任务 3：生成三种商店构图

**文件：**
- 修改：`scripts/generate-store-images.mjs`
- 生成：`store-assets/0.10.2/screenshot-1280x800.png`
- 生成：`store-assets/0.10.2/small-promo-440x280.png`
- 生成：`store-assets/0.10.2/marquee-1400x560.png`

- [ ] **步骤 1：实现 1280×800 屏幕截图构图**

实现 `renderScreenshot()`：绘制完整浅色 Chrome 窗口、克制的通用内容页和右侧 340 像素 SideTab Lite 面板。不得叠加营销文案；界面必须占据足够面积以看清分组、标签和底部搜索。

- [ ] **步骤 2：实现 440×280 小型宣传图块**

实现 `renderSmallPromo()`：左上显示图标和 `SideTab Lite`，中部显示 `标签管理，更快一步`，下方显示 `Fast tab management, right by your side`，右侧显示紧凑侧边栏局部。为最长英文行保留至少 190 像素有效宽度并允许分为两行，避免截断。

- [ ] **步骤 3：实现 1400×560 顶部宣传图块**

实现 `renderMarquee()`：左侧展示图标、产品名和相同双语文案，右侧放大展示侧边栏与少量 Chrome 窗口框架。禁止渐变、光斑、嵌套卡片和无关装饰。

- [ ] **步骤 4：以 RGB PNG 输出**

每个 SVG 通过以下管线输出，显式移除 Alpha：

```js
await sharp(Buffer.from(svg))
  .flatten({ background: "#ffffff" })
  .removeAlpha()
  .toColourspace("srgb")
  .png({ compressionLevel: 9, palette: false })
  .toFile(outputPath);
```

- [ ] **步骤 5：生成图片并运行契约测试**

运行：`node scripts/generate-store-images.mjs && npm test -- --run tests/store-images.test.ts`

预期：生成三张图片；测试全部通过，三张图片均为对应精确尺寸、sRGB、3 通道且 `hasAlpha=false`。

- [ ] **步骤 6：提交生成器和最终素材**

只暂存 `scripts/generate-store-images.mjs`、`store-assets/0.10.2/*.png`，提交消息使用本地时间戳和 `feat` 类型。

### 任务 4：视觉与回归验收

**文件：**
- 检查：`store-assets/0.10.2/*.png`
- 检查：`tests/store-images.test.ts`

- [ ] **步骤 1：逐张查看最终图片**

使用图片查看工具打开三张图片，检查：文字拼写准确、没有重叠或截断、界面非空白、侧边栏关键内容可见、配色与浅色主题一致。

- [ ] **步骤 2：执行像素级非空检查**

使用 `sharp(...).stats()` 检查每张图片至少存在多种颜色通道值，且画面不是全白、全黑或单色；同时再次输出尺寸、通道数和 Alpha 状态。

- [ ] **步骤 3：运行完整回归**

运行：`npm run check`

预期：类型检查、全部自动化测试、构建和 dist 审计通过。商店素材目录不得进入扩展发布 ZIP 的 14 文件清单。

- [ ] **步骤 4：检查工作树范围**

运行：`git status --short` 和 `git diff --check`。确认未覆盖用户已有的 `README.md`、`manifest.json`、`package*.json`、`tests/smoke.test.ts`、`update.log` 等发布元数据改动；本任务提交只包含明确列出的商店素材相关文件。

- [ ] **步骤 5：最终提交**

如视觉验收需要微调，只提交商店素材生成器、测试和生成图片；提交消息使用本地时间戳和 `fix` 类型。若无需修改，则不创建空提交。
