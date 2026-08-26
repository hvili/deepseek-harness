# Agent Note: DSH Session journal for Codex thread identity

Status: implemented

English | [中文](2026-08-26-dsh-session-codex-thread-journal.zh.md)

## Problem

Stateful Codex execution needs to carry one external thread identity across fresh DSH Session mounts, but an in-memory journal cannot prove that a reference or WAL record survived a restart. Without a real append-and-flush adapter, an accepted upstream thread could be lost or a conflicting reference could be silently replaced, and JSONL and SQLite could drift into separate persistence paths.

## Decision

`DshSessionCodexThreadJournal` is the narrow production adapter between `CodexStatefulExecution` and a live DSH `Session`. The owning product must load or prepare the complete validated Session through its selected `SessionPersistence` backend first. `load()` reads the immutable Session event snapshot; writes call `Session.append()` and resolve only after `SessionStore.flush()` reports a real persistence listener and completes successfully.

The final `codex/thread-reference` is idempotent for the same opaque thread id and rejects a different id, unknown fields, or future versions. It never writes Session header metadata and never mirrors the Codex project database. The adapter is explicit and does not register a Profile provider or start an app-server by itself.

## Backend seam

JSONL and SQLite may consume the same DSH Session seam one mount at a time: the Session owner selects one `SessionPersistence` implementation, and this journal uses only the common `SessionStore.flush()` contract. The journal does not dual-write or make the two physical backends co-author one log.

## Recovery evidence

Durable fault tests model the flush boundary: a prepared record remains the only persisted record when accepted durability fails, so restart fails closed and requires reconciliation; prepared plus accepted evidence recovers the same thread id, permits one reference repair, and resumes rather than starting another thread. Codex 0.147.0 lacks an idempotency key and compensating deletion, so exactly-once thread creation is not promised.

## Alternatives considered

- **Copy the Codex project database or history into DSH** — rejected because it duplicates an upstream-owned store and creates an unsupported synchronization contract.
- **Store the thread id in Session header metadata** — rejected because a header field could be silently overwritten without append-only conflict evidence.
- **Dual-write JSONL and SQLite** — rejected because one DSH Session mount must have one selected persistence owner; the common Session seam is the compatibility boundary, not two co-authors.
- **Resolve an append before the flush barrier** — rejected because an in-memory append is not restart evidence and would make accepted-write failure tests unsound.

## Consequences

The production adapter is narrow and explicit: the Session owner selects one persistence backend, provides a complete validated Session, and gets durability from `SessionStore.flush()`. Same-id reference retries are safe, conflicts and future or unknown payloads fail closed, and the test-only fault-injection harness remains evidence rather than a user-facing capability. Prepared-only recovery requires human reconciliation; accepted recovery can repair exactly one missing reference and resume the observed thread. Codex 0.147.0 still prevents an exactly-once guarantee, so the adapter does not promise one.
