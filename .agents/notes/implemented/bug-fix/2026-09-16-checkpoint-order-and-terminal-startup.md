# Agent Note: Checkpoint ordering and terminal startup observations

Status: implemented

English | [中文](2026-09-16-checkpoint-order-and-terminal-startup.zh.md)

## Problem

Serial fork CI exposed two ordering defects. A creation checkpoint awaited the Session log flush before entering the storage-domain queue. A detach checkpoint could enter that queue first, then be overwritten by the delayed creation value. In pwsh startup, a silence-settled send could capture the prompt, while the following `stdin_read` result had no new output and erased the startup message. Output emptiness also incorrectly decided whether to resubmit setup.

The macOS Linux-scope unit fixture had a separate host-resource leak: its fake pid reached real `process.kill`, so an existing host process group could absorb the signal instead of the fake child's fallback. Windows npm resolution used a 10-second subprocess cap inside a 90-second coverage lane; cold startup exceeded that nested cap.

## Decision

[SessionProjectionCache](../../../../packages/session/session-projection-cache/src/index.ts) snapshots the projection cut synchronously and reserves a per-Session write chain before awaiting log durability. A failed predecessor settles before its successor continues. Completed chains leave the pending map, and disposal joins remaining writes before closing the domain. Different Sessions retain independent log barriers; the storage domain still owns durable publication.

[Terminal startup](../../../../packages/terminal/terminal-bash/src/index.ts) submits pwsh setup once and retains the latest non-empty bounded viewport across empty follow-up results. It still requires backend `stdin_read` and keeps the same absolute deadline; printed prompt text alone cannot establish readiness.

Every Linux-scope unit case intercepts process-group signals before using fake children and restores the mock afterward. Tests that need successful group delivery explicitly replace that interception with a recording fake. Npm resolution tests use the Windows lane's 90-second case budget with 80 seconds for the child and 10 seconds for termination and assertions; the separate deliberate-timeout test retains its short deadline.

Workspace UI favorite/tag method signatures derive from their existing controller interface. The standalone connection fixture reuses its own payload interfaces to construct wire frames and keeps its independent tag-map implementation. This avoids importing a controller that depends on the transport package. Clone thresholds, exclusions, and runtime checks remain unchanged.

## Alternatives considered

**Poll the final checkpoint longer.** Rejected: delayed creation can overwrite detach permanently, so extra waiting cannot fix ordering. A barrier-controlled test reproduces that interleaving without load or sleeps.

**Treat empty pwsh output as startup failure or accept prompt text as readiness.** Rejected: an empty follow-up can be the successful readiness observation, while echoed setup can contain the prompt before the shell is ready. Preserve output and readiness as separate facts.

**Retry CI or change production signal handling for a fake pid.** Rejected: fixtures must contain their host resources. The signal-success negative control reproduces the original assertion failure without signaling a real group.

## Consequences

Deterministic regressions cover delayed creation versus detach and non-empty startup followed by empty readiness. Focused source coverage remains at 100%; real POSIX terminal composition remains CI-owned when the local host is Windows. Real npm startup is bounded by its lane budget rather than an unrelated shorter cap.

Supersession review retains the [projection proposal](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md), [native containment decision](../architecture/2026-08-28-subprocess-native-containment.md), and [fork capacity policy](../process/2026-08-24-fork-hosted-validation-profile.md): they own independent architecture and runner choices. This note repairs their implementation boundaries without replacing those decisions. No archived note is modified.
