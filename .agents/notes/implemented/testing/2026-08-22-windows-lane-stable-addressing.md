# Agent Note: Stable addressing and platform derivations across the Windows web lane

Status: implemented

English | [中文](2026-08-22-windows-lane-stable-addressing.zh.md)

## Problem

The full Windows sweep surfaced a set of scenario-level assumptions that hold on the machines the lane was authored on but not on a stock Windows host: the pwsh key now renders through the keyed BashRow (so `[data-tool="pwsh"]` never matches since the row carries `data-sample`); the sidebar's Ungrouped label is nested four wrapper levels deep (so climbing two parents lands on a layout span whose `aria-expanded` reads null, and the expand loop toggles the group instead of driving Show-more); the sidebar group rows also carry a `titleRow` class that precedes the session header in the DOM (so the header capture recorded a bare workspace label); hmr-live spawned a bare `pnpm` through the subprocess runtime (libuv resolves only .exe names on Windows, and a corepack-managed pnpm ships .CMD shims), let the page follow the host locale (a zh-CN Windows renders the hero in Chinese, so the English edit anchor never appears), and budgeted 60s for a dev-web initial build that takes 77s on slower disks; the minimal-preset snapshot dispatched the recorded `bash` by name against the live registry; and a pasted text file is conversation intake now, not a refusal toast.

## Decision

Each scenario now addresses what it means, not where layout happens to put it: the pwsh row is located by its `data-sample` shell-family attribute; the Ungrouped toggle and the session header by role/scope (`getByRole('treeitem', …)`, `[class*="centerCol"] [class*="titleRow"]`); hmr-live routes its watcher through `cmd /c` on win32 (cmd's PATHEXT resolution finds the .CMD shim), pins the page to en-US through the lane's shared helper, and budgets the watcher's readiness and the test itself for a slower initial build; minimal-preset derives the persistent-shell dialect and folds the tools list onto the POSIX snapshot spelling; image-display asserts the files rail the intake now produces. The turn-rewind stragglers among the goldens (lifecycle-chrome's reload, subagent-interrupt's offline composer) were refreshed — their scenarios were otherwise sound, and the interrupt suite's downstream failures were the cascade of the stale golden aborting the scenario mid-flow.

The one scenario that is NOT addressable is goal-multi-turn-actions: its recording is the suite's only POSIX-bound model transcript (the model hand-wrote find/awk/python3/shuf, and the golden keeps the macOS spellings), so pwsh genuinely fails the commands and a Windows golden would have to bake Failed rows the POSIX golden rejects. Its replay test skips on win32 (record stays available) — the scenario's replay coverage stays with the macOS/Linux hosts the testing policy scopes fixture replay to.

## Alternatives considered

**Per-platform goldens or skips for the affected scenarios.** Every divergence above is addressable; none of it asserts platform-specific behavior that a fold would falsify.

**Keep the locale-dependent hero wait and assert the translated string.** The edit needle is an English source constant; pinning the page is the smaller, locale-independent contract.

The steering lane's mid snapshot had the same disease in time rather than space: it waited only for the think block to settle, so on a fast host the two-consecutive-capture stability poll could settle inside the gap before the ask-question row (and the usage stats trailing it) rendered, capturing a pre-question state the golden does not carry. The capture now waits for the question row's running state first.

## Consequences

The lane's locators survive layout restructures that rename wrapper depth, and the HMR scenario runs wherever corepack manages pnpm. The paste assertion now documents the intake contract (a non-image file parks in the files rail with a remove control) instead of a toast the feature replaced.