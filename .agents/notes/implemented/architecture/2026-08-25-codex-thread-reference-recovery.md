# Agent Note: Codex thread reference recovery

Status: implemented

English | [中文](2026-08-25-codex-thread-reference-recovery.zh.md)

## Problem

The one-shot Codex provider creates an ephemeral thread and discards its id with the process. A later stateful consumer needs an external identity that survives DSH restart without treating the Codex project database as DSH-owned data.

## Decision

`dsh-subagent-codex/thread-state` owns a versioned `CodexThreadReference` and the narrow stable `thread/start` and `thread/resume` client operations. The reference is appended once as the required, log-only `codex/thread-reference` Session event. It carries only the opaque Codex id. A persistent start requires `ephemeral: false`; resume requires the returned non-ephemeral id to match the stored value. Recovery rejects duplicate, malformed, and unsupported reference records.

The one-shot provider does not call this API. A future execution adapter must explicitly compose it with turn lifecycle and policy mapping.

## Alternatives considered

**Persist the Codex project database.** Rejected because it duplicates an upstream-owned store and makes DSH responsible for its migrations and credentials.

**Put the id in Session header metadata.** Rejected because an append-only event makes the attachment auditable, replayable, and impossible to overwrite silently.

**Reuse ephemeral threads.** Rejected because an ephemeral identity cannot establish a restart guarantee.

## Consequences

DSH now has a small, strict state model that can be written and recovered through existing persistence backends. It does not make the existing provider stateful and deliberately leaves output, item, usage, approval, and UI projection to later work.
