# Agent Note：增强发行版升级列车

Status: implemented

[English](2026-08-25-enhanced-distribution-release-train.md) | 中文

## 问题

产品开发与官方 DeepSeek Harness 发布各自前进。把所有产品能力持续放进一个长期 fork，会让每次同步官方的成本不断增加，无法区分哪些改动仍然必须修改核心，也无法用一组可检查的身份说明正在运行的源码、插件和 Codex 运行时。

## 决策

增强发行版使用三层所有权。`Harness-src` 在 `product/main` 上跟随官方 RC/Release 标签，只保留当前公共插件扩展点无法承载的改动。`D:\DeepSeek\plugins` 是独立的 Git 与 pnpm 工作区，承载产品插件和组合 Profile Bundle。包内 Codex app-server 保持为可选引擎；关闭 provider 时，DeepSeek 原生组合不发生变化。

初始范围内的每个非合并下游提交都记录在 `product/core-patches.json` 中，分类为临时核心补丁、迁移到增强层、上游候选，或必须删除/重新证明的改动。每项都记录验证方式、上游状态和删除条件。`sync/<version>` 分支每次只吸收一个官方 RC/Release 标签；产品身份检查和受影响回归检查通过前，同步结果不得进入 `product/main`。

诊断命令同时报告官方合并基线、产品提交、增强层提交、DSH 版本、Codex 运行时版本和补丁数量。升级列车只记录这些值，不自动推送、发布、部署或重启服务。

## 曾考虑的替代方案

**把所有定制继续放在官方源码 fork。** 否决，因为 DSH 已经提供插件、事件、Slot 和 Profile Bundle 扩展点，界面、运维和可选引擎仍留在核心只会扩大冲突范围。

**持续跟随官方 `master`。** 否决，因为日常集成会消耗验证成本，却不产出稳定发行版，并使故障来源更难判断。产品只跟随官方 RC/Release 标签。

**把完整 Codex Rust 运行时移植到 TypeScript。** 否决，因为版本化 app-server 已提供可复用执行协议。第二套实现会重复生命周期、schema 和安全工作，同时仍然需要 OpenAI 模型访问。

## 后果

产品可以同时获得官方更新、差异化能力和 Codex 复用，而不再把三者视为同一套强耦合代码。这会增加一个仓库和一条正式升级列车，但每层的审查与回滚范围都更小。核心补丁成为带明确删除条件的可见债务，不再是无限增长的 fork 身份。
