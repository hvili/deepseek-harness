# Agent Note：Fork 托管 CI 容量与包形态策略

Status: implemented

[English](2026-08-24-fork-hosted-validation-profile.md) | 中文

## 问题

Fork 验证可通过 `DSH_CI_RUNNER_FALLBACK_LINUX` 和 `DSH_CI_RUNNER_FALLBACK_WINDOWS`，把仓库的 16 核运行器标签替换为标准 GitHub 托管运行器。在这些较小的机器上保留企业运行器的 worker 与分区数量，会让进程启动和轮询夹具在资源竞争下超时。Publint 还会把两种有意的包形态报告为警告：npm 负载刻意闭合但提供公开 `./src/*` 开发导出的包，以及从 `./client` 导出为 `lib/client.js` 的浏览器 loader factory。

## 决策

当 fallback runner 变量非空时，CI 保留全部验证门禁，但采用较小的资源配置：Linux static 使用 3 个 gate；coverage 使用 2 个 worker、2 个分区和 2 个 gate；consumers 使用 3 个 gate、2 个 Oxlint/Publint/浏览器 worker，以及 6 个快照 worker；原生 Windows 使用 2 个 worker、分区、gate 和 Publint worker。企业与自托管默认值保持不变。

发布检查器只过滤位于 `exports["./src/*"]` 的 `EXPORTS_GLOB_NO_MATCHED_FILES`，以及位于 `exports["./client"].default` 且精确产物为 `./lib/client.js` 的 `FILE_INVALID_FORMAT`。其他 Publint 诊断仍然可见，并保留原有严重级别。包负载闭合检查与相对导入验证仍针对精确的 `files` 视图运行。

## 曾考虑的替代方案

**提高所有超时。** 否决，因为这会隐藏资源竞争，在不约束进程并发的情况下延长真实故障的反馈时间。

**全局忽略 Publint 诊断代码。** 否决，因为相同诊断在其他导出路径上代表真实发布缺陷。因此例外必须绑定到两个由项目拥有的精确形态。

## 后果

Fork CI 以并行度换取确定性完成，不减少覆盖率或契约清单。新增发布例外必须具有精确路径的回归测试；不允许按诊断代码做宽泛抑制。
