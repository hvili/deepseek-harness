# Agent Note: Cut completed markers from persistent shell fallback output

Status: implemented

English | [中文](2026-08-22-persistent-shell-fallback-marker-leak.zh.md)

## Problem

The persistent shell tools (bash and pwsh twins) detect completion by scanning the newest scrollback page for the per-call END marker, then extract the output between the START and END markers. A real PTY can settle the send (the prompt is back in the viewport) while the just-written marker lines are not yet visible to that newest-page read, so the loop takes the prompt-completed branch and `partialOutput` returns everything after the START marker — the internal `__DSH_PERSISTENT_*_END_<nonce>:<status>` line leaks into the model-facing result. Observed as an intermittent flake on the Windows web lane (the minimal-preset scenario drives two real persistent pwsh calls); the stub-backed package tests never reproduced it because their reads are synchronous.

## Decision

`partialOutput`'s start-marker branch now cuts the tail at a COMPLETED end marker — marker plus status digits on the next line — and carries that status as the exit code. The echoed wrapper source contains the marker spelling without digits, so an echo can never trigger the cut; only the real completion marker does. Both twins got the same cut (they are deliberate call-for-call mirrors), and each gained a stub mode whose offset-0 read reports only the prompt while the full scrollback already holds the finished command — the leak's exact shape, now regression-locked.

## Alternatives considered

**Fix the completion check instead (re-read until the marker is visible).** The check would need its own retry loop with no bound on how long retention lags the viewport; the cut makes any interleaving produce the same output as the completion path.

**Strip the marker in the result renderer.** The renderer sees a string, not the marker pair, so it cannot distinguish the internal marker from a command that legitimately prints it.

## Consequences

Whatever the retention timing, a finished command returns exactly its output plus exit status — identical to the completion path — and the timeout/abort paths keep their partial semantics (no completed marker present, nothing to cut). The stub mode documents the retention race in executable form for both twins.