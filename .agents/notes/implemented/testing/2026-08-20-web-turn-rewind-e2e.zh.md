# Agent Note：Web Turn Rewind 浏览器 E2E

状态：已实现

[English](2026-08-20-web-turn-rewind-e2e.md) | 中文

## 决策

Turn Rewind 客户端现在会在每条直接用户消息的既有“编辑这条消息”动作旁同时渲染完整的 rewind 动作，恢复文件恢复对话框。浏览器 E2E 在真实 Git worktree 中覆盖完整路径：变更前持久化 turn 检查点、路径级预览、恢复并 fork、救援点创建以及原会话保留。客户端文案通过基于 DSH locale 插件 `<html lang>` 属性的自包含字典本地化，英文与中文页面各自使用正确的可访问名称。

## 影响

Web 用户可以在同一条消息动作行中既编辑消息，也回退项目文件。E2E 使用项目子目录，使 Change Ledger 只快照真实工作树，而不是 scaffold 内部 harness 目录。当存在先前已完成 turn 时，子会话通过官方 fork 路径创建，因此 fork 谱系会被持久化并可恢复。

## 验证

`turn-rewind.e2e.ts` 浏览器场景通过：文件恢复到已提交初始状态，救援点与 turn 检查点可列出，子会话带 `parentSession`，原会话日志保留全部事件。聚焦 plan-mode 测试与 host 类型检查保持通过。
