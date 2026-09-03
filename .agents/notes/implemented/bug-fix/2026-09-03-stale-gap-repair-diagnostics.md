# Agent Note: Stale gap-repair diagnostics

Status: implemented

English | [中文](2026-09-03-stale-gap-repair-diagnostics.zh.md)

## Problem

A browser reload can supersede an in-flight Session gap-repair history request. The old request then rejects with a transport error such as `Failed to fetch`. `doOpen` already drops both success and failure from a superseded connection generation, but `repairGap` logged every rejection. Web regression tripwires therefore reported an expected dead-connection outcome as an active gap-repair failure.

## Decision

`repairGap` captures the Session `openGeneration` at launch, as before. Its catch path now reports an error only while that generation is still current and the Session window is still open. A full `resync()` increments the generation before opening the replacement window, so a rejection from the replaced connection is silent. A failure belonging to the current open window remains visible and keeps the existing fail-soft behavior.

The generation fence changes diagnostics only. The stale repair still installs no history, `resync()` remains the sole owner of the replacement window, and the `finally` path still clears the stitching guard.

## Testing

The Session runtime suite retains the active-generation failure case, which must log and clear stitching. A new deferred-request case starts gap repair, supersedes it with a full resync, rejects the old request with `Failed to fetch`, and proves both that no error is logged and that only the fresh generation's history is installed. The built web regression remains the end-to-end witness for intentional page reloads.

## Consequences

- Intentional reconnect or reload no longer produces a false gap-repair warning from the connection generation it replaced.
- A real repair failure on the current open connection remains observable.
- The browser tripwire stays strict; no warning text is filtered or acknowledged more broadly.
