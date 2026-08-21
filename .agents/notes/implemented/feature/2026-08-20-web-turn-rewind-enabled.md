# Agent Note: Web Turn Rewind enabled

Status: implemented

English | [中文](2026-08-20-web-turn-rewind-enabled.zh.md)

## Decision

The `web-app` bundle now overrides the base `turn-rewind` row from `disabled: true` to `disabled: false`. The Change Ledger service, `/turn-rewind` HTTP endpoint, and the per-message rewind action are therefore part of the shipped Web profile while headless/base profiles keep the feature off.

## Consequences

Web users can create turn restore points, preview path-level drift, restore files, and continue from a forked session without editing profile overlays. The original session log is never truncated; restore always writes a rescue point before mutation. Persistence and recovery behavior remain owned by the `@deepseek-ai/dsh-turn-rewind` package.

## Verification

Composition tests and the browser E2E verify the web profile mounts the plugin and the rewind dialog can restore a real Git worktree.
