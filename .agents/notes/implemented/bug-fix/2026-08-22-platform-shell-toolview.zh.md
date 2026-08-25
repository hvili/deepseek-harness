# Agent Note: Platform shell tool rows share terminal presentation

Status: implemented

[English](2026-08-22-platform-shell-toolview.md) | 中文

## 问题

已交付的 Windows 预设通过 `pwsh` 执行 shell 调用，但 Tool 所有的带键 view slot 只为 `bash` 注册了终端行。因此，尽管参数和结果使用同一终端卡片模型，Windows shell 调用仍会回退到通用工具渲染器。

## 决策

`bashToolviewSample` 同时为 `bash` 与 `pwsh` 注册 `BashRow`。共享行保留原有的终端解析、展开行为、无障碍状态与 `data-sample="bash"` 展示约定；现在仅让带键 slot 的选择也能识别平台 shell 名称。

Web 滚动契约在 Windows 上生成等价的 PowerShell fixture，其他平台仍使用 Bash fixture，因此两种已交付 shell 默认值都会覆盖实时终端路径。

## 考虑过的替代方案

- **将展示名改为 `pwsh`。** 组件和视觉约定覆盖 shell 终端调用；现有选择器与历史 Bash fixture 都依赖既有的 `bash` sample 标记。
- **注册单独的 PowerShell 组件。** 两种工具共享相同的参数形状、结果解析和交互模型；单独的渲染器会复制行为，却没有读者可见的差异。

## 后果

Windows `pwsh` 调用现在显示为终端卡片，而不是通用行。真正具有不同结果语义的新 shell 工具仍需自己的带键渲染器；本注册不会让终端卡片模型变成通用模型。

## 测试

`apps/web/tests/chat-scroll-contract.e2e.ts` 用原生 fixture 覆盖运行中与完成后的平台 shell 调用，并验证其终端卡片生命周期。官方构建后，完整的长聊天滚动套件通过。
