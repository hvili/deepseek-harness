# Agent Note：DSH Session 的 Codex thread 身份 journal

Status: implemented

[English](2026-08-26-dsh-session-codex-thread-journal.md) | 中文

## 决策

`DshSessionCodexThreadJournal` 是 `CodexStatefulExecution` 与 live DSH `Session` 之间的窄生产适配器。所有者必须先通过选定的 `SessionPersistence` 后端加载或 prepare 完整、已验证的 Session。`load()` 读取不可变的 Session 事件快照；写入调用 `Session.append()`，只有在 `SessionStore.flush()` 报告存在真实持久化 listener 且成功完成后才 resolve。

最终 `codex/thread-reference` 对同一个不透明 thread id 幂等；不同 id、未知字段或未来版本都会拒绝。它绝不写 Session header metadata，也不复制 Codex 项目数据库。该适配器必须显式构造，不注册 Profile provider，也不会自行启动 app-server。

## 后端 seam

JSONL 与 SQLite 可以在一次挂载中共同消费同一个 DSH Session seam：Session 所有者选择一种 `SessionPersistence` 实现，而本 journal 只使用共同的 `SessionStore.flush()` 契约。journal 不会双写，也不会让两个物理后端共同成为一份日志的写入者。

## 恢复证据

耐久故障测试模拟 flush 边界：accepted 耐久失败时，持久事件中只留下 prepared，因此重启失败关闭并要求 reconciliation；prepared 加 accepted 证据会恢复同一 thread id，允许补写一次 reference，并 resume 而不是再次 start。Codex 0.147.0 缺少幂等键和补偿删除，因此不承诺 exactly-once thread 创建。
