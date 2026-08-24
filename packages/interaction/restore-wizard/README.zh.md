# @deepseek-ai/restore-wizard

[English](README.md) | 中文

通过 `ctx.sandbox`（只读预览）与 `ctx.approval`（变更前操作者确认）暴露真实会话恢复的 Cordis 服务。

## 模型体验

这里没有任何内容到达模型请求；此包驱动沙箱受限的恢复预览与批准流程。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 向导按备份整体恢复；备份内按路径选择与跨会话合并待办。
