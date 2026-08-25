# Agent Note: Persist bounded file intake previews

Status: implemented

English | [中文](2026-08-20-file-intake-preview-and-errors.zh.md)

## Problem

File prompts carried no model-visible preview or typed extraction result, and unreliable regex scraping risked corrupting PDF bytes.

## Decision

Host prompt admission now extracts bounded UTF-8 text and OOXML document previews before it appends the durable `file` block. The block stores the immutable attachment reference, a model-visible preview, and a typed extraction result, so reloads and forks retain both success state and diagnostic context without retaining raw bytes.

PDF bytes are never scraped with unreliable regular expressions. Until a full PDF engine is enabled, PDF input records `PDF_TEXT_EXTRACTION_UNAVAILABLE`; malformed Office archives, invalid text encoding, and unsupported types receive distinct stable results.

## Alternatives considered

Rejected: scraping PDF bytes with regular expressions (lossy and unsafe) and dropping extraction diagnostics entirely (silently loses failure context).

## Consequences

Text-only model adapters receive extracted content when available and an explicit failure statement otherwise. The next UI slice can render status and preview directly from the session event without rerunning the parser.

## Verification

Focused file-intake, prompt-admission, and content tests pass, as does the host TypeScript build.
