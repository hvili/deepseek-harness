# Agent Note: Admit generic files into durable prompts

Status: implemented

English | [中文](2026-08-20-durable-file-prompt-admission.zh.md)

## Decision

The browser-to-host `session.prompt` wire now accepts a generic `file` part alongside text and images. The host decodes its canonical base64 payload, stores it through `AttachmentStore.saveFile`, and records one `file` content block that contains only the resulting immutable reference. No browser blob URL, source path, or raw byte payload enters the session log.

Text-only adapters project a file block to its bounded parser preview. Until parser intake supplies one, they emit a precise attachment fallback that names the sanitized display name and MIME type instead of silently dropping the user material.

## Consequences

The same durable object now connects upload admission, prompt history, model request assembly, and later session restoration. File extraction and its UI status are intentionally delivered by the following intake step; the fallback makes an unavailable extractor explicit to the model meanwhile.

## Verification

Focused API schema/admission and DeepSeek serialization tests pass, together with the host TypeScript build.
