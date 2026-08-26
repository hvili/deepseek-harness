# DSH enhanced distribution governance

English | [中文](README.zh.md)

This directory owns the product-only policy layered over official DeepSeek Harness. Runtime features remain in packages or in the external enhancement workspace; this directory contains only the release train, patch inventory, and machine-checkable identity rules.

## Repository roles

- `origin/master` and official tags are read-only upstream references.
- `product/main` is the only branch used to assemble a deployable enhanced distribution.
- `sync/<version>` is temporary and merges one official RC/Release tag into the current product line.
- `feature/<name>` carries one independently reviewable product change.
- `D:\DeepSeek\plugins` is the independent enhancement-layer repository and owns optional UI, operations, and Profile Bundle behavior.

[Agent task packages](agent-task-packages.md) define isolated, reviewable handoffs for the remaining distribution and recovery work.

The recoverable starting point is tag `dsh-enhanced-baseline-2026-08-25` at `356faa8535c943c0bdebebd1f546724cd5f1b261`. Rewriting history is not part of this model. The old feature branch remains recoverable until the product branch passes build and real runtime verification.

## Core patch inventory

[`core-patches.json`](core-patches.json) records the 77 non-merge commits in the initial downstream range and every runtime or build commit after the recoverable product baseline. The recorded `runtimeBaseline` identifies `cf14720d2e` as a separate audited runtime patch; each entry records affected areas, one disposition, verification, upstream status, and a deletion condition. The allowed dispositions are:

- `minimal-core-patch`: remains temporarily in `Harness-src` because current public seams cannot host it.
- `migrate-to-enhancement-layer`: moves to `D:\DeepSeek\plugins` before removal from the product branch.
- `upstream-candidate`: becomes an isolated contribution useful to official DSH.
- `retire-or-reprove`: is deleted unless a release-train comparison reproduces a concrete need.

`product:verify` derives the live inventory from Git at `HEAD` and rejects missing initial entries, duplicate entries, deleted entries, and runtime or build commits without an audit entry. Commits that change only product governance metadata, its paired documentation, diagnostic script/tests, or supporting notes are excluded from that derived runtime/build set, so an audit commit cannot recursively audit itself. A new runtime or build patch must be added in a follow-up audit commit or replace an existing entry. Every official sync must remove, merge, or re-prove at least one retained entry.

After this change is merged, refresh the single external plan file `D:\DeepSeek\P0执行规划.md` with the exact merge commit as its `HEAD`; do not create a second plan file or record the pre-merge worktree commit.

## Official RC/Release train

1. Confirm `product/main`, the enhancement repository, and the deployed data backup are clean and identified by tags or commits.
2. Fetch official tags without merging daily `master`, then create `sync/<version>` from `product/main`.
3. Merge the selected official tag on the sync branch. Resolve conflicts there and update `core-patches.json` with the evidence learned from each conflict.
4. Run affected package tests, typecheck, build, artifact verification, Profile `--dump-config`, Web E2E, restart recovery, and `pnpm run product:verify`.
5. When the Codex dependency changes, regenerate stable app-server schemas from that package-local binary and run handshake, resume, approval, review, cancellation, malformed-protocol, and process-quiescence tests.
6. Merge the sync branch into `product/main` only after all required checks pass. Tag the product result and keep the deployed stable tag unchanged on failure.
7. Record the official DSH commit, product commit, enhancement commit, and Codex runtime version from `pnpm run product:diagnostics`.

The release train does not push, publish, deploy, or restart a service automatically. Those remain explicit operator actions after local verification.
