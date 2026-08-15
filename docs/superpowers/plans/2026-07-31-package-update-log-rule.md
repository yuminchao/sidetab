# 打包更新日志规则实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 明确规定每次打包都将版本号和对应更新内容追加到同一个固定日志文件。

**Architecture:** 仅替换项目根目录 `AGENTS.md` 中现有的打包日志规则，不新增规则文件或日志文件。通过 UTF-8 文本匹配和 Git 差异检查验证规则的文件路径、追加语义及单文件约束。

**Tech Stack:** Markdown、PowerShell、Git

---

### Task 1: 更新并验证打包日志规范

**Files:**
- Modify: `AGENTS.md:2`

- [ ] **Step 1: 替换现有规则**

将 `AGENTS.md` 第 2 行替换为：

```markdown
- 每次打包时，必须将版本号及对应的更新内容追加记录到固定文件 `E:\java\sidebar\update.log` 中；所有版本共用该文件，不得按版本新建其他更新日志文件。
```

- [ ] **Step 2: 验证规则文本和文件编码**

Run:

```powershell
Get-Content -Raw -Encoding UTF8 '.\AGENTS.md'
rg -n "追加记录|E:\\java\\sidebar\\update\.log|不得按版本新建" '.\AGENTS.md'
```

Expected: 输出的中文无乱码，且三个约束均命中 `AGENTS.md` 第 2 行。

- [ ] **Step 3: 检查变更范围**

Run:

```powershell
git diff --check -- '.\AGENTS.md'
git diff -- '.\AGENTS.md'
```

Expected: `git diff --check` 无输出，差异中只有打包日志规范发生变化。

- [ ] **Step 4: 提交规则变更（仅在用户要求提交时执行）**

提交前重新读取 `C:\Users\NUC\.codex\rules\git-commit.md`，仅暂存 `AGENTS.md`，并使用执行时的本地时间生成提交消息：

```powershell
git add -- '.\AGENTS.md'
$taskTimestamp = Get-Date -Format 'yyyyMMddHHmmss'
git commit -m "$taskTimestamp feat 明确打包更新日志单文件规范"
```

Expected: 提交消息满足 `^\d{14} (feat|fix) .+$`；未要求提交时跳过本步骤。
