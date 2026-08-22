# Agent Note: Fold platform-shaped background-job details in aria goldens

Status: implemented

English | [中文](2026-08-22-background-jobs-platform-outcome.zh.md)

## Problem

The background-job-list e2e dispatches a REAL `run_in_background` shell call through the scaffold's live toolset, so its hardcoded `name: 'bash'` cannot dispatch on Windows (the standard preset mounts pwsh), and the job-id probe `\bbash-\d+\b` cannot match the registry's `pwsh-N` ids. The aria goldens diverged on two more axes: the job row renders the registry kind as its first listitem token (`pwsh` where the POSIX recording shows `bash`), and a killed job's outcome detail is genuinely platform-shaped — POSIX settles with `signal: SIGTERM` while a Windows force-kill carries no signal and settles as `killed before exit` (the pwsh tool documents this difference as intentional).

## Decision

The test dispatches and probes through `liveShellToolName` (the scaffold's single source for the platform's shell tool), so POSIX keeps exercising bash verbatim. `normalizeAria` gains two folds: the job-row kind collapses `pwsh ` to `bash ` after `listitem: ` on win32 — the lowercase twin of the existing title fold — and BOTH outcome spellings (`signal: SIGTERM`, `killed before exit`) collapse to `{{outcome}}` on every platform, with the YAML quoting the POSIX colon induces stripped around a folded value so the lines converge. The settled golden now carries the token spelling.

The outcome fold is deliberately NOT a rename: rewriting `killed before exit` to `signal: SIGTERM` would make the golden assert a signal Windows never delivers. The token asserts the settled detail RENDERS (a missing detail would leave the status word `killed`, which does not match the fold) without asserting either platform's kill semantics; the vocabulary itself is unit-covered in tool-pwsh's `processOutcome` suite.

## Alternatives considered

**Fold the Windows spelling to the POSIX one.** Falsifies the documented platform behavior — the golden would claim SIGTERM delivery on a platform without signals.

**Per-platform settled goldens.** Doubles committed goldens for a row whose structure, flip timing, and vocabulary placement are identical; only the detail word differs.

**Assert the detail in the test instead of the golden.** The golden's job is the rendered row; moving the detail assertion out of it splits one delivery path check across two mechanisms.

## Consequences

One golden per state serves both platforms: the running row differs only by the folded kind token, the settled row by the folded outcome token. The quote-strip rule is scoped to lines already carrying `{{outcome}}` (only these goldens produce it), so YAML quoting driven by other content is untouched. Future job kinds that render in aria rows (a third shell, a container tool) will need the kind-fold pattern extended to their position; the outcome fold's narrow spellings mean a new settled vocabulary (for example `exit code: N`) joins the fold only when a golden first needs it.
