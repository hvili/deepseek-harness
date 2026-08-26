# Agent Note：Codex 有状态执行终态协调

Status: implemented

[English](2026-08-26-codex-stateful-execution-terminal-coordination.md) | 中文

## 问题

有状态适配器之前只等待 `turn/completed`。缺少终态通知时，新的 package-local app-server 及其进程树可能永久存活；失败的尽力式 interrupt 也可能让取消无法结束。

## 决策

`CodexStatefulExecution` 现在用一个先到先得的终态协调器统一处理已完成 turn、本地取消、child 结算、输入流结束／关闭／错误、输出传输错误和畸形终态通知。取消会立即以固定安全错误拒绝；可选的 `turn/interrupt` 请求会被观察，但不会成为取消结束的依赖。

每条路径都会关闭 JSON-RPC wire，再使用共享的 app-server 释放阶梯并等待完整进程树停稳。公开错误只携带稳定的阶段消息，不附带原始 stderr、路径、命令、凭据或上游错误文本。

## 范围边界

这是显式有状态 API 的修复。一次性 Codex provider、默认关闭的注册、DeepSeek 原生 Session 组装、工具、附件、用量、review、审批和 UI 均未改变。

## 验证

聚焦的有状态执行测试覆盖批量完成、child 退出和拒绝、interrupt 失败时取消、输入关闭、输出传输失败、畸形 `turn/completed`、有界 settle 及进程树停稳。
