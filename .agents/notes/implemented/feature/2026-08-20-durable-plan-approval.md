# Agent Note: Durable plan approval marker

Status: implemented

English | [中文](2026-08-20-durable-plan-approval.zh.md)

## Problem

An approved plan left no durable record, so a reloaded or forked session could not recover which plan the user actually approved.

## Decision

`exit_plan_mode` now appends a log-only `plan/approved` event immediately after an exact user approval and before plan mode leaves. The event stores the plan's first markdown heading and the complete approved plan markdown. `foldApprovedPlan(events)` returns the latest approved plan; the `plan` session projection gains an optional `approved` value.

## Alternatives considered

Rejected: reconstructing approval from the raw plan-mode transcript (fragile against editing) and persisting the whole plan text in a separate store (out of the event stream).

## Consequences

Approval is no longer inferred from `tool/result` text. Resume, fork, replay, and review surfaces can reconstruct exactly which plan was approved. The marker is non-surface and does not enter the model transcript; plan-mode guidance still governs execution, while sandbox and approval policy remain independent enforcement axes.

## Verification

Plan-mode unit and projection tests cover the appended event, the fold, and the projection value. Focused package tests pass; persistence catalog regenerated.
