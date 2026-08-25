# Agent Note：Web 启用 Turn Rewind

状态：已实现

[English](2026-08-20-web-turn-rewind-enabled.md) | 中文

## 问题

Turn rewind 仅以禁用的基础行发布，因此 Web 配置无法挂载 Change Ledger 服务、HTTP 端点和回退操作。

## 决策

`web-app` bundle 现在将 base 的 `turn-rewind` 行从 `disabled: true` 覆盖为 `disabled: false`。因此 Change Ledger 服务、`/turn-rewind` HTTP 端点和每条消息下的 rewind 动作都会随 Web profile 交付；headless/base profile 仍保持关闭。

## 备选方案

已否决：在基础包中为每个配置启用该行（改变无头行为）以及发布一个重复基础行的单独仅 Web 补丁层。

## 影响

Web 用户无需编辑 profile overlay 即可创建 turn 恢复点、预览路径级漂移、恢复文件，并从 fork 出的会话继续。原会话日志永不被截断；每次恢复前都会先写救援点。持久化与恢复行为仍由 `@deepseek-ai/dsh-turn-rewind` 包负责。

## 验证

组合测试与浏览器 E2E 验证 Web profile 已挂载该插件，且 rewind 对话框能在真实 Git worktree 上恢复文件。
