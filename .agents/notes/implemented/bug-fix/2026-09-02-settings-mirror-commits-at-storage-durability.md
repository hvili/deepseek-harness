# Agent Note: Land the settings in-memory mirror at the storage commit point

Status: implemented

English | [中文](2026-09-02-settings-mirror-commits-at-storage-durability.zh.md)

## Problem

The settings base class updated the in-memory mirror — `this.document[ns]`, what `settings.get()` serves — only after the provider's `persist()` promise resolved. The file provider's persist path writes the document atomically, then releases the cross-process writer lock by unlinking the lock file inside `withFileLock`'s `finally`; the promise therefore resolves one unlink after the section is already durable on disk. Every index render inlines the theme preference read from that mirror into the boot script (`webserver/index-inject` in ui-theme), so a page reload served between the rename and the lock unlink rendered with the stale preference: a user who just chose dark saw the loading page paint light. The settings-chrome boot-theme case ("uses the persisted dark preference while plugins are still loading") polls `settings.yaml` on disk and reloads immediately, which is why it failed intermittently — roughly once per full-suite run — while single-file reruns usually passed.

## Decision

`SettingsProvider.persist` now receives an idempotent `commit` callback, and the base `write()` lands the mirror inside it: the document swap, the revision bump, and the `settings/updated` emission all happen when the provider first holds the section durably. A fallback call after the persist promise resolves keeps providers that never invoke the callback on their old timing, so the abstract's contract is: call `commit` when storage holds the section, or the base class commits after `persist` resolves. `FileSettingsProvider.persistSection` invokes `commit()` immediately after `writeFileAtomic` — the rename that makes the section durable — before the writer-lock unlink. A unit test with a provider whose storage commits strictly before its persist promise settles pins the new ordering and the fallback's idempotence.

## Alternatives considered

**Relax the test to await the mirror before reloading.** The white flash is user-visible product behavior, not a test defect; waiting in the test would certify the race instead of closing it.

**Read the settings file or await a flush in the index render.** Every index render would pay a synchronous file read, and the render path would duplicate the provider's parse/format logic. The mirror exists to serve reads; synchronizing it with storage fixes every consumer of `settings.get()` at once.

**Move the mirror update before `persist` entirely.** The mirror must never lead storage: a write that fails persisting would have already published a value no reader could ever observe again after a restart.

## Consequences

The mirror and the durable file can no longer disagree across the rename-to-unlink window: a reader served off either source sees the same section. `settings/updated` listeners now run while the file provider's writer lock still exists, inside the shared operation chain — a listener that writes again enqueues behind the current operation exactly as before, and the chain is a promise queue, not a synchronous mutex, so no re-entrant write can deadlock it. Providers that ignore the callback (the memory provider and the test doubles) keep their original timing, documented on the abstract method. The settings-chrome boot-theme case passed three consecutive full-file runs (9/9 each) after failing intermittently on every prior full-suite run.
