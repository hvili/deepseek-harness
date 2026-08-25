# Enhanced-distribution agent task packages

English | [中文](agent-task-packages.zh.md)

These independent packages are ready for external AI agents. Each agent works in its own named worktree and must not push, deploy, restart services, rewrite history, or alter the active Codex provider.

## Package A — target-profile distribution verification

**Outcome:** add repeatable install, upgrade, uninstall, and `--dump-config` verification for `D:\DeepSeek\plugins` bundles against a disposable Profile.

**Scope:** `D:\DeepSeek\plugins` scripts, workspace tests, and bundle documentation only. Use a temporary profile and test-owned home directory; preserve all user profiles and never switch a running service.

**Acceptance:** the script records bundle and DSH identities, proves default Codex provider remains disabled, verifies upgrade leaves one expected bundle version, and proves uninstall removes only test-owned artifacts.

**Checks:** focused tests, plugin workspace build, pack dry run, and the real disposable-profile command sequence. Report any Windows symlink limitation separately.

## Package B — Web startup and copied-data recovery gate

**Outcome:** create a non-destructive Web launch smoke test and a restart recovery test against a copy of supplied session data.

**Scope:** Harness test/support and product scripts only. The test must allocate a fresh home and data copy; it must never open, mutate, or delete the live user data root or restart a service.

**Acceptance:** the Web process reaches its health/start boundary, copied sessions reopen after a fresh process mount, and the test asserts no writes were made to the source dataset.

**Checks:** focused test, source-vs-copy checksum or immutable timestamp evidence, and process-tree quiescence after the test.

## Package C — Codex stateful execution adapter design spike

**Outcome:** produce a proposal and a throwaway protocol spike that consumes `codex/thread-reference` to run a second turn after a fresh mount.

**Scope:** a new isolated experimental package or test-only harness. Do not register it in a production Profile, change UI, implement approvals, copy Codex data, or replace the one-shot provider.

**Acceptance:** a loopback app-server fixture proves non-ephemeral `thread/start`, durable reference append, fresh-process `thread/resume`, exact-id validation, cancellation cleanup, and failure-closed behavior. The proposal names the production seam and all deferred mappings.

**Checks:** focused protocol/restart tests, typecheck, schema fingerprint gate, and an Agent Note under `proposed/`.
