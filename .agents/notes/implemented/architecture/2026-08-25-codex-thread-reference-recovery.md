# Agent Note: Codex thread reference recovery

Status: implemented

English | [中文](2026-08-25-codex-thread-reference-recovery.zh.md)

## Problem

The one-shot Codex provider creates an ephemeral thread and discards its id with the process. A later stateful consumer needs an external identity that survives DSH restart without treating the Codex project database as DSH-owned data.

## Decision

`dsh-subagent-codex/thread-state` owns versioned references, `codex/thread-start-wal`, and stable `thread/start`/`thread/resume` operations. The final reference is the one required, log-only `codex/thread-reference` event. Resume revalidates its literal version, opaque id, and keys, then requires the returned persistent id to match. Recovery rejects malformed, conflicting, duplicate, and unsupported records.

`CodexStatefulExecution` is the separate consumer. It starts a package-local app-server per turn, resumes the durable id, and waits for the full child tree after success, cancellation, or failure. The one-shot provider does not call this API.

## Durable start protocol

The Session owner appends `prepared(operationId)` before `thread/start`, then `accepted(operationId, threadId)` after observing the upstream id, and the final reference before `turn/start`. An observed id is never used before both durable writes resolve. Recovery completes an accepted record; a remaining prepared record fails closed and blocks automatic continuation.

## Alternatives considered

**Persist the Codex project database.** Rejected because it duplicates an upstream-owned store and makes DSH responsible for its migrations and credentials.

**Put the id in Session header metadata.** Rejected because an append-only event makes the attachment auditable, replayable, and impossible to overwrite silently.

**Reuse ephemeral threads.** Rejected because an ephemeral identity cannot establish a restart guarantee.

**Exactly-once `thread/start`.** Rejected as unattainable: 0.147.0 has no caller-supplied idempotency key, transaction token, or compensating deletion. A crash after upstream acceptance but before its response reaches DSH leaves an unresolved prepared record instead of silently creating a divergent conversation.

## Consequences

DSH provides an at-least-once observed-id protocol: observed upstream identities are journaled before use, while unobserved starts stop recovery. Fault injection pins an accepted-write failure. Item streams, usage, approval bridging, and UI projection remain outside this adapter.
