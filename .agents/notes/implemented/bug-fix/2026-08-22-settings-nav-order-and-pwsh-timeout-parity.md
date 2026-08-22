# Agent Note: Deterministic settings nav order and pwsh sandbox timeout parity

Status: implemented

English | [中文](2026-08-22-settings-nav-order-and-pwsh-timeout-parity.zh.md)

## Problem

Two platform-twin drifts surfaced by the Windows web lane. The archived-sessions settings section declared `order: 20`, colliding with agent-presets' `order: 20`; the settings shell sorts stably, so the tie fell back to registration order, which follows plugin activation timing — the nav order flipped between runs on the same machine (one capture landed 已归档对话 before Agent 预设, the next after). Separately, the base composition pins `timeoutMs: 60000` on the bash-sandbox row but never configured the pwsh-sandbox twin, so the shipped default the plugin-config card exposed read 120000 on Windows and 60000 on POSIX.

## Decision

Archived sessions move to `order: 25` — a distinct order makes the sort total and the nav deterministic regardless of activation timing, placing the section after the presets row the composition order already implies. The pwsh-sandbox row gains the same `timeoutMs: 60000` config its bash twin ships. The stale goldens (settings dialogs recorded before the archived feature merged, plus two turn-rewind stragglers) were refreshed once under `DSH_SNAPSHOT=refresh`; the diff review confirmed only the new nav button, the new vision-proxy card, and the rewind actions entered the goldens.

## Alternatives considered

**Normalize the nav order in the test lane.** Masks a real race: the flip is timing-dependent on every platform, not a Windows trait.

**Derive the expected timeout per platform in the test.** Would bake the drift in as intended behavior; the sandbox executors are deliberate mirrors, so the composition owes them the same policy.

## Consequences

One settings spelling serves both platforms, and the plugin-config card's "composed default this deployment ships" is the same number everywhere. Future settings sections must pick unused order values — the inline comment at the registration now says why a tie is not stable.