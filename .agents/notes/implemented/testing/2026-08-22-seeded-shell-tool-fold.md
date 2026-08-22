# Agent Note: Fold seeded shell tool names to the live platform shell

Status: implemented

English | [中文](2026-08-22-seeded-shell-tool-fold.zh.md)

## Problem

Seeded sessions present their tool rows through the live registry: the api-proxy recomputes render intents by looking the tool up under its logged name. A POSIX-recorded seed carrying `bash` calls on a pwsh host therefore renders generic rows — no terminal card, no expand toggle, no copy button — so navigation-panes' terminal-card scenarios and chat-long-interactions' row assertions failed on Windows. Replayed sessions do not hit this because installLlmReplay's toolNames mapping already renames the dispatch to the live tool, leaving the durable log carrying the platform's own name.

## Decision

`seedSession` folds a seed's recorded `bash` tool calls to `liveShellToolName` on win32 — the seed-time twin of the replay mapping — rewriting both `tool/call` events and the assistant message's tool-call blocks (tolerating the flat, hand-authored message shape some seeds carry, since a parsed log is a durable-file boundary). POSIX hosts keep fixtures verbatim. `normalizeAria` gains the trajectory-ledger folds — `row "TOOL, pwsh {` and `cell "pwsh{` — so the seeded ledger, which renders the durable event name, matches the POSIX recording the goldens carry; the agent-preset-authoring lane's `withPresetRoot` now anchors on either path separator and folds the sub-path onto the POSIX spelling, so the preset-root token survives a backslashed Windows render.

## Alternatives considered

**Fold the lookup in the api-proxy's `viewFor`.** A real cross-platform log would also render its terminal cards, but that is a product behavior decision (which presenter owns a foreign platform's logged name) beyond this lane's scope; the seed fold mirrors the established replay mapping instead.

**Rewrite the committed seed fixtures to pwsh.** One fixture cannot serve both platforms verbatim; the fold keeps a single committed recording.

## Consequences

Seeded and replayed logs now carry the same platform-consistent shell names, and the terminal-row coverage (expansion, exit pill, copy, geometry) runs on Windows exactly as on POSIX. The fold is one-directional (bash to the live twin on win32); a pwsh-recorded seed on POSIX stays untouched, because the pwsh-terminal lane mounts its own overlay.