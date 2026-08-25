# Agent Note: Complete Web durable file intake

Status: implemented

English | [中文](2026-08-20-web-durable-file-intake.zh.md)

## Problem

The Web composer could not hold generic files beside draft images, and archived or forked sessions could not render the exact intake outcome.

## Decision

The Web composer now keeps generic files beside draft images until host admission. Image limits remain image-specific; non-image files travel as `file` prompt parts with MIME type, canonical base64 bytes, and a display name. The browser never stores those bytes in session state.

Conversation rendering has a dedicated file slot. It presents each durable reference with MIME metadata, persisted extraction status, and a collapsible persisted preview. Consequently an archived, reloaded, or forked session renders the exact intake outcome recorded by the host without rerunning extraction.

## Alternatives considered

Rejected: storing file bytes in browser session state (non-durable and duplicated) and re-running extraction on every render (nondeterministic).

## Consequences

The user-visible path is now one object from dropped file through durable host storage, model prompt reference, transcript card, and session restoration. Slash commands continue to reject generic files because their command wire only admits images.

## Verification

Focused attachment, composer, conversation runtime, and client fixture tests pass. Host TypeScript passes; client typecheck reaches only two pre-existing `ui-trajectory` exhaustive-return errors unrelated to this change.
