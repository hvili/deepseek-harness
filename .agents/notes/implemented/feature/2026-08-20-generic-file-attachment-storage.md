# Agent Note: Add durable generic file attachment storage

Status: implemented

English | [中文](2026-08-20-generic-file-attachment-storage.zh.md)

## Problem

The attachment seam had no generic-file contract, so stores silently accepted files they could not persist durably, and consumers had no typed reference.

## Decision

The attachment seam now exposes a `FileAttachmentRef` with a `kind: 'file'` discriminator, MIME routing metadata, byte count, sanitized display name, and the same opaque content-addressed id used by image objects. `AttachmentStore.saveFile` and `readFile` have explicit unsupported defaults so older test and third-party stores remain source-compatible rather than accidentally accepting files.

`LocalAttachmentStore` overrides both methods. Generic bytes are published through the existing private staging, exclusive hard-link, directory-sync, SHA-256 verification path. The local service applies a separate 100 MiB default file limit. It stores no host path or browser object URL.

## Alternatives considered

Rejected: overloading the image reference with an implicit file flag (untyped and ambiguous) and letting each store invent its own file persistence (inconsistent integrity guarantees).

## Consequences

PDF and Office intake can now retain one immutable source object before any parser runs. Parser progress, extracted preview, and prompt references can attach to the durable id instead of retaining browser-local bytes. This change deliberately does not claim parsing or session-reference integration is complete.

The shared message model now also has a `file` content block. It persists the file reference plus an optional bounded parser preview, never raw bytes or a host path; provider adapters that do not understand it retain their existing unknown-block fallback.

## Verification

`pnpm exec vitest run packages/attachment/attachment/tests packages/attachment/attachment-local/tests` passed: 32 tests passed, 1 skipped. `pnpm exec tsc -b tsconfig.host.json --pretty false` passed.
