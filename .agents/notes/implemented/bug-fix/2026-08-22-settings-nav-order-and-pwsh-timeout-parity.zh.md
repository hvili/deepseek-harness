# Agent Note: 设置导航顺序的确定性与 pwsh 沙箱超时对齐

Status: implemented

[English](2026-08-22-settings-nav-order-and-pwsh-timeout-parity.md) | 中文

## 问题

Windows web lane 暴露出两处平台孪生漂移。已归档对话设置 section 声明了 `order: 20`，与 agent-presets 的 `order: 20` 相撞；设置外壳做稳定排序，并列时回退到注册顺序，而注册顺序跟随插件激活时机——同一台机器上导航顺序在两次运行间翻转（一次捕获里已归档对话在 Agent 预设之前，下一次在其后）。另外，基础组合给 bash-sandbox 行钉了 `timeoutMs: 60000`，却从未配置 pwsh-sandbox 孪生，于是 plugin-config 卡片暴露的 shipped 默认在 Windows 上读出 120000、POSIX 上是 60000。

## 决策

已归档对话移到 `order: 25`——独立的 order 让排序成为全序，导航不再依赖激活时机，位置也落在组合顺序本就暗示的预设行之后。pwsh-sandbox 行补上其 bash 孪生已有的 `timeoutMs: 60000` 配置。陈旧的 golden（归档功能合入前录制的设置对话框，加两份 turn-rewind 漏网）以 `DSH_SNAPSHOT=refresh` 统一刷新；diff 审查确认只有新的导航按钮、新的视觉代理卡片与 rewind 操作进入了 golden。

## 备选方案

**在测试 lane 里归一化导航顺序。** 掩盖真实竞态：翻转在每个平台都依赖时序，并非 Windows 特性。

**测试里按平台推导期望超时。** 会把漂移固化为预期行为；沙箱执行器是有意的镜像，组合欠它们同一策略。

## 后果

一份设置拼写同时服务两个平台，plugin-config 卡片"本部署搭载的组合默认"在任何地方都是同一个数字。未来的设置 section 必须选用未被占用的 order 值——注册处的行内注释现在说明了并列为何不稳定。