# Agent Note: Synchronize durable workspace and session tags as complete snapshots

Status: implemented

English | [中文](2026-08-20-workspace-tag-snapshots.zh.md)

## Problem

Workspace and session tags persist in the workspace domain, but a browser client needs a reconnect baseline, a mutation result, and a multi-client update that cannot independently drift.

## Decision

`workspace.list` carries `workspaceTagsById` and `sessionTagsById` as complete maps. `workspace.setWorkspaceTags` and `workspace.setSessionTags` replace a target's normalized tag list and return both maps. `host/workspace-tags-changed` carries the same complete snapshot after a global workspace-domain write changes either map.

The registry exposes read-only complete tag maps for that projection. The API proxy copies every array before emitting it. The client workspace manager replaces both maps together, copies incoming arrays, and gives a frame or unary result that arrives during a refresh precedence over that refresh's older baseline.

The workspace sidebar renders each target's tags beside its title. The project and session action menus both open one browser-owned comma-separated editor; submission preserves the raw list for registry normalization, then the returned snapshot updates every visible row.

Sidebar search treats workspace and session tags as local metadata alongside titles and workspace names. Archived sessions remain excluded before any metadata matching.

Project groups project visible ordinary fork lineage from `SessionSummary.parentId`: a child follows its visible parent with a bounded sidebar indent. An absent parent and cycles degrade to visible roots, and subagent-origin rows remain owned by the separate subagent catalog.

## Alternatives considered

**Per-tag incremental frames.** Rejected because a set/remove operation would require merge, deletion, ordering, and reconnect reconciliation rules in every client.

**Embedding tags in each workspace or session list row.** Rejected because session tags must also work for ungrouped sessions, and the workspace list is not the authoritative session listing.

## Consequences

Every connected client converges on one durable tag snapshot after a mutation, host frame, or reconnect. The wire payload repeats small maps, which deliberately trades bytes for simple replacement semantics and recovery from missed frames. The shared editor keeps tags accessible without adding inline controls to compact sidebar rows.

## Verification

The workspace API test covers normalized persistence, full-list rebaselining, a host frame, and unknown-session rejection. The runtime test covers unary installation and a newer host-frame replacement. The fetch carrier and compiler cover every typed route and fixture implementation. The built Web workspace-management browser suite drives the row menu to favorite and tag a session, then proves the favorite marker, tags, and tag-only search survive a reload.
