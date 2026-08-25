# Agent Note: Shared Codex app-server adapter

Status: implemented

English | [中文](2026-08-25-shared-codex-app-server-adapter.zh.md)

## Problem

The first Codex provider owned package resolution, the app-server handshake,
protocol transport, and process cleanup inside a one-shot product adapter. Adding
continuation, review, approval UI, and other Codex-backed consumers there would
duplicate runtime ownership and make protocol upgrades depend on one provider's
policy.

## Decision

`@deepseek-ai/dsh-codex-app-server` is the shared integration seam. It owns the
exact `@openai/codex@0.147.0` dependency, package-local command construction,
stable schema generation, JSON-RPC initialization, and process-tree quiescence.
It exposes product-selected request and notification methods after the required
handshake without opting into experimental APIs.

The stable JSON Schema output is regenerated in tests and compared with a
tracked file-count and aggregate SHA-256 fingerprint. A Codex dependency upgrade
therefore requires an explicit schema review before consumers can pass. The
existing `dsh-subagent-codex` provider remains a compatibility consumer and owns
its one-process, ephemeral-thread, unattended-approval, result-selection, and
safe-diagnostic policy.

Future stateful consumers may use stable thread resume, fork, list, review, diff,
usage, approval, skill, hook, and MCP methods from this seam. They will retain a
Codex thread id only as an external execution reference in DSH-owned state;
Codex's project database is not copied into DSH.

## Alternatives considered

**Keep the integration provider-private.** Rejected because each new consumer
would need to repeat executable resolution, lifecycle, and version gates.

**Import the complete Codex Rust runtime.** Rejected because the official
app-server already owns execution semantics and publishes a versioned protocol.
Porting it would enlarge the fork and duplicate upstream security work.

**Enable experimental methods by default.** Rejected because the enhanced
distribution needs a predictable RC/Release upgrade train. Experimental methods
may be evaluated separately but do not enter the compatibility baseline.

## Consequences

Codex protocol and process ownership now have one version gate while product
adapters remain free to choose persistence and UI behavior. The initial provider
keeps its behavior when the shared package is present, and the DeepSeek-native
path does not load or start Codex unless the optional provider is enabled and
called. The current shared layer is a foundation; continuation and UI projection
remain staged product work rather than claimed completed behavior.
