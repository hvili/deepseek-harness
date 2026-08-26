# 初始 77 个产品提交的证据化迁移批次

[English](migration-batches.md) | 中文

本文档把初始下游范围编排为有证据支撑的迁移工作；机器可读源文件是 [migration-batches.json](migration-batches.json)。

这是分析与任务拆分产物：不新增运行时代码，不 push，也不重写 Git 历史。

## 决策

77 个提交的主处置来自当前符号和路径、官方基线、精确 commit hunk 及现有插件 seam 的交叉核对，而不是只看 commit subject。

| 主处置 | 数量 | 含义 |
|---|---:|---|
| official-covered-delete | 28 | 官方运行时已覆盖，或提交只是测试/CI/发布/卫生支持；复证后删除。 |
| plugins | 17 | 通过 Host service、Event 和 Slot 组合，把可选产品能力迁入 D:/DeepSeek/plugins。 |
| upstream | 29 | 把可复用的运行时、协议、可移植性或测试 harness 行为整理为官方 DSH 贡献。 |
| minimal-core | 3 | 只保留当前公共 seam 还不能承载的跨包行为。 |

6 个组合提交必须先按 hunk 拆分，才能执行删除：1、2、3、55、58、59。

## 范围边界

审计范围固定为 b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261，不依赖可移动的远端分支引用。

Git 命令 git rev-list --no-merges --reverse b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261 精确得到 77 个提交；core-patches.json 的前 77 条按顺序匹配这些 hash。

当前 core-patches.json 有 88 条记录；基线之后的 11 条运行时/构建记录放在 JSON 的 scope.outOfScopeCurrentDelta 中，明确不在本矩阵内分类。

## 证据方法

JSON 中的证据 ID 可复用、仅依赖本地仓库且可复现；每项都指向其官方覆盖判断和承载判断所用的证据 ID。

~~~powershell
git rev-parse b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git rev-parse 356faa8535c943c0bdebebd1f546724cd5f1b261
git rev-list --no-merges --count b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261
git show <commit> --format= --name-status
git diff <commit>^ <commit> -- <changed-path>
git grep -n <symbol> b150a551b8d465e31e418e1b2eaf5e79bbb7d28e -- <official-path>
rg -n <symbol> <current-path>
~~~

官方基线已经提供 conversation.session.header.actions、conversation.session.header.lineage、conversation.input.attachments、conversation.input.plan、conversation.message.files 等 Slot contract，并要求通过 ctx.slots.inject 和 ctx.slots.register 注册。

官方基线也提供 archiveSession 和 fork；但没有产品 favorites/tags/removeArchivedSession API、generic FileAttachmentRef、plan/approved、apiRemotesReady 或当前 pwsh/POSIX terminal 状态机。

## 批次计划

各批次拥有互不重复的提交集合；同一 package 根目录只有在批次限制到其提交明确的精确文件或 hunk 时才可复用；组合提交在拆分前归 B8 管理。

| 批次 | 提交 | 目录范围 | 前置依赖 | 验收 |
|---|---|---|---|---|
| B1 | 1–4 | client assembly/input、Host API、session/util recovery、workspace/vision、Turn Rewind pin | 无 | V-CORE |
| B2 | 7–18 | workspace state/RPC/client/UI 及 workspace Web tests | B1 | V-WORKSPACE |
| B3 | 19–24 | attachment、LLM、file intake、plan event 及相关 Slot | B1 | V-FILE |
| B4 | 25–27、29 | Turn Rewind submodule、Bundle row、Web E2E、Host config | B1 | V-REWIND |
| B5 | 28、30–40 | remotes、client runner、trajectory/tool/replay、persistent shell、Web tests | 仅 rewind case 依赖 B4 | V-WEB |
| B6 | 63–77 | terminal-bash、persistent shell tests、ACP/POSIX probes、SQLite test | 无 | V-TERMINAL |
| B7 | 41–54 | CI/release、package invariant、文档/catalog、配套 notes | 无 | V-CI |
| B8 | 5–6、55–62 | validation fixture/golden 及混合功能 hunk | B1–B7 | V-MIXED |

B1 保留最小核心，B2/B3/B4 抽取可选或协议特定切片；B5 与 B6 可独立审查；B7 只做删除复证；B8 是最终拆分/复证门。

## 验证与回滚

V-CORE、V-WORKSPACE、V-FILE、V-REWIND、V-WEB、V-TERMINAL、V-CI、V-MIXED 和 V-DELETE 的完整命令在 JSON 的 verificationCatalog 中，每项通过引用关联。

P-MINIMAL：在官方出现等价实现或公开 seam 前保留产品补丁；出现数据、启动、恢复、组合或制品身份回归时恢复它。

P-PLUGIN：外部 package/Bundle 通过组合、旧数据迁移、重启和回滚验证后才删除产品 wiring；失败时恢复 product pin/代码，不删除用户数据。

P-UPSTREAM：等价实现进入官方 RC/Release、窄测、平台 gate 和下游回归通过后才删除产品副本；协议、shell 或 Web 回归时恢复补丁。

P-DELETE：同步官方 owning gate 在无该提交时通过后删除测试/快照/CI/发布/卫生材料；出现具体失败则恢复并重新分类。

P-MIXED：必须按文件/hunk 分离并为每条路由独立取证；所有拆出的运行时 hunk 安全前保留组合提交。

## 逐项审计索引

以下索引覆盖全部 77 项。JSON 是规范来源：每项包含完整 commit hash、当前代码路径、双语结论、证据引用、承载位置、依赖、验证引用和删除/回滚策略。

| 序号 | Commit | 处置 | 当前生效路径 | 官方证据 | 承载 | 依赖 | 验证 | 删除/回滚 |
|---:|---|---|---|---|---|---|---|---|
| 1 | f896232742ec | 最小核心 | packages/client/ui-conversation/src/client/skeleton/InputBar.tsx | E-ARCHIVE-FORK, E-RECOVERY-GAP, E-FILE-GAP, E-MIXED | C-MIXED | none | V-CORE | P-MIXED |
| 2 | b31f07ccad4e | 最小核心 | packages/util/session-backup/src/index.ts | E-RECOVERY-GAP, E-OPS, E-MIXED | C-MIXED | B1 own cross-cutting hold; B2 only if workspace metadata is inc… | V-CORE | P-MIXED |
| 3 | 2ee7e65155c0 | 最小核心 | packages/client/runtime/src/client/contract/assembly.ts | E-SLOTS, E-MIXED | C-CORE | B1; B4 for the turn-rewind pin | V-CORE | P-MIXED |
| 4 | 1094f3dcd0c7 | 插件迁移 | plugins/dsh-turn-rewind (gitlink) | E-REWIND | C-TURN | B1 completes the transition hold | V-REWIND | P-PLUGIN |
| 5 | a39773ab237a | 已覆盖-删除 | packages/client/connection tests/fixtures | E-VALIDATION, E-SLOTS | C-NONE | B5 official contract shape | V-DELETE | P-DELETE |
| 6 | 61f7d62e14ab | 已覆盖-删除 | apps/web/tests archived-session restoration | E-ARCHIVE-FORK, E-VALIDATION | C-NONE | B1 archive lifecycle | V-DELETE | P-DELETE |
| 7 | 9299f003d19d | 插件迁移 | packages/workspace/workspace/src/spec.ts | E-WORKSPACE-GAP, E-ARCHITECTURE | C-WORKSPACE | B1; Host metadata service/RPC seam before product deletion | V-WORKSPACE | P-PLUGIN |
| 8 | 0937c1517e87 | 插件迁移 | packages/workspace/workspace/tests legacy favorite state | E-WORKSPACE-GAP, E-VALIDATION | C-WORKSPACE | 7; B2 metadata schema | V-WORKSPACE | P-PLUGIN |
| 9 | a46c55c430fc | 插件迁移 | packages/host/apiproxy/src/api/workspace.ts | E-WORKSPACE-GAP | C-WORKSPACE | 7; B2 Host metadata service/RPC | V-WORKSPACE | P-PLUGIN |
| 10 | 7040ed35a287 | 插件迁移 | packages/client/runtime/src/client/workspaces/manager.ts | E-WORKSPACE-GAP, E-SLOTS | C-WORKSPACE | 9; B2 public client metadata face | V-WORKSPACE | P-PLUGIN |
| 11 | 1575d17b8aed | 插件迁移 | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 10; B2 | V-WORKSPACE | P-PLUGIN |
| 12 | 55871ffb6c3a | 插件迁移 | packages/workspace/workspace/src/index.ts (archive/unarchive plus favorite preser… | E-WORKSPACE-GAP, E-ARCHIVE-FORK | C-WORKSPACE | 7; B1 archive lifecycle | V-WORKSPACE | P-PLUGIN |
| 13 | a4824c5d4214 | 插件迁移 | packages/workspace/workspace/src/spec.ts | E-WORKSPACE-GAP, E-ARCHITECTURE | C-WORKSPACE | B2 metadata schema; 7 for the same durable registry | V-WORKSPACE | P-PLUGIN |
| 14 | a761bfd0a9f2 | 插件迁移 | packages/host/apiproxy/src/api/workspace.ts | E-WORKSPACE-GAP | C-WORKSPACE | 13; B2 Host metadata service/RPC | V-WORKSPACE | P-PLUGIN |
| 15 | 587868b78768 | 插件迁移 | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 14; B2 Slot registration | V-WORKSPACE | P-PLUGIN |
| 16 | b70f2fe11dd5 | 插件迁移 | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx (tag search/filter) | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 15; B2 tag projection | V-WORKSPACE | P-PLUGIN |
| 17 | 090c2eed235e | 插件迁移 | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-ARCHIVE-FORK, E-SLOTS | C-WORKSPACE | B1 fork lifecycle; B2 Slot registration | V-WORKSPACE | P-PLUGIN |
| 18 | 771d9403eb06 | 插件迁移 | apps/web/tests durable session metadata | E-WORKSPACE-GAP, E-VALIDATION | C-WORKSPACE | 7-17; B2 | V-WORKSPACE | P-PLUGIN |
| 19 | 1c1255636c3c | 上游候选 | packages/attachment/attachment/src/types.ts | E-FILE-GAP | C-UPSTREAM-FILE | B1 InputBar/file intake seam; none for official attachment pack… | V-FILE | P-UPSTREAM |
| 20 | 58a3b3cf8fb7 | 上游候选 | packages/llm/llm/src/types.ts | E-FILE-GAP | C-UPSTREAM-FILE | 19 | V-FILE | P-UPSTREAM |
| 21 | 47036e69676c | 上游候选 | packages/host/apiproxy/src/api-proxy.ts | E-FILE-GAP | C-UPSTREAM-FILE | 19; 20 | V-FILE | P-UPSTREAM |
| 22 | 8082af0dec49 | 上游候选 | packages/host/apiproxy/src/file-intake.ts | E-FILE-GAP, E-ARCHITECTURE | C-UPSTREAM-FILE | 19; 21 | V-FILE | P-UPSTREAM |
| 23 | f3a229a5946d | 上游候选 | packages/client/ui-attachment/src/client/MessageFiles.tsx | E-FILE-GAP, E-SLOTS | C-UPSTREAM-FILE | 19-22; B3 official Slot contract | V-FILE | P-UPSTREAM |
| 24 | cb3952160811 | 上游候选 | packages/core/session/src/known-event-types.ts | E-PLAN-GAP, E-SLOTS | C-UPSTREAM-PLAN | B1 session persistence contract | V-FILE | P-UPSTREAM |
| 25 | b0be2c95bc94 | 插件迁移 | packages/bundle/web-app/cordis.patch.yml | E-REWIND | C-TURN | B1; D:/DeepSeek/plugins/dsh-turn-rewind package | V-REWIND | P-PLUGIN |
| 26 | b9ada5f1059e | 插件迁移 | plugins/dsh-turn-rewind/src/client/index.tsx | E-REWIND, E-SLOTS | C-TURN | 25; B1 recovery/changeLedger | V-REWIND | P-PLUGIN |
| 27 | b8d3f706ac34 | 插件迁移 | apps/web/tests per-message rewind/localized UI | E-REWIND, E-VALIDATION | C-TURN | 26 | V-REWIND | P-PLUGIN |
| 28 | 8870a36e4234 | 上游候选 | packages/client/connection/src/client/fixture.ts | E-SLOTS, E-VALIDATION | C-UPSTREAM-WEB | B4 only for rewind-related trajectory cases | V-WEB | P-UPSTREAM |
| 29 | bc310947f202 | 插件迁移 | plugins/dsh-turn-rewind (gitlink) | E-REWIND | C-TURN | 25-27 | V-REWIND | P-PLUGIN |
| 30 | 94cba2007906 | 上游候选 | packages/api/remotes/src/client/index.ts | E-REMOTE | C-UPSTREAM-REMOTE | none | V-WEB | P-UPSTREAM |
| 31 | 471128b175bc | 上游候选 | packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx | E-TERMINAL, E-VALIDATION | C-UPSTREAM-WEB | B6 terminal behavior for live shell assumptions | V-WEB | P-UPSTREAM |
| 32 | ee8ff15db0b5 | 上游候选 | packages/test-support/llm-replay/src/index.ts | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | B6 live shell contract | V-WEB | P-UPSTREAM |
| 33 | 68b0f57ede5e | 上游候选 | packages/test-support/llm-replay/src/index.ts | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32 | V-WEB | P-UPSTREAM |
| 34 | 65cb462bd303 | 上游候选 | apps/web/tests background-job-list e2e | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32 | V-WEB | P-UPSTREAM |
| 35 | 26c77b99dd5b | 上游候选 | apps/web/tests composition/continuous-chat e2e | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32; 33 | V-WEB | P-UPSTREAM |
| 36 | 79527ca349be | 上游候选 | apps/web/tests snapshots/goldens | E-REWIND, E-VALIDATION | C-UPSTREAM-WEB | B4; 31-35 | V-WEB | P-UPSTREAM |
| 37 | 50c53d1c362a | 上游候选 | packages/shell/tool-bash-persistent/src/index.ts | E-SHELL | C-UPSTREAM-SHELL | none | V-TERMINAL | P-UPSTREAM |
| 38 | e597eb94320c | 上游候选 | apps/web/tests Windows lane/scaffold | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 31; B6 live shell contract | V-WEB | P-UPSTREAM |
| 39 | a3a8bda54111 | 上游候选 | packages/shell/tool-bash-persistent/src/index.ts | E-SHELL | C-UPSTREAM-SHELL | 37 | V-TERMINAL | P-UPSTREAM |
| 40 | e59d1f08f56e | 已覆盖-删除 | packages/client/ui-settings-plugins/tests/apply.client.spec.ts | E-ARCHIVE-FORK, E-VALIDATION | C-NONE | B1 archive UI gate | V-DELETE | P-DELETE |
| 41 | fbbbce2898ad | 已覆盖-删除 | packages/*/package.json version metadata | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 42 | a8615f26aba8 | 已覆盖-删除 | .github/workflows/issue-lifecycle.yml | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 43 | 95ddc54f3a54 | 已覆盖-删除 | .github/issue-management | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 44 | 4a12393e1b2c | 已覆盖-删除 | .github/issue-management | E-VALIDATION | C-OFFICIAL-CI | 43 | V-CI | P-DELETE |
| 45 | 1d7b4e3c0a07 | 已覆盖-删除 | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | B4 | V-CI | P-DELETE |
| 46 | e1294f12fe2c | 已覆盖-删除 | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | 45 | V-CI | P-DELETE |
| 47 | 25ef8bc313e0 | 已覆盖-删除 | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | 46 | V-CI | P-DELETE |
| 48 | 2bce0e9041a6 | 已覆盖-删除 | scripts/release | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 49 | 92ff569b4281 | 已覆盖-删除 | .github/workflows | E-VALIDATION, E-REWIND | C-OFFICIAL-CI | B4 | V-CI | P-DELETE |
| 50 | fc8e821b8dc2 | 已覆盖-删除 | .github/workflows | E-VALIDATION, E-REWIND | C-OFFICIAL-CI | 49 | V-CI | P-DELETE |
| 51 | 3b2e1f38e871 | 已覆盖-删除 | .github/workflows | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 52 | b871381ac453 | 已覆盖-删除 | docs/config-catalog.md | E-VALIDATION | C-OFFICIAL-CI | 51 | V-CI | P-DELETE |
| 53 | c9b7a6d3a249 | 已覆盖-删除 | docs and paired notes | E-VALIDATION | C-OFFICIAL-CI | 52; B3 docs if generated catalogs are refreshed | V-CI | P-DELETE |
| 54 | 38aa24356463 | 已覆盖-删除 | .github/workflows | E-VALIDATION | C-OFFICIAL-CI | 42-53 | V-CI | P-DELETE |
| 55 | 3ff2c3e9d5ac | 上游候选 | packages/attachment/attachment-local/src/store.ts | E-MIXED, E-FILE-GAP, E-RECOVERY-GAP | C-MIXED | B1; B3; B7 | V-MIXED | P-MIXED |
| 56 | 5b419bf621a6 | 已覆盖-删除 | packages/client/ui-settings-general tests | E-VALIDATION | C-NONE | B1-B3 feature contracts | V-DELETE | P-DELETE |
| 57 | e018b347dac4 | 已覆盖-删除 | examples/acp-agent/tests snapshots | E-VALIDATION | C-NONE | B5/B6 test behavior | V-DELETE | P-DELETE |
| 58 | fd416f131918 | 上游候选 | packages/client/runtime/src/client/sessions/manager.ts | E-MIXED, E-TERMINAL, E-ARCHIVE-FORK | C-MIXED | B1; B5; B6 | V-MIXED | P-MIXED |
| 59 | 9d5e2eecf46e | 上游候选 | packages/plan/plan-mode/src/index.ts | E-MIXED, E-FILE-GAP, E-PLAN-GAP, E-SHELL | C-MIXED | B3; B5; B6 | V-MIXED | P-MIXED |
| 60 | 2f4d056c5cd0 | 已覆盖-删除 | apps/web/tests diagnostics/message-actions snapshots | E-VALIDATION, E-ARCHIVE-FORK | C-NONE | B1; B5 | V-DELETE | P-DELETE |
| 61 | 5175af13931d | 已覆盖-删除 | apps/web/tests | E-VALIDATION | C-NONE | B5; B6 | V-DELETE | P-DELETE |
| 62 | f32ac67f7e02 | 已覆盖-删除 | apps/web/tests | E-VALIDATION, E-TERMINAL | C-NONE | B6 | V-DELETE | P-DELETE |
| 63 | a4a4ab2a22af | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | none | V-TERMINAL | P-UPSTREAM |
| 64 | 9879413ed801 | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 63 | V-TERMINAL | P-UPSTREAM |
| 65 | fcce6a97ee4d | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 64 | V-TERMINAL | P-UPSTREAM |
| 66 | 6337676b12bb | 已覆盖-删除 | apps/web/tests | E-VALIDATION, E-TERMINAL | C-NONE | 63-65 | V-TERMINAL | P-DELETE |
| 67 | 88c7dc1b785b | 上游候选 | packages/terminal/terminal-bash/src/session.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 65 | V-TERMINAL | P-UPSTREAM |
| 68 | af46061e48fa | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 67 | V-TERMINAL | P-UPSTREAM |
| 69 | fb5408cd1f58 | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 68 | V-TERMINAL | P-UPSTREAM |
| 70 | ab4c5c4a913f | 已覆盖-删除 | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 68; 69 | V-TERMINAL | P-DELETE |
| 71 | 21901fac52d4 | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 69 | V-TERMINAL | P-UPSTREAM |
| 72 | 1c8de938770b | 已覆盖-删除 | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 71 | V-TERMINAL | P-DELETE |
| 73 | 2770debaff29 | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL, E-VALIDATION | C-UPSTREAM-TERMINAL | 71 | V-TERMINAL | P-UPSTREAM |
| 74 | a6b78b7bfede | 已覆盖-删除 | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 73 | V-TERMINAL | P-DELETE |
| 75 | 7f4d57063c6f | 上游候选 | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 73; 74 | V-TERMINAL | P-UPSTREAM |
| 76 | 0d1b4d150526 | 已覆盖-删除 | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 75 | V-TERMINAL | P-DELETE |
| 77 | c6d6a8e7e5d5 | 已覆盖-删除 | examples/acp-agent/tests POSIX PTY launch probe | E-VALIDATION, E-TERMINAL | C-NONE | 70; 76 | V-TERMINAL | P-DELETE |
