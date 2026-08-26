# Agent Note：DSH Session 的 Codex thread 身份 journal

Status: implemented

[English](2026-08-26-dsh-session-codex-thread-journal.md) | 中文

## 问题

有状态 Codex 执行需要在全新的 DSH Session 挂载之间携带一个外部 thread 身份，但内存 journal 无法证明 reference 或 WAL 记录在重启后仍然存在。没有真实的 append-and-flush 适配器时，已接受的上游 thread 可能丢失，冲突 reference 也可能被静默替换；JSONL 与 SQLite 还可能分裂成互不相同的持久化路径。

## 决策

`DshSessionCodexThreadJournal` 是 `CodexStatefulExecution` 与 live DSH `Session` 之间的窄生产适配器。所有者必须先通过选定的 `SessionPersistence` 后端加载或 prepare 完整、已验证的 Session。`load()` 读取不可变的 Session 事件快照；写入调用 `Session.append()`，只有在 `SessionStore.flush()` 报告存在真实持久化 listener 且成功完成后才 resolve。

最终 `codex/thread-reference` 对同一个不透明 thread id 幂等；不同 id、未知字段或未来版本都会拒绝。它绝不写 Session header metadata，也不复制 Codex 项目数据库。该适配器必须显式构造，不注册 Profile provider，也不会自行启动 app-server。

## 后端 seam

JSONL 与 SQLite 可以在一次挂载中共同消费同一个 DSH Session seam：Session 所有者选择一种 `SessionPersistence` 实现，而本 journal 只使用共同的 `SessionStore.flush()` 契约。journal 不会双写，也不会让两个物理后端共同成为一份日志的写入者。

## 恢复证据

耐久故障测试模拟 flush 边界：accepted 耐久失败时，持久事件中只留下 prepared，因此重启失败关闭并要求 reconciliation；prepared 加 accepted 证据会恢复同一 thread id，允许补写一次 reference，并 resume 而不是再次 start。Codex 0.147.0 缺少幂等键和补偿删除，因此不承诺 exactly-once thread 创建。

## 曾考虑的替代方案

- **把 Codex 项目数据库或历史复制到 DSH**：否决，因为这会复制上游所有者管理的存储，并产生不受支持的同步契约。
- **把 thread id 放入 Session header metadata**：否决，因为 header 字段可能被静默覆盖，无法留下 append-only 的冲突证据。
- **同时写 JSONL 和 SQLite**：否决，因为一次 DSH Session 挂载必须有一个选定的持久化所有者；共同的 Session seam 是兼容边界，而不是两个共同写入者。
- **在 flush barrier 之前就让 append resolve**：否决，因为内存 append 不是重启证据，会使 accepted 写入失败测试失去真实性。

## 后果

生产适配器保持窄且显式：Session 所有者选择一种持久化后端，提供完整、已验证的 Session，并从 `SessionStore.flush()` 获得耐久性。同 id 的 reference 重试是安全的；冲突以及未来版本或未知字段会失败关闭；仅用于测试的故障注入 harness 只是证据，不是面向用户的能力。只有 prepared 的恢复需要人工 reconciliation；accepted 的恢复可以修复唯一缺失的 reference，并 resume 已观察到的 thread。Codex 0.147.0 仍然阻止 exactly-once 保证，因此适配器不作此承诺。
