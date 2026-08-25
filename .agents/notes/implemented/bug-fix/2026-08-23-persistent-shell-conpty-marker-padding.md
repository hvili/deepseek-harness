# Agent Note: Tolerate ConPTY line padding around persistent shell markers

Status: implemented

English | [中文](2026-08-23-persistent-shell-conpty-marker-padding.zh.md)

## Problem

The persistent shell tools parse completion from the retained terminal text: the END marker's status digits must be followed immediately by a newline, and the text after the START marker is trimmed of exactly one leading newline. A Windows ConPTY render pads lines with trailing spaces, so on the real pwsh twin the status line reads `<END>:0   \n` and the start marker line reads `<START> \n`. Both parses fail on that padding: `commandOutput` reports no completion, and the prompt-fallback branch of `partialOutput` — the same path the 2026-08-22 fallback-marker-leak fix hardened — returns the raw tail, leaking the internal END marker and the padding residue into the model-facing result. Observed as an intermittent failure of the minimal-preset web snapshot on the Windows lane (about half of single-file runs); the stub-backed package tests never reproduced it because their stubs emit unpadded lines.

## Decision

The completion pattern now accepts horizontal padding between the status digits and their newline (`/^(\d+)[ \t]*\r?\n/`), and every trim that removes the newline after a START marker accepts padding before that newline. The trailing trim deliberately keeps the output's own trailing spaces: a command can legitimately print them (the pwsh twin's prompt-collision test locks output equal to the prompt spelling), so trailing padding is indistinguishable from output and stays. Both twins carry the identical change (they are deliberate mirrors), and each gained two stub modes whose marker lines carry ConPTY padding — one for the completion path, one for the newest-page-lags window.

## Alternatives considered

**Trim trailing spaces per line in the terminal sanitizer.** Renderer padding and output that legitimately ends in spaces are indistinguishable at that layer; the trim would corrupt real command output.

**Retry the completion check until the status line is clean.** The padding is stable once written — it is not a torn write — so a retry loop would spin to its bound without ever parsing the status.

## Consequences

Under ConPTY padding, a finished command returns exactly its output plus exit status on both the completion path and the retention-lag fallback path. Output that ends in spaces is preserved byte-for-byte.
