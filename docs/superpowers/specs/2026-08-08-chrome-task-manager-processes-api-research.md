# Chrome 扩展读取任务管理器内容调研

日期：2026-08-08

## 结论

Chrome 扩展**不能直接读取或抓取 Chrome 自带任务管理器（`Shift+Esc`）窗口的界面内容**。Chrome 没有提供“读取任务管理器当前表格”的公开 API。

最接近的公开能力是 `chrome.processes`。它使用 Chrome 任务管理器的数据源，可以读取一部分进程、任务标题和资源指标，因此能做一个“近似的 Chrome 进程监视器”；但该 API 当前仍标记为 **Dev channel**，普通 Chrome Stable 扩展不能将它作为可用能力依赖，而且它返回的字段不是任务管理器的完整镜像。

对于面向普通稳定版 Chrome 用户、通过 Chrome Web Store 分发的本项目，不建议实现该功能。除非产品明确只支持 Chrome Dev/Canary，并接受 API 未来变化，否则应将其视为实验能力。

## 可用渠道与权限

- 当前官方文档将 `chrome.processes` 的可用性标为 **Dev channel**，没有标注可用于 Stable 的 `Chrome N+` 版本。
- Manifest 必须声明 `"processes"` 权限。
- Chromium 的 feature 配置让 `processes` API 依赖 `permission:processes`；permission feature 将普通扩展的公开可用渠道限制为 Dev。源码中还存在少量 Beta/Stable 的 allowlist 条目，那是特定扩展例外，不构成第三方扩展可依赖的公开能力。
- `processes` 权限本身在官方权限列表中没有列出安装警告文案，但“没有警告”不等于 Stable 可用，也不代表 Chrome Web Store 会接受与扩展单一用途无关的数据访问。

来源：

- [Chrome `chrome.processes` API](https://developer.chrome.com/docs/extensions/reference/api/processes)
- [Chrome 权限列表](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Chromium API feature 配置](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/extensions/api/_api_features.json)
- [Chromium permission feature 配置](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/extensions/api/_permission_features.json)
- [Chromium extension feature 文件说明](https://chromium.googlesource.com/chromium/src/+/master/chrome/common/extensions/api/_features.md)

## 可以读取的数据

`Process` 对象以 Chrome 内部进程 ID 为索引，能够提供：

| 数据 | 字段或入口 | 限制 |
| --- | --- | --- |
| Chrome 内部进程 ID、操作系统 PID | `id`、`osProcessId` | 基础字段 |
| 进程类型 | `type` | 包括 browser、renderer、extension、utility、gpu 等 |
| 配置文件名称 | `profile` | 基础字段 |
| 同一进程中的任务 | `tasks[]` | 每项只有 `title` 和可选 `tabId` |
| CPU | `cpu` | 仅由 `onUpdated` / `onUpdatedWithMemory` 更新事件提供；按单核百分比计算，多线程进程可超过 100% |
| 网络速率 | `network` | 仅由更新事件提供，单位为字节/秒 |
| JavaScript 内存 | `jsMemoryAllocated`、`jsMemoryUsed` | 仅由更新事件提供 |
| Blink 资源缓存 | `imageCache`、`scriptCache`、`cssCache` | 仅由更新事件提供 |
| SQLite 内存 | `sqliteMemory` | 仅由更新事件提供 |
| 内存占用 | `privateMemory` | `onUpdatedWithMemory`，或 `getProcessInfo(..., true)`；当前 Chromium 实现实际填入 memory footprint，字段名称仍为 `privateMemory` |

`getProcessInfo([], includeMemory)` 可以请求当前已知的全部进程；`getProcessIdForTab(tabId)` 可以找到指定标签页的渲染进程；`onCreated`、`onExited`、`onUnresponsive` 和更新事件可用于持续监控。

来源：

- [Chrome `Process` 与 `TaskInfo` 类型](https://developer.chrome.com/docs/extensions/reference/api/processes#type-Process)
- [Chrome `getProcessInfo()`](https://developer.chrome.com/docs/extensions/reference/api/processes#method-getProcessInfo)
- [Chrome `onUpdated` / `onUpdatedWithMemory`](https://developer.chrome.com/docs/extensions/reference/api/processes#event-onUpdated)
- [Chromium `processes_api.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/processes/processes_api.cc)

## 为什么不能得到完全一致的任务管理器内容

`chrome.processes` 返回的是“按进程聚合的有限数据对象”，不是任务管理器 UI 当前显示的行、列、排序、选择状态或图标。任务管理器内部接口和表格模型还支持更多信息，例如：

- GPU 内存、交换内存；
- CPU 累计时间、进程启动时间；
- 空闲唤醒、硬缺页；
- Windows 的 GDI/USER handles；
- Linux/ChromeOS 的打开文件描述符；
- 进程优先级、后台状态、扩展 keep-alive 数量；
- favicon、任务子类型、是否可终止、任务树和同进程分组关系。

这些能力没有全部暴露到 `chrome.processes.Process`。例如 API 没有 GPU 内存、CPU time、启动时间、handles、文件描述符、优先级或 favicon 字段。因此即使在 Dev/Canary 上，也只能构建一个字段较少、按进程聚合的近似界面，不能逐项复刻用户在 `Shift+Esc` 中可显示的完整表格。

来源：

- [Chromium Task Manager 内部接口](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/task_manager/task_manager_interface.h)
- [Chromium Task Manager 列定义](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/task_manager/task_manager_columns.cc)
- [Chromium Task Manager 表格模型](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/task_manager/task_manager_table_model.cc)

## Chrome Web Store 边界

Chrome Web Store 政策没有把 `processes` 单独列为“禁止权限”，但这不改变它的 Dev-channel 技术限制。商店分发也不会让该 API 在 Stable 中自动可用。

如果扩展处理任务标题、标签页关联或配置文件等可能反映浏览活动的数据，还必须遵守：

- 只请求实现现有用户功能所需的最小权限；
- 准确披露收集、使用和共享的数据，即便数据只在本机处理；
- 数据用途必须与扩展清晰、单一的用户可见目的直接相关。

来源：

- [Chrome Web Store 最小权限政策说明](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum-permission)
- [Chrome Web Store 披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)

## 对本项目的建议

面向 Chrome Stable 时，不要把“读取 Chrome 任务管理器”作为产品功能承诺。可以选择：

1. 只展示本扩展自身可测量的状态和资源使用情况，不声称等同于 Chrome 任务管理器。
2. 若确实需要系统级进程监控，使用用户明确安装的本机程序配合 Native Messaging；这会扩大安装、权限、隐私披露和安全维护成本，也仍不是对任务管理器 UI 的直接读取。
3. 仅在内部实验版中使用 `chrome.processes`，运行时先检查 `chrome.processes` 是否存在，并明确限定 Chrome Dev/Canary。

