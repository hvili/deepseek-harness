# DSH 增强发行版治理

[English](README.md) | 中文

此目录管理叠加在官方 DeepSeek Harness 之上的产品专用策略。运行能力仍位于各 package 或外部增强工作区；此目录只包含升级列车、补丁清单和可机器检查的身份规则。

## 仓库职责

- `origin/master` 与官方标签是只读上游引用。
- `product/main` 是唯一用于组装可部署增强发行版的分支。
- `sync/<version>` 是临时分支，每次把一个官方 RC/Release 标签合入当前产品线。
- `feature/<name>` 承载一项可以独立审查的产品改动。
- `D:\DeepSeek\plugins` 是独立增强层仓库，拥有可选界面、运维和 Profile Bundle 能力。

[AI agent 任务包](agent-task-packages.md)为剩余的发行与恢复工作定义了隔离且可审查的交接单元。

可恢复起点是位于 `356faa8535c943c0bdebebd1f546724cd5f1b261` 的标签 `dsh-enhanced-baseline-2026-08-25`。此模型不重写历史。旧功能分支保留到产品分支通过构建和真实运行验证为止。

## 核心补丁清单

[`core-patches.json`](core-patches.json) 记录初始下游范围内的 77 个非合并提交，以及可恢复产品基线之后的每个运行时或构建提交。记录中的 `runtimeBaseline` 把 `cf14720d2e` 标识为单独审计的运行时补丁；每项记录受影响区域、一种处置分类、验证方式、上游状态和删除条件。允许的分类为：

- `minimal-core-patch`：当前公共扩展点无法承载，暂时留在 `Harness-src`。
- `migrate-to-enhancement-layer`：迁入 `D:\DeepSeek\plugins` 后再从产品分支删除。
- `upstream-candidate`：整理成对官方 DSH 也有价值的独立贡献。
- `retire-or-reprove`：除非升级列车复现出具体需求，否则删除。

`product:verify` 从 `HEAD` 的 Git 历史推导当前清单，并拒绝缺失的初始条目、重复条目、已删除条目，以及没有审计条目的运行时或构建提交。只修改产品治理元数据、配套双语文档、诊断脚本／测试或支持性笔记的提交，不属于推导出的运行时／构建集合，因此审计提交不会递归审计自身。新的运行时或构建补丁进入 `product/main` 后，必须由后续审计提交加入清单或替换已有条目。每次官方同步至少要删除、合并或重新证明一个保留条目。

本次改动合并后，把唯一外部计划文件 `D:\DeepSeek\P0执行规划.md` 的 `HEAD` 刷新为准确的合并提交；不要新建第二份计划文件，也不要记录合并前 worktree 的提交。

## 官方 RC/Release 升级列车

1. 确认 `product/main`、增强层仓库和已部署数据备份都处于干净状态，并可由标签或提交识别。
2. 获取官方标签，但不合并日常 `master`；随后从 `product/main` 创建 `sync/<version>`。
3. 在同步分支合并选定的官方标签。只在该分支解决冲突，并把从每个冲突得到的证据更新到 `core-patches.json`。
4. 运行受影响 package 测试、typecheck、build、制品验证、Profile `--dump-config`、Web E2E、重启恢复和 `pnpm run product:verify`。
5. Codex 依赖变化时，使用该 package 内的二进制重新生成稳定 app-server schema，并运行握手、恢复、审批、review、取消、异常协议和进程静默退出测试。
6. 所有必要检查通过后才能把同步分支合入 `product/main`。为产品结果创建标签；升级失败时保持已部署稳定标签不变。
7. 通过 `pnpm run product:diagnostics` 记录官方 DSH 提交、产品提交、增强层提交和 Codex 运行时版本。

升级列车不会自动推送、发布、部署或重启服务。这些操作仍需在本地验证后由操作者明确执行。
