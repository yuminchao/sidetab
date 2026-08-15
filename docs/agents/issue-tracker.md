# Issue 跟踪方式：本地 Markdown

本仓库的需求、规格和任务保存在 `.scratch/`。

## 约定

- 每个功能使用独立目录：`.scratch/<feature-slug>/`
- 规格文件：`.scratch/<feature-slug>/spec.md`
- 实施任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 任务从 `01` 开始编号，每个任务单独一个文件
- 文件顶部使用 `Status:` 记录 triage 状态
- 讨论记录追加到文件底部的 `## Comments`

## 发布任务

当技能要求“发布到 issue tracker”时，在 `.scratch/<feature-slug>/` 下创建对应文件和目录。

## 获取任务

当技能要求读取相关任务时，读取用户提供的文件路径或任务编号。

## Wayfinding

- Map：`.scratch/<effort>/map.md`
- 子任务：`.scratch/<effort>/issues/NN-<slug>.md`
- `Type:` 可为 `research`、`prototype`、`grilling` 或 `task`
- `Status:` 可为 `claimed` 或 `resolved`
- `Blocked by:` 记录依赖的任务编号
- 领取任务前先写入 `Status: claimed`
- 完成后添加 `## Answer`，更新为 `Status: resolved`，并将摘要和链接写入 map
