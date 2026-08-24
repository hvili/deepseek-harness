# Restore and Upgrade

English | [中文](restore.zh.md)

The session-restore wizard (`ctx.restoreWizard`), the backup/restore primitives it drives, and the format-upgrade coordinator that guards them. The wizard previews a restore under read-only sandbox confinement, asks the operator through the approval seam, and replays the transactional restore; the coordinator refuses to migrate down across session-format versions.

Sources: [`packages/interaction/restore-wizard/src/index.ts`](../../packages/interaction/restore-wizard/src/index.ts), [`packages/util/session-backup/src/index.ts`](../../packages/util/session-backup/src/index.ts), [`packages/util/restore-coordinator/src/index.ts`](../../packages/util/restore-coordinator/src/index.ts), [`packages/util/upgrade-coordinator/src/index.ts`](../../packages/util/upgrade-coordinator/src/index.ts)

## Wizard flow

`ctx.restoreWizard` lists stored backups newest-first, previews one restore through the sandbox's read-only confinement, and — after `ctx.approval` grants the operation — replays the transactional restore. The preview never mutates the live store: the sandbox enforces that even if the confined preview subprocess misbehaves.

```ts type-equiv
/** A listing entry for a stored backup, sans the full file table. */
interface BackupSummary {
  readonly backupDir: string
  readonly backupId: string
  readonly createdAt: number
  readonly sessionFormatVersion: number
  readonly harnessVersion: string
  /** Number of content files recorded in the manifest. */
  readonly entryCount: number
  /** Sum of recorded content file byte lengths. */
  readonly totalBytes: number
}
```

```ts type-equiv
/** Preview result either verified (with impact) or refused on integrity failure. */
interface RestorePlanPreview {
  /** Whether the snapshot verified AND the impact could be computed. */
  readonly verified: boolean
  /** The impact diff when `verified`; `null` when the snapshot was refused. */
  readonly impact: RestoreImpact | null
  /** Human-readable failure reason when `verified` is `false`. */
  readonly mismatch?: string
}
```

## Upgrade coordination

The upgrade coordinator reads the persisted session-format version, refuses to migrate down, and leaves an untouched store alone; upgrades that this build cannot faithfully perform are refused rather than guessed.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrestorewizard--restorewizardservice"></a>

### `ctx.restoreWizard` — `RestoreWizardService`

Cordis service exposing the real wizard over `ctx.sandbox` (read-only preview) and `ctx.approval` (operator confirmation before mutation).

```ts cordis-catalog
/**
 * List stored backups newest-first, for the wizard's select step.
 * @param backupRoot - directory holding the backup set.
 * @returns the backup summaries, newest first.
 */
list(backupRoot: string): Promise<BackupSummary[]>

/**
 * Preview under read-only sandbox confinement (no mutation, no approval).
 * @param options - wizard run options.
 * @returns the read-only restore plan preview.
 */
preview(options: RestoreWizardRunOptions): Promise<RestorePlanPreview>

/**
 * Preview → ask `ctx.approval` → transactionally restore (full loop).
 * @param options - wizard run options.
 * @returns the final restore decision.
 */
restore(options: RestoreWizardRunOptions): Promise<RestoreDecision>
```

Source: [`packages/interaction/restore-wizard/src/index.ts`](../../packages/interaction/restore-wizard/src/index.ts)
<!-- END GENERATED cordis-surface -->
