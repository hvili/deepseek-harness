# Agent Note: 通过平台映射回放录制中的 shell 工具名

Status: implemented

[English](2026-08-22-cross-platform-replay-tool-names.md) | 中文

## 问题

Web e2e 回放 fixture 录制的是真实 POSIX 会话，其中的 shell 调用携带工具名 `bash`。Windows 标准预设禁用 bash 并搭载 `pwsh`，因此回放出的调用指向活体工具集无法分发的工具：调用永远不会进入审批流程（`[data-approval-key]` 等待超时）、持久日志中不会出现 shell 结果，golden 也会在录制平台与 Windows 之间分叉。若按测试逐个修补——改写 fixture 行、打分发垫片、或维护第二份 Windows 录制——会让脆弱的按文件逻辑成倍增加，而 POSIX 仍需要 bash 录制来覆盖自身场景。

## 决策

`installLlmReplay` 接受可选的 `toolNames` 映射（录制名 → 活体名），并将其应用到每一条回放入口——主脚本、override 附属文件、fork 子脚本一视同仁——在首个携带名字的 `tool-call-delta` 和 `block-end` 工具调用块上改写名字，录制的参数字节则原样流出。映射之外的名字原样透传，`hang` 入口（不含工具调用）整体跳过该遍历。

Web 测试脚手架从唯一导出的常量 `liveShellToolName`（win32 上为 `pwsh`，其余平台为 `bash`）派生该映射：Windows 向回放层传入 `{ bash: 'pwsh' }`，POSIX 不传映射、按录制原样回放 bash。分发或断言活体 shell 工具的测试导入该常量，而不是硬编码任一名字。脚手架的 aria 归一化在 Windows 上把渲染出的 `Pwsh` 标题折叠为 `Bash`，使一份已提交的 golden 同时服务两个平台；直接执行的断言则把 PowerShell 的 CRLF 行尾归一为 POSIX 拼写。

## 备选方案

**把每份已提交的 session.jsonl 改成 `pwsh`。** 已提交的日志是真实 POSIX 会话的记录；改写它要么让该场景失去 bash 覆盖，要么分叉出一套必须同步重录的按平台 fixture。

**为测试在 Windows 预设中重新启用 bash。** 预设的工具集正是被测产品；为了让测试通过而扩大它会颠倒依赖方向，也不再覆盖出厂的 Windows 组合。

**在每个 e2e 测试内部改写工具名。** 每个场景都要自带一套分发垫片，fixture 或入口形态一变就会逐文件破裂；映射属于持有入口流式回放的 replay 层。

**每个场景再录一份 Windows fixture。** 对于平台无关的行为（审批、渲染、排队），这会让录制与维护成本翻倍；平台间差异只有 shell 工具的名字。

## 后果

一份录制 fixture 现在可在所有受支持平台上回放，以活体 shell 工具的真实名字分发、录制的参数保持不变；POSIX 覆盖继续逐字练习 bash。映射在 replay 层有单元覆盖——命名 delta、block-end、未映射透传、override 附属文件、子脚本——任何绕过改名的入口形态都会让这些测试响亮失败，而不是让跨平台回放静默回归。每个场景保持单一 golden aria 快照的代价，是 `normalizeAria` 中一段位置锚定的标题归一化，必须识别 shell 标题渲染的每一处位置。直接执行 shell 的 Windows 测试仍需自行翻译命令语法：映射改写的是工具名，不是命令字符串。
