# Agent Note：持久化计划批准标记

状态：已实现

[English](2026-08-20-durable-plan-approval.md) | 中文

## 决策

`exit_plan_mode` 现在会在获得用户明确批准后、离开 plan mode 前，立即追加一个仅存在于日志中的 `plan/approved` 事件。事件保存计划的首个 Markdown 标题和完整已批准计划 Markdown。`foldApprovedPlan(events)` 返回最近一次已批准计划；`plan` 会话投影新增可选的 `approved` 值。

## 影响

批准不再需要从 `tool/result` 文本中推断。恢复、fork、回放和审阅界面都能重建“用户批准了哪个计划”。该标记不进入模型对话表面；plan mode 仍作为引导约束实施过程，沙箱与批准策略仍独立执行限制。

## 验证

plan-mode 单元测试与投影测试覆盖事件追加、fold 和投影值。聚焦包测试通过；持久化目录已重新生成。
