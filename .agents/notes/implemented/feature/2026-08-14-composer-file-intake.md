# Agent Note: Reuse image attachments for browser file intake

Status: implemented

English | [中文](2026-08-14-composer-file-intake.zh.md)

## Problem

The Web composer accepted pasted and dropped images but provided no file picker. Text and source files had no useful path into a prompt, and text-only model routes could not consume a raw video file.

## Decision

The composer exposes a paperclip file picker beside the command launcher. Images keep the existing durable attachment path. UTF-8 text and source files up to 1 MiB are appended to the draft inside name-delimited blocks. Browser-decodable videos are represented by four JPEG stills and a short draft note, so the existing image attachment and vision-proxy paths continue to own persistence and model handling.

## Alternatives considered

**Persist every binary file as a new attachment type** — rejected for this increment. It would require a new durable session vocabulary, host API, rendering contract, retention policy, and model-specific document parsers before a file could be useful.

**Send raw videos to the model route** — rejected. The configured vision proxy accepts images, not an interoperable video input. Four stills provide bounded visual context without retaining a large opaque file.

## Consequences

Users can select images, videos, and common text or source files from the composer. PDF, Office, archive, and other binary document parsing remain deliberately unsupported and show a clear rejection. A video is understood from sampled frames, not audio or every frame.

## Verification

The InputBar client suite covers opening the picker and inserting a selected text file. The client TypeScript program and production Web bundle build successfully.
