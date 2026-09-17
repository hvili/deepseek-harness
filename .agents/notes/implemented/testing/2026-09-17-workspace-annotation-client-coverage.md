# Agent Note: Workspace annotation client coverage

Status: implemented

English | [中文](2026-09-17-workspace-annotation-client-coverage.zh.md)

## Problem

The durable favorites/tags feature shipped with fake-API plumbing in its client test doubles but no case that drives the new client paths: the model's favorite/unfavorite/tag methods, the follow-stream increment switch arms, the controller facade methods, the UI navigation face, and the test-runtime workspaces double were never executed. The Windows coverage lane — the first lane to reach the per-file threshold check — failed with 384 uncovered locations across twelve workspace files. The Linux lane had been passing its coverage gate only in the sense that a pwsh startup failure aborted the lane before the threshold check ran, so the gap was platform-independent and previously invisible.

## Decision

Behavior tests cover each layer through its real entry point. The registry suite drives favorites, tag normalization, bounds, and restart durability. The controller host suite drives the four commands with their failure mappings and the feed's favorites/sessionTags/workspaceTags change detection. The client model suite installs unary echoes, keeps failed results unchanged, and proves structurally equal tag maps stay publish-free. The transport suite pushes the three new increment types through the Gateway client and crosses the facade commands as wire requests. The UI suites render favorite marks, tag chips, and both favorite menu directions, and dispatch the tag editor; the search derivation matches durable Workspace and Session tags. The test-runtime workspaces double gets its own suite for the default mirror behavior, the stub seat, and the call record.

## Alternatives considered

**Exempt the twelve files from the per-file gate.** Rejected: the gate is the repository's coverage contract, and the gap was a missing suite, not a collection artifact.

**Cover the client paths only through a browser-grade lane.** Rejected: the jsdom and remote-mock lanes already exercise every one of these functions; the missing coverage was an untested feature surface, not a harness limitation.

## Consequences

The client annotation surface is pinned by behavior on every platform lane, so the next lane that reaches the threshold check no longer decides what counts as covered. The favorites/tags UI interactions remain visually verified by the browser drill recorded in the feature's commit; these suites pin their logic, not their rendering.
