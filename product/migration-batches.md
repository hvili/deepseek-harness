# Evidence-based migration batches for the initial 77 product commits

English | [中文](migration-batches.zh.md)

This reference turns the initial downstream range into evidence-backed routing work; the machine-readable source is [migration-batches.json](migration-batches.json).

It is an analysis and task-splitting deliverable: it adds no runtime code, does not push, and does not rewrite Git history.

## Decision

The 77 commits are assigned a primary route after inspecting current symbols and paths, the official base, exact commit hunks, and existing plugin seams rather than commit subjects alone.

| Primary route | Count | Meaning |
|---|---:|---|
| official-covered-delete | 28 | Official runtime already covers the behavior, or the change is test/CI/release/hygiene support; delete after re-proof. |
| plugins | 17 | Move optional product behavior into D:/DeepSeek/plugins through Host service, Event, and Slot composition. |
| upstream | 29 | Isolate reusable runtime, protocol, portability, or test-harness behavior for official DSH. |
| minimal-core | 3 | Retain only the cross-package behavior that current public seams cannot yet carry. |

Six composite commits require hunk-level splitting before any delete: 1, 2, 3, 55, 58, and 59.

## Scope boundary

The audited range is pinned to b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261 and does not depend on a movable remote branch ref.

The Git check git rev-list --no-merges --reverse b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261 yields exactly 77 commits; the first 77 entries of core-patches.json match those hashes in order.

The current core-patches.json contains 88 entries. Eleven post-baseline runtime/build entries are recorded under scope.outOfScopeCurrentDelta in the JSON and are intentionally not classified here.

## Evidence method

Evidence IDs in the JSON are reusable, local, and reproducible; every item points to the IDs used for its official-coverage claim and carrier decision.

~~~powershell
git rev-parse b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git rev-parse 356faa8535c943c0bdebebd1f546724cd5f1b261
git rev-list --no-merges --count b150a551b8d465e31e418e1b2eaf5e79bbb7d28e..356faa8535c943c0bdebebd1f546724cd5f1b261
git show <commit> --format= --name-status
git diff <commit>^ <commit> -- <changed-path>
git grep -n <symbol> b150a551b8d465e31e418e1b2eaf5e79bbb7d28e -- <official-path>
rg -n <symbol> <current-path>
~~~

The official base already exposes Slot contracts such as conversation.session.header.actions, conversation.session.header.lineage, conversation.input.attachments, conversation.input.plan, and conversation.message.files, with registration guarded by ctx.slots.inject and ctx.slots.register.

The official base also exposes archiveSession and fork; it does not expose the product favorites/tags/removeArchivedSession API, generic FileAttachmentRef, plan/approved, apiRemotesReady, or the current pwsh/POSIX terminal state machine.

## Batch plan

Batches own disjoint commit sets. A shared package root is allowed only when the batch is restricted to the exact feature files or hunks named by its commits; composite commits stay with B8 until split.

| Batch | Commits | Directory scope | Prerequisites | Acceptance |
|---|---|---|---|---|
| B1 | 1–4 | client assembly/input, Host API, session/util recovery, workspace/vision, Turn Rewind pin | none | V-CORE |
| B2 | 7–18 | workspace state/RPC/client/UI and workspace Web tests | B1 | V-WORKSPACE |
| B3 | 19–24 | attachment, LLM, file intake, plan event and related Slots | B1 | V-FILE |
| B4 | 25–27, 29 | Turn Rewind submodule, Bundle row, Web E2E, host config | B1 | V-REWIND |
| B5 | 28, 30–40 | remotes, client runner, trajectory/tool/replay, persistent shell, Web tests | B4 only for rewind cases | V-WEB |
| B6 | 63–77 | terminal-bash, persistent shell tests, ACP/POSIX probes, SQLite test | none | V-TERMINAL |
| B7 | 41–54 | CI/release, package invariants, docs/catalogs, paired notes | none | V-CI |
| B8 | 5–6, 55–62 | validation fixtures/goldens plus mixed functional hunks | B1–B7 | V-MIXED |

B1 retains the smallest core while B2/B3/B4 extract optional or protocol-specific slices; B5 and B6 can be reviewed independently; B7 is deletion-only; B8 is the final split/re-proof gate.

## Verification and rollback

The exact commands for V-CORE, V-WORKSPACE, V-FILE, V-REWIND, V-WEB, V-TERMINAL, V-CI, V-MIXED, and V-DELETE are in verificationCatalog in the JSON and are referenced by every item.

P-MINIMAL retains the product patch until an official equivalent or public seam exists; restore it on any data, startup, recovery, composition, or artifact-identity regression.

P-PLUGIN deletes product wiring only after the external package/Bundle passes composition, legacy-data migration, restart, and rollback; restore the product pin/code without deleting user data on failure.

P-UPSTREAM deletes the product copy only after an equivalent official RC/Release, narrow tests, platform gate, and downstream regression pass; restore the patch on protocol, shell, or Web regression.

P-DELETE deletes test/snapshot/CI/release/hygiene-only material after the synchronized official owning gate passes; restore and reclassify on a concrete failure.

P-MIXED requires file/hunk separation and independent evidence for each route; keep the composite commit until every split runtime hunk is safe.

## Per-item audit index

The following index covers all 77 items. The JSON is normative: each item contains full commit hash, current code paths, bilingual finding, evidence references, carrier location, dependencies, verification reference, and deletion/rollback policy.

| # | Commit | Route | Current live path | Official evidence | Carrier | Dependencies | Verify | Delete/rollback |
|---:|---|---|---|---|---|---|---|---|
| 1 | f896232742ec | minimal-core | packages/client/ui-conversation/src/client/skeleton/InputBar.tsx | E-ARCHIVE-FORK, E-RECOVERY-GAP, E-FILE-GAP, E-MIXED | C-MIXED | none | V-CORE | P-MIXED |
| 2 | b31f07ccad4e | minimal-core | packages/util/session-backup/src/index.ts | E-RECOVERY-GAP, E-OPS, E-MIXED | C-MIXED | B1 own cross-cutting hold; B2 only if workspace metadata is inc… | V-CORE | P-MIXED |
| 3 | 2ee7e65155c0 | minimal-core | packages/client/runtime/src/client/contract/assembly.ts | E-SLOTS, E-MIXED | C-CORE | B1; B4 for the turn-rewind pin | V-CORE | P-MIXED |
| 4 | 1094f3dcd0c7 | plugins | plugins/dsh-turn-rewind (gitlink) | E-REWIND | C-TURN | B1 completes the transition hold | V-REWIND | P-PLUGIN |
| 5 | a39773ab237a | covered-delete | packages/client/connection tests/fixtures | E-VALIDATION, E-SLOTS | C-NONE | B5 official contract shape | V-DELETE | P-DELETE |
| 6 | 61f7d62e14ab | covered-delete | apps/web/tests archived-session restoration | E-ARCHIVE-FORK, E-VALIDATION | C-NONE | B1 archive lifecycle | V-DELETE | P-DELETE |
| 7 | 9299f003d19d | plugins | packages/workspace/workspace/src/spec.ts | E-WORKSPACE-GAP, E-ARCHITECTURE | C-WORKSPACE | B1; Host metadata service/RPC seam before product deletion | V-WORKSPACE | P-PLUGIN |
| 8 | 0937c1517e87 | plugins | packages/workspace/workspace/tests legacy favorite state | E-WORKSPACE-GAP, E-VALIDATION | C-WORKSPACE | 7; B2 metadata schema | V-WORKSPACE | P-PLUGIN |
| 9 | a46c55c430fc | plugins | packages/host/apiproxy/src/api/workspace.ts | E-WORKSPACE-GAP | C-WORKSPACE | 7; B2 Host metadata service/RPC | V-WORKSPACE | P-PLUGIN |
| 10 | 7040ed35a287 | plugins | packages/client/runtime/src/client/workspaces/manager.ts | E-WORKSPACE-GAP, E-SLOTS | C-WORKSPACE | 9; B2 public client metadata face | V-WORKSPACE | P-PLUGIN |
| 11 | 1575d17b8aed | plugins | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 10; B2 | V-WORKSPACE | P-PLUGIN |
| 12 | 55871ffb6c3a | plugins | packages/workspace/workspace/src/index.ts (archive/unarchive plus favorite preser… | E-WORKSPACE-GAP, E-ARCHIVE-FORK | C-WORKSPACE | 7; B1 archive lifecycle | V-WORKSPACE | P-PLUGIN |
| 13 | a4824c5d4214 | plugins | packages/workspace/workspace/src/spec.ts | E-WORKSPACE-GAP, E-ARCHITECTURE | C-WORKSPACE | B2 metadata schema; 7 for the same durable registry | V-WORKSPACE | P-PLUGIN |
| 14 | a761bfd0a9f2 | plugins | packages/host/apiproxy/src/api/workspace.ts | E-WORKSPACE-GAP | C-WORKSPACE | 13; B2 Host metadata service/RPC | V-WORKSPACE | P-PLUGIN |
| 15 | 587868b78768 | plugins | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 14; B2 Slot registration | V-WORKSPACE | P-PLUGIN |
| 16 | b70f2fe11dd5 | plugins | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx (tag search/filter) | E-SLOTS, E-WORKSPACE-GAP | C-WORKSPACE | 15; B2 tag projection | V-WORKSPACE | P-PLUGIN |
| 17 | 090c2eed235e | plugins | packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx | E-ARCHIVE-FORK, E-SLOTS | C-WORKSPACE | B1 fork lifecycle; B2 Slot registration | V-WORKSPACE | P-PLUGIN |
| 18 | 771d9403eb06 | plugins | apps/web/tests durable session metadata | E-WORKSPACE-GAP, E-VALIDATION | C-WORKSPACE | 7-17; B2 | V-WORKSPACE | P-PLUGIN |
| 19 | 1c1255636c3c | upstream | packages/attachment/attachment/src/types.ts | E-FILE-GAP | C-UPSTREAM-FILE | B1 InputBar/file intake seam; none for official attachment pack… | V-FILE | P-UPSTREAM |
| 20 | 58a3b3cf8fb7 | upstream | packages/llm/llm/src/types.ts | E-FILE-GAP | C-UPSTREAM-FILE | 19 | V-FILE | P-UPSTREAM |
| 21 | 47036e69676c | upstream | packages/host/apiproxy/src/api-proxy.ts | E-FILE-GAP | C-UPSTREAM-FILE | 19; 20 | V-FILE | P-UPSTREAM |
| 22 | 8082af0dec49 | upstream | packages/host/apiproxy/src/file-intake.ts | E-FILE-GAP, E-ARCHITECTURE | C-UPSTREAM-FILE | 19; 21 | V-FILE | P-UPSTREAM |
| 23 | f3a229a5946d | upstream | packages/client/ui-attachment/src/client/MessageFiles.tsx | E-FILE-GAP, E-SLOTS | C-UPSTREAM-FILE | 19-22; B3 official Slot contract | V-FILE | P-UPSTREAM |
| 24 | cb3952160811 | upstream | packages/core/session/src/known-event-types.ts | E-PLAN-GAP, E-SLOTS | C-UPSTREAM-PLAN | B1 session persistence contract | V-FILE | P-UPSTREAM |
| 25 | b0be2c95bc94 | plugins | packages/bundle/web-app/cordis.patch.yml | E-REWIND | C-TURN | B1; D:/DeepSeek/plugins/dsh-turn-rewind package | V-REWIND | P-PLUGIN |
| 26 | b9ada5f1059e | plugins | plugins/dsh-turn-rewind/src/client/index.tsx | E-REWIND, E-SLOTS | C-TURN | 25; B1 recovery/changeLedger | V-REWIND | P-PLUGIN |
| 27 | b8d3f706ac34 | plugins | apps/web/tests per-message rewind/localized UI | E-REWIND, E-VALIDATION | C-TURN | 26 | V-REWIND | P-PLUGIN |
| 28 | 8870a36e4234 | upstream | packages/client/connection/src/client/fixture.ts | E-SLOTS, E-VALIDATION | C-UPSTREAM-WEB | B4 only for rewind-related trajectory cases | V-WEB | P-UPSTREAM |
| 29 | bc310947f202 | plugins | plugins/dsh-turn-rewind (gitlink) | E-REWIND | C-TURN | 25-27 | V-REWIND | P-PLUGIN |
| 30 | 94cba2007906 | upstream | packages/api/remotes/src/client/index.ts | E-REMOTE | C-UPSTREAM-REMOTE | none | V-WEB | P-UPSTREAM |
| 31 | 471128b175bc | upstream | packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx | E-TERMINAL, E-VALIDATION | C-UPSTREAM-WEB | B6 terminal behavior for live shell assumptions | V-WEB | P-UPSTREAM |
| 32 | ee8ff15db0b5 | upstream | packages/test-support/llm-replay/src/index.ts | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | B6 live shell contract | V-WEB | P-UPSTREAM |
| 33 | 68b0f57ede5e | upstream | packages/test-support/llm-replay/src/index.ts | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32 | V-WEB | P-UPSTREAM |
| 34 | 65cb462bd303 | upstream | apps/web/tests background-job-list e2e | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32 | V-WEB | P-UPSTREAM |
| 35 | 26c77b99dd5b | upstream | apps/web/tests composition/continuous-chat e2e | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 32; 33 | V-WEB | P-UPSTREAM |
| 36 | 79527ca349be | upstream | apps/web/tests snapshots/goldens | E-REWIND, E-VALIDATION | C-UPSTREAM-WEB | B4; 31-35 | V-WEB | P-UPSTREAM |
| 37 | 50c53d1c362a | upstream | packages/shell/tool-bash-persistent/src/index.ts | E-SHELL | C-UPSTREAM-SHELL | none | V-TERMINAL | P-UPSTREAM |
| 38 | e597eb94320c | upstream | apps/web/tests Windows lane/scaffold | E-VALIDATION, E-TERMINAL | C-UPSTREAM-WEB | 31; B6 live shell contract | V-WEB | P-UPSTREAM |
| 39 | a3a8bda54111 | upstream | packages/shell/tool-bash-persistent/src/index.ts | E-SHELL | C-UPSTREAM-SHELL | 37 | V-TERMINAL | P-UPSTREAM |
| 40 | e59d1f08f56e | covered-delete | packages/client/ui-settings-plugins/tests/apply.client.spec.ts | E-ARCHIVE-FORK, E-VALIDATION | C-NONE | B1 archive UI gate | V-DELETE | P-DELETE |
| 41 | fbbbce2898ad | covered-delete | packages/*/package.json version metadata | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 42 | a8615f26aba8 | covered-delete | .github/workflows/issue-lifecycle.yml | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 43 | 95ddc54f3a54 | covered-delete | .github/issue-management | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 44 | 4a12393e1b2c | covered-delete | .github/issue-management | E-VALIDATION | C-OFFICIAL-CI | 43 | V-CI | P-DELETE |
| 45 | 1d7b4e3c0a07 | covered-delete | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | B4 | V-CI | P-DELETE |
| 46 | e1294f12fe2c | covered-delete | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | 45 | V-CI | P-DELETE |
| 47 | 25ef8bc313e0 | covered-delete | .github/workflows/release.yml | E-REWIND, E-VALIDATION | C-OFFICIAL-CI | 46 | V-CI | P-DELETE |
| 48 | 2bce0e9041a6 | covered-delete | scripts/release | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 49 | 92ff569b4281 | covered-delete | .github/workflows | E-VALIDATION, E-REWIND | C-OFFICIAL-CI | B4 | V-CI | P-DELETE |
| 50 | fc8e821b8dc2 | covered-delete | .github/workflows | E-VALIDATION, E-REWIND | C-OFFICIAL-CI | 49 | V-CI | P-DELETE |
| 51 | 3b2e1f38e871 | covered-delete | .github/workflows | E-VALIDATION | C-OFFICIAL-CI | none | V-CI | P-DELETE |
| 52 | b871381ac453 | covered-delete | docs/config-catalog.md | E-VALIDATION | C-OFFICIAL-CI | 51 | V-CI | P-DELETE |
| 53 | c9b7a6d3a249 | covered-delete | docs and paired notes | E-VALIDATION | C-OFFICIAL-CI | 52; B3 docs if generated catalogs are refreshed | V-CI | P-DELETE |
| 54 | 38aa24356463 | covered-delete | .github/workflows | E-VALIDATION | C-OFFICIAL-CI | 42-53 | V-CI | P-DELETE |
| 55 | 3ff2c3e9d5ac | upstream | packages/attachment/attachment-local/src/store.ts | E-MIXED, E-FILE-GAP, E-RECOVERY-GAP | C-MIXED | B1; B3; B7 | V-MIXED | P-MIXED |
| 56 | 5b419bf621a6 | covered-delete | packages/client/ui-settings-general tests | E-VALIDATION | C-NONE | B1-B3 feature contracts | V-DELETE | P-DELETE |
| 57 | e018b347dac4 | covered-delete | examples/acp-agent/tests snapshots | E-VALIDATION | C-NONE | B5/B6 test behavior | V-DELETE | P-DELETE |
| 58 | fd416f131918 | upstream | packages/client/runtime/src/client/sessions/manager.ts | E-MIXED, E-TERMINAL, E-ARCHIVE-FORK | C-MIXED | B1; B5; B6 | V-MIXED | P-MIXED |
| 59 | 9d5e2eecf46e | upstream | packages/plan/plan-mode/src/index.ts | E-MIXED, E-FILE-GAP, E-PLAN-GAP, E-SHELL | C-MIXED | B3; B5; B6 | V-MIXED | P-MIXED |
| 60 | 2f4d056c5cd0 | covered-delete | apps/web/tests diagnostics/message-actions snapshots | E-VALIDATION, E-ARCHIVE-FORK | C-NONE | B1; B5 | V-DELETE | P-DELETE |
| 61 | 5175af13931d | covered-delete | apps/web/tests | E-VALIDATION | C-NONE | B5; B6 | V-DELETE | P-DELETE |
| 62 | f32ac67f7e02 | covered-delete | apps/web/tests | E-VALIDATION, E-TERMINAL | C-NONE | B6 | V-DELETE | P-DELETE |
| 63 | a4a4ab2a22af | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | none | V-TERMINAL | P-UPSTREAM |
| 64 | 9879413ed801 | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 63 | V-TERMINAL | P-UPSTREAM |
| 65 | fcce6a97ee4d | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 64 | V-TERMINAL | P-UPSTREAM |
| 66 | 6337676b12bb | covered-delete | apps/web/tests | E-VALIDATION, E-TERMINAL | C-NONE | 63-65 | V-TERMINAL | P-DELETE |
| 67 | 88c7dc1b785b | upstream | packages/terminal/terminal-bash/src/session.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 65 | V-TERMINAL | P-UPSTREAM |
| 68 | af46061e48fa | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 67 | V-TERMINAL | P-UPSTREAM |
| 69 | fb5408cd1f58 | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 68 | V-TERMINAL | P-UPSTREAM |
| 70 | ab4c5c4a913f | covered-delete | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 68; 69 | V-TERMINAL | P-DELETE |
| 71 | 21901fac52d4 | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 69 | V-TERMINAL | P-UPSTREAM |
| 72 | 1c8de938770b | covered-delete | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 71 | V-TERMINAL | P-DELETE |
| 73 | 2770debaff29 | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL, E-VALIDATION | C-UPSTREAM-TERMINAL | 71 | V-TERMINAL | P-UPSTREAM |
| 74 | a6b78b7bfede | covered-delete | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 73 | V-TERMINAL | P-DELETE |
| 75 | 7f4d57063c6f | upstream | packages/terminal/terminal-bash/src/index.ts | E-TERMINAL | C-UPSTREAM-TERMINAL | 73; 74 | V-TERMINAL | P-UPSTREAM |
| 76 | 0d1b4d150526 | covered-delete | packages/terminal/terminal-bash/tests | E-VALIDATION, E-TERMINAL | C-NONE | 75 | V-TERMINAL | P-DELETE |
| 77 | c6d6a8e7e5d5 | covered-delete | examples/acp-agent/tests POSIX PTY launch probe | E-VALIDATION, E-TERMINAL | C-NONE | 70; 76 | V-TERMINAL | P-DELETE |
