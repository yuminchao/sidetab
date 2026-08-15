#  全局规则
- 每次打包前检查代码是否包含敏感信息，比如：公司信息，个人信息等
- 每次打包都版本号和对应更新的内容记录到当前目录下的E:\java\sidebar\update.log
- 优先使用codegraph分析代码

## Agent skills

### Issue tracker

本仓库使用 `.scratch/<feature>/` 下的本地 Markdown 文件跟踪任务。详见 `docs/agents/issue-tracker.md`。

### Triage labels

本仓库使用五个默认 triage 状态。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库采用单上下文领域文档布局。详见 `docs/agents/domain.md`。

