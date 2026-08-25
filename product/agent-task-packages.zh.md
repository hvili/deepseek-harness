# 增强发行版 AI agent 任务包

[English](agent-task-packages.md) | 中文

以下独立任务包可交给外部 AI agent。每个 agent 必须在单独命名的 worktree 中工作，不得 push、部署、重启服务、重写历史，也不得修改当前启用的 Codex provider。

## 任务包 A —— 目标 Profile 的发行验证

**结果：** 为 `D:\DeepSeek\plugins` bundle 增加可重复的安装、升级、卸载和 `--dump-config` 验证，目标为一次性 Profile。

**范围：** 仅限 `D:\DeepSeek\plugins` 的脚本、工作区测试和 bundle 文档。使用临时 Profile 与测试自有的 home；保护所有用户 Profile，绝不切换运行中的服务。

**验收：** 脚本记录 bundle 与 DSH 身份，证明默认 Codex provider 仍为关闭状态，验证升级后只保留预期的一个 bundle 版本，并证明卸载只移除测试自有制品。

**检查：** 聚焦测试、插件工作区构建、pack dry run，以及真实的一次性 Profile 命令序列。Windows symlink 限制须单独报告。

## 任务包 B —— Web 启动和数据副本恢复门禁

**结果：** 创建非破坏性的 Web 启动冒烟测试，以及针对所给 Session 数据副本的重启恢复测试。

**范围：** 仅限 Harness 测试／support 和产品脚本。测试必须创建新的 home 和数据副本；不得打开、修改、删除在线用户数据根目录，也不得重启服务。

**验收：** Web 进程到达 health／启动边界，复制的会话可在新进程挂载后重新打开，测试断言源数据集没有写入。

**检查：** 聚焦测试、源与副本的 checksum 或不可变时间戳证据，以及测试后的进程树完全停稳。

## 任务包 C —— Codex 有状态执行适配器设计 spike

**结果：** 产出一份提案和一次性协议 spike，消费 `codex/thread-reference`，在全新挂载后执行第二个 turn。

**范围：** 新建隔离的 experimental package 或 test-only harness。不得在生产 Profile 注册、改 UI、实现审批、复制 Codex 数据或替换一次性 provider。

**验收：** 回环 app-server fixture 证明非临时 `thread/start`、持久引用 append、全新进程 `thread/resume`、精确 id 校验、取消清理和失败关闭。提案必须给出生产 seam 与全部延后映射。

**检查：** 聚焦协议／重启测试、typecheck、schema 指纹门禁，以及 `proposed/` 下的 Agent Note。
