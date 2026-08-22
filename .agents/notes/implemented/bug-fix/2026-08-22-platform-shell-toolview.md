# Agent Note: Platform shell tool rows share terminal presentation

Status: implemented

English | [中文](2026-08-22-platform-shell-toolview.zh.md)

## Problem

The shipped Windows preset executes shell calls through `pwsh`, but the Tool-owned keyed view slot registered the terminal row only for `bash`. Windows shell calls therefore fell back to the generic tool renderer even though their arguments and results use the same terminal-card model.

## Decision

`bashToolviewSample` registers `BashRow` for both `bash` and `pwsh`. The shared row keeps its existing terminal parsing, disclosure behavior, accessibility state, and `data-sample="bash"` presentation contract; only keyed-slot selection now recognizes the platform shell name.

The Web scroll contract emits an equivalent PowerShell fixture on Windows and retains its Bash fixture elsewhere, so the live terminal path is exercised on both shipped shell defaults.

## Alternatives considered

- **Rename the presentation to `pwsh`.** The component and visual contract cover shell terminal calls, while existing selectors and historical Bash fixtures rely on the established `bash` sample marker.
- **Register a separate PowerShell component.** Both tools share the same argument shape, result parsing, and interaction model, so a separate renderer would duplicate behavior without a reader-visible distinction.

## Consequences

Windows `pwsh` calls now present as terminal cards instead of generic rows. New shell tools with genuinely different result semantics still need their own keyed renderer; this registration does not make the terminal-card model universal.

## Testing

`apps/web/tests/chat-scroll-contract.e2e.ts` exercises the running and settled platform shell call with a native fixture and verifies its terminal-card lifecycle. The complete long-chat scroll suite passes after an official build.
