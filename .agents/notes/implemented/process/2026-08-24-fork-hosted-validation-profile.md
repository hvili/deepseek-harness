# Agent Note: Fork-hosted CI capacity and package-shape policy

Status: implemented

English | [中文](2026-08-24-fork-hosted-validation-profile.zh.md)

## Problem

Fork validation can replace the repository's 16-core runner labels with standard GitHub-hosted runners through `DSH_CI_RUNNER_FALLBACK_LINUX` and `DSH_CI_RUNNER_FALLBACK_WINDOWS`. Keeping the enterprise worker and partition counts on those smaller machines causes process-startup and polling fixtures to time out under contention. Publint also reports two deliberate package shapes as warnings: public `./src/*` development exports in packages whose npm payload is intentionally closed, and browser loader factories exported from `./client` as `lib/client.js`.

## Decision

When a fallback runner variable is non-empty, CI keeps every validation gate but uses a smaller resource profile: Linux static runs three gates; coverage runs two workers, two partitions, and two gates; consumers use three gates, two Oxlint/Publint/browser workers, and six snapshot workers; native Windows uses two workers, partitions, gates, and Publint workers. The enterprise and self-hosted defaults remain unchanged.

The publication runner filters only `EXPORTS_GLOB_NO_MATCHED_FILES` at `exports["./src/*"]` and `FILE_INVALID_FORMAT` at `exports["./client"].default` when its exact artifact is `./lib/client.js`. All other Publint diagnostics remain visible and retain their original severity. Package payload closure and relative-import verification still run over the exact `files` view.

## Alternatives considered

**Increase every timeout.** Rejected because it hides resource contention and lengthens genuine failure feedback without bounding process concurrency.

**Ignore Publint codes globally.** Rejected because the same diagnostics identify real publication defects at other export paths. The exception is therefore tied to the two exact project-owned shapes.

## Consequences

Fork CI trades parallelism for deterministic completion without weakening coverage or contract inventory. New publication exceptions require an exact-path regression test; broad code-based suppression is not permitted.
