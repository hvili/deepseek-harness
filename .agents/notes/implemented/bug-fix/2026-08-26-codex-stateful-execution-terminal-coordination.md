# Agent Note: Codex stateful execution terminal coordination

Status: implemented

English | [中文](2026-08-26-codex-stateful-execution-terminal-coordination.zh.md)

## Problem

The stateful adapter previously waited only for `turn/completed`. A missing terminal notification could leave a fresh package-local app-server and its process tree alive indefinitely, and a failed best-effort interrupt could leave cancellation unresolved.

## Decision

`CodexStatefulExecution` now coordinates one first-wins terminal controller for completed turn, local abort, child settlement, input-stream end/close/error, output transport error, and malformed terminal notifications. Abort rejects immediately with a fixed safe error while the optional `turn/interrupt` request is observed without becoming a dependency of cancellation.

Every path closes the JSON-RPC wire, then uses the shared app-server disposal ladder and waits for whole-tree quiescence. Public failures carry only stable stage messages; raw stderr, paths, commands, credentials, and upstream error text are not attached.

## Scope boundary

This is an explicit stateful API fix. The one-shot Codex provider, its default-off registration, native DeepSeek Session assembly, tools, attachments, usage, review, approvals, and UI remain unchanged.

## Verification

The focused stateful execution tests cover batched completion, child exit and rejection, abort with failed interrupt, input close, output transport failure, malformed `turn/completed`, bounded settlement, and process-tree quiescence.
