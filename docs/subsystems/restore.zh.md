# 恢复与升级

[English](restore.md) | 中文

会话恢复向导（`ctx.restoreWizard`）、它驱动的备份/恢复原语，以及守护它们的格式升级协调器。向导在只读沙箱约束下预览恢复，通过批准接缝询问操作者，然后重放事务性恢复；协调器拒绝跨会话格式版本降级。

来源：[`packages/interaction/restore-wizard/src/index.ts`](../../packages/interaction/restore-wizard/src/index.ts)、[`packages/util/session-backup/src/index.ts`](../../packages/util/session-backup/src/index.ts)、[`packages/util/restore-coordinator/src/index.ts`](../../packages/util/restore-coordinator/src/index.ts)、[`packages/util/upgrade-coordinator/src/index.ts`](../../packages/util/upgrade-coordinator/src/index.ts)

## 向导流程

`ctx.restoreWizard` 按最新优先列出已存储备份，通过沙箱的只读约束预览一次恢复，并在 `ctx.approval` 批准操作后重放事务性恢复。预览从不改变实时存储：即使受限的预览子进程行为异常，沙箱也会强制执行这一点。

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

## 升级协调

升级协调器读取持久化的会话格式版本，拒绝向下迁移，并让未触碰的存储保持原样；本构建无法忠实执行的升级会被拒绝而不是猜测。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
