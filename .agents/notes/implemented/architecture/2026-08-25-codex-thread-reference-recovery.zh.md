# Agent Note：Codex thread 引用恢复

Status: implemented

[English](2026-08-25-codex-thread-reference-recovery.md) | 中文

## 问题

一次性 Codex provider 创建临时 thread，并在进程结束时丢弃其 id。后续有状态消费者需要一个可跨 DSH 重启保存的外部身份，同时不能把 Codex 项目数据库视为 DSH 自有数据。

## 决策

`dsh-subagent-codex/thread-state` 负责版本化的 `CodexThreadReference`，以及范围很窄的稳定 `thread/start`、`thread/resume` 客户端操作。引用作为必需的、仅日志用途的 `codex/thread-reference` Session 事件写入一次，只携带不透明 Codex id。持久启动要求 `ephemeral: false`；恢复要求返回的非临时 id 与保存值一致。恢复会拒绝重复、畸形和不支持版本的引用记录。

一次性 provider 不调用该 API。后续执行适配器必须显式把它与 turn 生命周期和策略映射组合。

## 考虑过的替代方案

**持久化 Codex 项目数据库。** 不予采用，因为它会复制上游拥有的存储，并让 DSH 负责其迁移和凭据。

**把 id 写入 Session header metadata。** 不予采用，因为 append-only 事件让附着关系可审计、可回放且不能被静默覆盖。

**复用临时线程。** 不予采用，因为临时身份无法建立跨重启保证。

## 结果

DSH 现在有一套小而严格的状态模型，可通过既有持久化后端写入和恢复。它不会让现有 provider 变成有状态，并有意把输出、item、用量、审批和 UI 投影留给后续工作。
