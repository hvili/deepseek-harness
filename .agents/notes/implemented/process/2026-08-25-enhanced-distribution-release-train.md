# Agent Note: Enhanced distribution release train

Status: implemented

English | [中文](2026-08-25-enhanced-distribution-release-train.zh.md)

## Problem

Product work and official DeepSeek Harness releases advance independently. Keeping every product feature inside one long-lived fork makes official synchronization increasingly expensive, hides which changes still need a core patch, and leaves the running source, plugins, and Codex runtime without one inspectable identity.

## Decision

The enhanced distribution uses three ownership layers. `Harness-src` follows official RC/Release tags on `product/main` and retains only changes that cannot use current public plugin seams. `D:\DeepSeek\plugins` is an independent Git and pnpm workspace for product plugins and the composed Profile Bundle. The package-local Codex app-server remains an optional engine; disabling its provider leaves the DeepSeek-native composition unchanged.

Every initial non-merge downstream commit is recorded in `product/core-patches.json` as a temporary core patch, an enhancement-layer migration, an upstream candidate, or a change that must be retired or re-proved. The inventory also records every runtime/build commit after the recoverable product baseline, with `cf14720d2e` identified as an independent `runtimeBaseline` entry. `product:verify` derives those commits from Git, rejects missing, duplicate, deleted, and unaudited entries, and excludes commits that only update governance metadata so an audit commit cannot reference itself. Each entry names verification, upstream status, and the condition that deletes it. `sync/<version>` branches absorb one official RC/Release tag at a time, and a sync cannot enter `product/main` until the product identity check and affected regression checks pass.

The diagnostic command reports the official merge base, product commit, enhancement-layer commit, DSH version, Codex runtime version, and patch counts. The release train records these values without automatically pushing, publishing, deploying, or restarting services.

## Alternatives considered

**Keep all customization in the official-source fork.** Rejected because UI, operations, and optional engine behavior would continue to enlarge the conflict set even though DSH already exposes plugin, event, Slot, and Profile Bundle extension points.

**Follow official `master` continuously.** Rejected because daily integration spends validation effort without producing a stable release and makes failures harder to attribute. The product follows official RC/Release tags instead.

**Port the complete Codex Rust runtime into TypeScript.** Rejected because the versioned app-server already exposes the reusable execution protocol. A second implementation would duplicate lifecycle, schema, and security work while still requiring OpenAI model access.

## Consequences

The product keeps official updates, differentiated features, and Codex reuse without treating them as one coupled codebase. This adds a second repository and a formal release train, but each layer has a smaller review and rollback scope. Core patches remain visible debt with explicit deletion conditions rather than an unbounded fork identity.
