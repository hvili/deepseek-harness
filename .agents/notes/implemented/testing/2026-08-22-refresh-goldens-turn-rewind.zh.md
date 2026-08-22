# Agent Note: 刷新越过 turn-rewind 传送门的 golden 并钉住捕获竞态

Status: implemented

[English](2026-08-22-refresh-goldens-turn-rewind.md) | 中文

## 问题

turn-rewind 于 08-21 进入出厂 Web profile，晚于 aria golden 上一次整体刷新（08-10），因此所有含直接用户消息的 golden 都缺少两个传送门按钮（编辑、恢复到发送之前）——两平台皆然，即"大量 ARIA 快照失败"簇。其下还藏着排查暴露的四个独立缺陷：`normalizeAria` 的 Windows 反斜杠折叠连内容反斜杠的 YAML 编码也一并改写（JSON 转义引号渲染为三个反斜杠加引号），污染了两份刷新后的 golden；details-lifecycle 测试按父级计数寻址侧栏分组 treeitem，而工作区标签功能加的两层包装 span 打破了它；message-actions 的无 Edit 守护以子串命中了传送门的 'Edit this message'；另有两个 golden 与 Chromium 事件时序竞态（一个悬停 tooltip、一个 fork 行的 Running→Completed 迁移）。

## 决策

用权威写入器刷新过时语料（逐文件 `DSH_SNAPSHOT=refresh`，随即回放验证——两次运行一致的 golden 即稳定），再在根部修复暴露的缺陷：折叠正则收窄为拒绝后继引号或反斜杠，路径分隔符照折而录制参数幸存；树行按角色寻址（`getByRole('treeitem').filter({ hasText })`）而非 DOM 深度；Edit 守护加 `exact: true` 收窄；队列编辑快照剥离 tooltip 节点（悬停附属物不是该 golden 的契约——让它显现的边界事件依赖时序）；fork 行捕获前轮询到稳定的 Completed 标签。一个场景在 Windows 上保持失败是刻意的：goal-multi-turn-actions 回放的模型手写 POSIX 命令（`ls -la`、`python3`）在 pwsh 下真实失败，其 golden 保留 POSIX 拼写——固化 Failed 行等于断言一个 POSIX 永远不会出现的分歧。

## 备选方案

**向每份 golden 脚本插入两行按钮。** 需要在 36 个形态各异的文件里按结构识别用户消息 Copy 行；误判到助手行会静默污染 golden，且本次刷新吸收的其他差异轴仍需手工处理。

**在 win32 上把 'Failed Bash' 折叠为 'Bash'。** 伪造执行状态：bash-abort-row 合法地断言来自录制中止的 Failed 行，该折叠会抹掉所有真实失败。

**为这些测试在 Windows 预设重新启用 bash。** 为通过测试而扩大产品组合颠倒了依赖（且明确越界）。

## 后果

三十五份 golden 现在携带传送门按钮（以及刷新吸收的其他 08-10 后漂移：mid-steer 的提问等待行、composer 上下文统计）；每份刷新文件在 Windows 上都通过了刷新加至少一次回放，归一化保证写入的 golden 与 POSIX 兼容——对每一新增行的污染扫描未发现平台拼写。折叠的前瞻守卫是承重墙：未来任何内容含反斜杠的 golden 都会检验它，bash-abort-row 与 cordis-tool-round 的 golden 现在就在做这件事。goal-multi-turn-actions 的失败是剩余且已报告的 Windows 缺口：回放的工具调用是真实执行的，录制的 POSIX 命令语法不是 PowerShell 语法——工具名映射改写的是工具，永远不是命令。
