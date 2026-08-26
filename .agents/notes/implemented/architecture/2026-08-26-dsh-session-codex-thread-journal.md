# Agent Note: DSH Session journal for Codex thread identity

Status: implemented

English | [中文](2026-08-26-dsh-session-codex-thread-journal.zh.md)

## Decision

`DshSessionCodexThreadJournal` is the narrow production adapter between `CodexStatefulExecution` and a live DSH `Session`. The owning product must load or prepare the complete validated Session through its selected `SessionPersistence` backend first. `load()` reads the immutable Session event snapshot; writes call `Session.append()` and resolve only after `SessionStore.flush()` reports a real persistence listener and completes successfully.

The final `codex/thread-reference` is idempotent for the same opaque thread id and rejects a different id, unknown fields, or future versions. It never writes Session header metadata and never mirrors the Codex project database. The adapter is explicit and does not register a Profile provider or start an app-server by itself.

## Backend seam

JSONL and SQLite may consume the same DSH Session seam one mount at a time: the Session owner selects one `SessionPersistence` implementation, and this journal uses only the common `SessionStore.flush()` contract. The journal does not dual-write or make the two physical backends co-author one log.

## Recovery evidence

Durable fault tests model the flush boundary: a prepared record remains the only persisted record when accepted durability fails, so restart fails closed and requires reconciliation; prepared plus accepted evidence recovers the same thread id, permits one reference repair, and resumes rather than starting another thread. Codex 0.147.0 lacks an idempotency key and compensating deletion, so exactly-once thread creation is not promised.
