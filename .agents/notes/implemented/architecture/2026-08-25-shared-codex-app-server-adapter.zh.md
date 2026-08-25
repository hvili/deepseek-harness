# Agent Note：共享 Codex app-server 适配层

Status: implemented

[English](2026-08-25-shared-codex-app-server-adapter.md) | 中文

## 问题

首个 Codex provider 在单次执行的产品适配器内部负责包解析、app-server 握手、协议传输和进程清理。如果继续在这里增加续接、review、审批界面与其他 Codex 消费方，就会重复运行时所有权，并让协议升级绑定到单个 provider 的策略。

## 决策

`@deepseek-ai/dsh-codex-app-server` 作为共享集成边界。它负责精确锁定的 `@openai/codex@0.147.0` 依赖、包内命令构造、稳定 schema 生成、JSON-RPC 初始化和进程树完全停稳。完成必需握手后，它会公开由产品选择的方法与通知，同时不启用实验 API。

测试会重新生成稳定 JSON Schema，并与已跟踪的文件数量及聚合 SHA-256 指纹比较。因此，升级 Codex 依赖后必须显式审查 schema，消费方才能重新通过门禁。现有 `dsh-subagent-codex` provider 保持为兼容消费方，并继续负责单进程、临时线程、无人值守审批、结果选择和安全诊断策略。

未来的有状态消费方可以通过这层使用稳定的线程恢复、fork、列表、review、diff、用量、审批、skill、hook 与 MCP 方法。DSH 自有状态只把 Codex thread id 保存为外部执行引用，不会把 Codex 项目数据库复制进 DSH。

## 曾考虑的替代方案

**继续把集成留在 provider 内部。** 否决，因为每个新消费方都要重复可执行文件解析、生命周期和版本门禁。

**导入完整 Codex Rust 运行时。** 否决，因为官方 app-server 已经负责执行语义并发布版本化协议。移植它会扩大 fork，并重复上游的安全工作。

**默认启用实验性方法。** 否决，因为增强发行版需要可预测的 RC/Release 升级列车。实验方法可以单独验证，但不会进入兼容性基线。

## 后果

Codex 协议与进程所有权现在只有一个版本门禁，而产品适配器仍能自行选择持久化与 UI 行为。共享包存在时，首个 provider 的行为保持不变；除非可选 provider 被启用并实际调用，DeepSeek 原生路径不会加载或启动 Codex。当前共享层只是基础，续接与 UI 投影仍属于分阶段产品工作，不会被误报为已完成。
