# Agent Note：Codex thread 引用恢复

Status: implemented

[English](2026-08-25-codex-thread-reference-recovery.md) | 中文

## 问题

一次性 Codex provider 创建临时 thread，并在进程结束时丢弃其 id。后续有状态消费者需要一个可跨 DSH 重启保存的外部身份，同时不能把 Codex 项目数据库视为 DSH 自有数据。

## 决策

`dsh-subagent-codex/thread-state` 负责版本化引用、`codex/thread-start-wal` 及稳定的 `thread/start`／`thread/resume` 操作。最终引用是唯一必需、仅日志用途的 `codex/thread-reference` 事件。恢复会重新验证字面量版本、不透明 id 和字段，并要求返回的持久 id 匹配。它拒绝畸形、冲突、重复和不支持的记录。

`CodexStatefulExecution` 是独立消费者。它为每个 turn 启动 package-local app-server，恢复耐久 id，并在成功、取消或失败后等待完整子进程树退出。一次性 provider 不调用该 API。

## 耐久启动协议

Session 所有者先追加 `prepared(operationId)`，再执行 `thread/start`；观察到上游 id 后追加 `accepted(operationId, threadId)`，并在 `turn/start` 前写入最终引用。已观察 id 在两次耐久写入完成前绝不使用。恢复会补全 accepted 记录；仍为 prepared 的记录失败关闭并阻止自动 continuation。

## 考虑过的替代方案

**持久化 Codex 项目数据库。** 不予采用，因为它会复制上游拥有的存储，并让 DSH 负责其迁移和凭据。

**把 id 写入 Session header metadata。** 不予采用，因为 append-only 事件让附着关系可审计、可回放且不能被静默覆盖。

**复用临时线程。** 不予采用，因为临时身份无法建立跨重启保证。

**`thread/start` exactly-once。** 不予采用，因为 0.147.0 没有调用方提供的幂等键、事务 token 或补偿删除。上游已接受但响应到达 DSH 前崩溃会留下未解决 prepared 记录，不会静默创建分叉会话。

## 结果

DSH 提供“已观察 id 至少一次”协议：已观察上游身份会在使用前写入日志；未观察启动会停止恢复。故障注入固定覆盖 accepted 写入失败。item 流、用量、审批桥接和 UI 投影仍不属于此适配器。
