# Agent Note: Replay Code Mode programs against the live platform shell

Status: implemented

English | [中文](2026-08-22-code-mode-replay-platform-bindings.zh.md)

## Problem

The replay tool-name map renames a replayed tool CALL, but a Code Mode fixture's `run_code` program addresses subtools through the recorded `tools.` SDK binding: the program source literally reads `tools.bash(...)`. On Windows the call dispatches under `pwsh` while the program still calls the recorded binding, so the executor throws "tools.bash is not a function" and the scenario's sub-dispatches never run. The aria golden comparison diverged on two more axes: the snapshot YAML-doubles the backslashes of a native Windows path (leaving `workspace\\missing.txt` behind after the {{cwd}} collapse), and the settled conversation renders the turn-rewind portal buttons (Edit, Return to before sending) that the recorded golden predates.

## Decision

`renameToolCallNames` additionally rewrites `tools.<recorded>` member accesses inside a `run_code` block's arguments, on the block-end only — the authoritative chunk the assembler freezes the executed call from. Streamed deltas keep the recorded spelling; they are presentation-only. The rewritten token refuses a following word character, so `tools.bashx` never matches `tools.bash`, and other tools' arguments stream unchanged: a command string legitimately containing the literal `tools.bash` belongs to the recorded scenario.

`normalizeAria` collapses the YAML-doubled cwd spelling before the basename pass and folds remaining doubled backslashes to the POSIX slash after it; a single backslash before a quote is YAML escaping, not a separator, and stays put. POSIX passes are no-ops — its paths carry no backslash. The code-mode-round golden gains the two turn-rewind buttons at the settled state, the same cluster as the goldens refreshed with the tool-name map commit.

## Alternatives considered

**Edit the fixture's program source to `tools.pwsh`.** The committed log is a real POSIX recording; rewriting it drops bash coverage from the scenario or forks a per-platform fixture set that must be re-recorded in lockstep.

**Rewrite the deltas too.** No consumer reads the executed call from deltas — the assembler freezes it from the block-end — so rewriting both spelling layers doubles the surface for one behavior.

**Normalize Windows paths per golden or keep per-platform goldens.** Doubles the committed goldens for content that is identical modulo separators; the fold belongs to the one normalizer every golden already flows through.

## Consequences

A bash-recorded Code Mode fixture now replays on Windows with its sub-dispatches dispatched and logged under pwsh (the CODE_ROUND_OK content assertions hold), while POSIX replays the program verbatim. The binding rewrite is unit-covered including the negative case — a non-program call whose command data contains the literal `tools.bash` streams unchanged — and one golden per scenario continues to hold: titles fold (Pwsh to Bash), paths fold (backslash to slash), and the turn-rewind buttons render identically once attached. Any future consumer reading the program from deltas would see the recorded spelling; acceptable today because only the assembler consumes them.
