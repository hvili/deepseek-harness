# Agent Note: Land the settings in-memory mirror at the storage commit point

Status: implemented

English | [中文](2026-09-02-settings-mirror-commits-at-storage-durability.zh.md)

## Problem

The settings base class updated the in-memory mirror — `this.document[ns]`, what `settings.get()` serves — only after the provider's `persist()` promise resolved. The file provider's persist path writes the document atomically, then releases the cross-process writer lock by unlinking the lock file inside `withFileLock`'s `finally`; the promise therefore resolves one unlink after the section is already durable on disk. Every index render inlines the theme preference read from that mirror into the boot script (`webserver/index-inject` in ui-theme), so a page reload served between the rename and the lock unlink rendered with the stale preference: a user who just chose dark saw the loading page paint light. The settings-chrome boot-theme case ("uses the persisted dark preference while plugins are still loading") polls `settings.yaml` on disk and reloads immediately, which is why it failed intermittently — roughly once per full-suite run — while single-file reruns usually passed.

## Decision

`SettingsProvider.persist` receives idempotent `commit` and `notify` callbacks. The base `write()` makes `commit` synchronously land the raw document, revision, and resolved mirror when the provider first holds the section durably; `notify` later dispatches `settings/document-updated`, watcher work, and `settings/updated` in the same order as the captured commit. A provider calls `notify` only after releasing any writer lock. The base class supplies both calls after the persist promise settles for providers that omit them, and its settlement path still notifies a durable commit before propagating a later rejection. `FileSettingsProvider.persistSection` calls `commit()` immediately after `writeFileAtomic` — the rename that makes the section durable — then calls `notify()` after `withFileLock` has removed the lock. Listener dispatch remains inside the file provider's operation chain, preserving notification order across its writes without extending cross-process lock ownership.

## Alternatives considered

**Relax the test to await the mirror before reloading.** The white flash is user-visible product behavior, not a test defect; waiting in the test would certify the race instead of closing it.

**Read the settings file or await a flush in the index render.** Every index render would pay a synchronous file read, and the render path would duplicate the provider's parse/format logic. The mirror exists to serve reads; synchronizing it with storage fixes every consumer of `settings.get()` at once.

**Move the mirror update before `persist` entirely.** The mirror must never lead storage: a write that fails persisting would have already published a value no reader could ever observe again after a restart.

## Consequences

The mirror and the durable file cannot disagree across the rename-to-unlink window: a reader served off either source sees the same section. Synchronous settings listeners run after the writer lock is gone, so their latency cannot make a second process exceed the lock's 2 s acquisition deadline. The same-process operation chain still holds notification order, and a listener that writes again queues behind the current operation without a synchronous mutex. Providers that ignore both callbacks keep their persist-resolution timing through the base fallback. Coverage pins mirror-before-settlement, lock-before-listener release, durable-commit rejection behavior, revision order, and notification idempotence.
