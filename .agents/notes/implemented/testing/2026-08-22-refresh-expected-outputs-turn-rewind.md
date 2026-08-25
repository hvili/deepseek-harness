# Agent Note: Refresh goldens past the turn-rewind portal and pin capture races

Status: implemented

English | [中文](2026-08-22-refresh-expected-outputs-turn-rewind.zh.md)

## Problem

Turn-rewind entered the shipped Web profile (08-21) after the aria goldens' last corpus refresh (08-10), so every golden showing a direct user message lacks the two portal buttons (Edit, Return to before sending) on BOTH platforms — the "many ARIA snapshot failures" cluster. Beneath it sat four independent defects the sweep exposed: the Windows backslash fold in `normalizeAria` also rewrote the YAML encoding of CONTENT backslashes (a JSON-escaped quote renders as three backslashes and a quote), corrupting two refreshed goldens; the details-lifecycle test reached the sidebar group treeitem by parent count, which workspace tags broke by adding two wrapper spans; the message-actions no-Edit guard matched the portal's 'Edit this message' as a substring; and two goldens raced Chromium event timing (a hover tooltip, a fork row's Running→Completed transition).

## Decision

Refresh the stale corpus through the sanctioned writer (`DSH_SNAPSHOT=refresh` per file, replay-verified immediately after — a golden both runs agree on is stable), then fix the exposed defects at their roots: narrow the fold's regex to refuse a following quote or backslash so path separators fold while recorded arguments survive; address the tree row by role (`getByRole('treeitem').filter({ hasText })`) instead of DOM depth; scope the Edit guard with `exact: true`; strip tooltip nodes from the queue editing capture (hover chrome is not that golden's contract — the boundary events that show it are timing-dependent); and poll the fork row to its settled Completed label before capturing. One scenario stays failing on Windows by design: goal-multi-turn-actions replays model-authored POSIX commands (`ls -la`, `python3`) that genuinely fail under pwsh, so its golden keeps the POSIX spelling — baking the Failed rows would assert a divergence POSIX never produces.

## Alternatives considered

**Script-insert the two button lines into every golden.** Requires identifying user-message Copy rows across 36 varied files by structure; an assistant-row misidentification corrupts a golden silently, and the sweep's other diff axes would still need handwork.

**Fold 'Failed Bash' to 'Bash' on win32.** Falsifies execution state: bash-abort-row legitimately asserts Failed rows from a recorded abort, and the fold would erase real failures everywhere.

**Re-enable bash in the Windows preset for these tests.** Widening the product composition to pass tests inverts the dependency (and was explicitly out of scope).

## Consequences

Thirty-five goldens now carry the portal buttons (and the other post-08-10 drift the refresh absorbed: the mid-steer ask-question waiting row, composer context stats); every refreshed file passed refresh plus at least one replay run on Windows, and the normalization keeps the written goldens POSIX-compatible — the contamination scan of every added line found no platform spelling. The fold's lookahead is the load-bearing guard: any future golden whose content carries backslashes exercises it, which the bash-abort-row and cordis-tool-round goldens now do. The goal-multi-turn-actions failure is the remaining, reported Windows gap: replayed tool calls execute live, and recorded POSIX command syntax is not PowerShell syntax — the tool-name map renames the tool, never the command.
