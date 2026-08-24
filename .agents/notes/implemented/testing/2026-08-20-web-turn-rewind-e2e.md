# Agent Note: Web Turn Rewind browser E2E

Status: implemented

English | [中文](2026-08-20-web-turn-rewind-e2e.zh.md)

## Problem

The rewind action and its file-restore dialog were not covered end-to-end, so a regression in checkpoint, preview, or restore could ship silently.

## Decision

The Turn Rewind client now renders the full rewind action beside the existing edit-message action on every direct user message, restoring the file-restore dialog. A browser E2E covers the complete path in a real Git worktree: durable turn checkpoint before mutation, path-level preview, restore plus fork, rescue point creation, and original-session preservation. The client copy is localized through a self-contained dictionary keyed off the DSH locale plugin's `<html lang>` attribute, so English and Chinese pages use their own accessible names.

## Alternatives considered

Rejected: covering the client alone without a real Git worktree (misses the durable checkpoint/restore path) and relying on manual verification.

## Consequences

Web users can both edit a message and rewind project files from the same message action row. The E2E uses a project subdirectory so Change Ledger snapshots only the real worktree, not scaffold-internal harness homes. The child session is created through the official fork path when a prior completed turn exists, so fork lineage is persisted and recoverable.

## Verification

The `turn-rewind.e2e.ts` browser scenario passes: file reverts to the committed initial state, a rescue point and turn checkpoint are listed, the child session has `parentSession`, and the original session log retains all events. Focused plan-mode tests and host typecheck remain green.
