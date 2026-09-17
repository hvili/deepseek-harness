# Agent Note: Pwsh startup requires the marker prompt

Status: implemented

English | [中文](2026-09-17-pwsh-startup-marker-readiness.zh.md)

## Problem

Real POSIX pwsh startup failed in every CI lane that runs it. Linux settled the first startup send through the exact stdin-wait tier on a boot-phase read and published a motd holding only the echoed setup source; macOS has no exact tier, so the empty follow-up send loop spun on `inferred_idle` until the absolute deadline. Windows pwsh shows the same race locally. The echoed setup proves the line reached the tty, yet the prompt function never rendered its marker: a line submitted before pwsh's interactive loop starts can be consumed by the shell's own startup terminal probing and never executed. The previous fix retained the last non-empty viewport but still broke the startup loop on a bare `stdin_read`, so an early settle published a shell whose prompt was never installed.

## Decision

[Startup](../../../../packages/terminal/terminal-bash/src/index.ts) now treats the owned prompt marker as the only pwsh startup completion evidence: `LocalPtySession.promptAcknowledged` reports that the marker and its printable `dsh> ` tail were observed since spawn, and the startup loop breaks only on that flag. A settled send without the marker resubmits the idempotent setup; from the third unacknowledged settle, a submitted empty line cancels a partially consumed line before the next resubmission. After the marker, startup waits for the output stream to go quiet: queued resubmissions keep re-rendering the marker prompt, and the terminal's own echo of the acknowledging line can arrive as a late burst, so a send started immediately would settle on leftover startup output instead of its own command. The single absolute deadline bounds the loop and the quiet window, and shell exit or deadline still reject the open. Echoed setup source keeps containing the printable prompt, which is why the evidence comes from the sanitizer's marker tracking rather than the viewport text.

The Windows-only real-shell expectation now derives `Set-Location /`'s destination per platform, because the drive root — not the POSIX root — is where Windows pwsh resolves it.

## Alternatives considered

**Widen the timeout or retry blindly.** Rejected: the deadline is not the awaited state; without marker evidence every retry settles the same way and the loop only reaches the deadline.

**Treat the default `PS` prompt or echoed setup text as readiness.** Rejected: printed prompt text proves rendering, not that submitted input executes; the echoed source contains the printable prompt literal before the shell is ready.

**Delay the first submission until the shell prints something.** Rejected: no observable separates "prompt printed" from "interactive loop consuming input", and a resubmission converges regardless of when the shell becomes ready.

## Consequences

POSIX startup pays one extra settle cycle in the common case; a degraded cycle adds an `inferred_idle` wait per attempt, still inside one deadline. The real-shell suite stays CI-owned on POSIX; the simulated startup tests pin the resubmit and flush sequence. This supersedes the pwsh paragraph of [the checkpoint-order note](2026-09-16-checkpoint-order-and-terminal-startup.md), which retained output across empty results while still requiring only `stdin_read`; that note's other decisions are untouched.
