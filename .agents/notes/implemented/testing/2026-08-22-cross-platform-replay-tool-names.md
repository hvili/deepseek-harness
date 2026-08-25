# Agent Note: Replay recorded shell tool names through a platform map

Status: implemented

English | [中文](2026-08-22-cross-platform-replay-tool-names.zh.md)

## Problem

Web e2e replay fixtures record real POSIX sessions, so their shell calls carry the tool name `bash`. The Windows standard preset disables bash and ships `pwsh`, and a replayed call therefore names a tool the live toolset cannot dispatch: the call never enters the approval flow (`[data-approval-key]` waits time out), the durable log never records a shell result, and goldens diverge between the recording platform and Windows. Fixing this per test — rewriting fixture lines, shimming dispatch, or maintaining a second Windows recording — multiplies fragile per-file logic while POSIX still needs the bash recording for its own coverage.

## Decision

`installLlmReplay` accepts an optional `toolNames` map (recorded name → live name) and applies it to every replayed entry — the primary script, the override sidecar, and fork-child scripts alike — rewriting the name on the first named `tool-call-delta` and on the `block-end` tool-call block while the recorded arguments stream byte-for-byte unchanged. Names absent from the map pass through untouched, and `hang` entries (which carry no tool calls) skip the pass entirely.

The Web test scaffold derives the map from one exported constant, `liveShellToolName` (`pwsh` on win32, `bash` elsewhere): Windows passes `{ bash: 'pwsh' }` to the replay, POSIX passes no map and replays bash exactly as recorded. Tests that dispatch or assert the live shell tool import the constant instead of hardcoding either name. The scaffold's aria normalization collapses the rendered `Pwsh` title to `Bash` on Windows so one committed golden serves both platforms, and direct-execution assertions normalize PowerShell's CRLF line endings to the POSIX spelling.

## Alternatives considered

**Edit each committed session.jsonl to `pwsh`.** The committed log is a record of a real POSIX session; rewriting it either drops bash from the scenario's coverage or forks a per-platform fixture set that must be re-recorded in lockstep.

**Re-enable bash in the Windows preset for tests.** The preset's toolset is the product under test; widening it to make tests pass inverts the dependency and stops exercising the shipped Windows composition.

**Rewrite tool names inside each e2e test.** Every scenario would carry its own dispatch shim, and a fixture or entry-kind change would break them one file at a time; the mapping belongs to the replay layer that owns entry streaming.

**Record a second Windows fixture per scenario.** Doubles recording and maintenance for behavior (approval, rendering, queueing) that is platform-neutral; only the shell tool's name differs between platforms.

## Consequences

One recorded fixture now replays on every supported platform, dispatched under the live shell tool's real name with the recorded arguments unchanged; POSIX coverage keeps exercising bash verbatim. The mapping is unit-covered at the replay layer — named delta, block-end, unmapped pass-through, override sidecar, and child scripts — so an entry kind that bypasses the rename fails those tests loudly rather than silently regressing cross-platform replay. Golden aria snapshots stay single per scenario at the cost of a position-anchored title normalization in `normalizeAria` that must recognize every place the shell title renders. Windows-only tests that execute the shell directly still translate command syntax themselves: the map renames the tool, not the command string.
