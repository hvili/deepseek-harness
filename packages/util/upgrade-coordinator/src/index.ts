/**
 * Transactional upgrade orchestration over the session-store backup primitives:
 * preflight a persisted store against this build's session-log format, refuse
 * unsafe downgrades before touching anything, auto-snapshot the store before a
 * migration, and on failure atomically roll back to the exact pre-upgrade
 * snapshot. Node stdlib + {@link @deepseek-ai/dsh-session-backup} only.
 *
 * The migration driver is injected by a backend-aware caller (it knows how to
 * read/rewrite its own artifacts); this package owns the transactional
 * contract around it: **backup-before-mutation, atomic-rollback-on-failure**.
 * @module @deepseek-ai/dsh-upgrade-coordinator
 */

import { readdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  restoreBackup,
  takeBackup,
  type BackupSnapshot,
} from '@deepseek-ai/dsh-session-backup'

/** Common inputs for preflight and rollback-capable upgrade. */
export interface UpgradeCoordinatorOptions {
  /** The persisted session store root, resolved before use. */
  readonly storeRoot: string
  /** The backup store root; the pre-migration snapshot is written under it. */
  readonly backupRoot: string
  /**
   * Resolve the persisted session-log format version, or `undefined` for an
   * empty store (nothing to preserve). Backend-aware caller.
   */
  readonly readFormatVersion: (storeRoot: string, signal?: AbortSignal) => Promise<number | undefined>
  /** This build's session-log format version (e.g. `SESSION_FORMAT_VERSION`). */
  readonly currentFormatVersion: number
  /** Harness version recorded on the auto snapshot (empty when unknown). */
  readonly harnessVersion?: string
}

/** The decided per-store action from an upgrade preflight. */
export type StoredUpgradeAction =
/** Nothing to do: store is empty or already at the current version. */
| { readonly action: 'none' }
/** Persisted logs are older than this build: migrate them upward. */
| { readonly action: 'migrate'; readonly from: number }
/** Persisted logs are NEWER than this build can write: refuse, never touch. */
| { readonly action: 'downgrade-refused'; readonly from: number }

/** Outcome of {@link preflightUpgrade}. */
export interface UpgradePreflight {
  /** Persisted format version observed, `undefined` for an empty store. */
  readonly from: number | undefined
  /** The decided action for this store. */
  readonly stored: StoredUpgradeAction
}

/**
 * Inspect a store without mutating it and decide whether an upgrade is needed,
 * possible, or must be refused. A persisted store equal to the current version
 * is left alone; a store NEWER than this build reads is refused (fail-closed:
 * this build cannot faithfully migrate it down). Throws nothing — callers
 * decide how to surface a `downgrade-refused`.
 * @param options - store, backup root, and format resolution.
 * @param signal - optional cancellation signal.
 * @returns the observed persisted version and the decided action.
 */
export async function preflightUpgrade(options: UpgradeCoordinatorOptions, signal?: AbortSignal): Promise<UpgradePreflight> {
  signal?.throwIfAborted()
  const from = await options.readFormatVersion(resolve(options.storeRoot), signal)
  signal?.throwIfAborted()
  if (from === undefined || from === options.currentFormatVersion) {
    return { from, stored: { action: 'none' } }
  }
  if (from > options.currentFormatVersion) {
    return { from, stored: { action: 'downgrade-refused', from } }
  }
  return { from, stored: { action: 'migrate', from } }
}

/** A migration's environment: the store to rewrite and the two-boundary versions. */
export interface MigrationContext {
  /** The absolute session store root. */
  readonly storeRoot: string
  /** The persisted format version being migrated from. */
  readonly from: number
  /** This build's format version being migrated to. */
  readonly to: number
  /** Optional cancellation for the migration driver's own work. */
  readonly signal?: AbortSignal
}

/**
 * A backend-aware migration that rewrites persisted store content from `from`
 * to `to`. Must be inverse-able by rollback: any file it creates or modifies
 * under the store is removed/restored from the pre-migration snapshot on failure.
 */
export type StoreMigration = (context: MigrationContext) => Promise<void>

/** Result of {@link runUpgrade}. */
export interface UpgradeResult {
  readonly preflight: UpgradePreflight
  /** Present only when a migration ran (the auto pre-migration snapshot). */
  readonly backup?: BackupSnapshot
  /** The persisted version that was migrated from; present only when a migration ran. */
  readonly migratedFrom?: number
}

/** Options for {@link runUpgrade}. */
export interface RunUpgradeOptions extends UpgradeCoordinatorOptions {
  /** The migration to apply when the preflight decides `migrate`. */
  readonly migrate: StoreMigration
}

/**
 * Run the transactional upgrade: refuse unsafe downgrades, auto-snapshot before
 * any mutation, run the injected migration, and atomically roll back to the
 * exact pre-migration snapshot if it fails. A store already at the current
 * version is returned untouched with no backup created and no migration run.
 * @param options - store, backup root, format resolution, and the migration.
 * @returns the preflight decision and, when a migration ran, the snapshot and origin.
 * @throws when the store requires a newer version than this build writes.
 */
export async function runUpgrade(options: RunUpgradeOptions): Promise<UpgradeResult> {
  const storeRoot = resolve(options.storeRoot)
  const preflight = await preflightUpgrade(options)
  if (preflight.stored.action === 'none') return { preflight }

  if (preflight.stored.action === 'downgrade-refused') {
    throw new Error(
      `upgrade refused: persisted session data requires format v${preflight.stored.from}, but this harness writes only v${options.currentFormatVersion}; upgrade the harness before continuing`,
    )
  }

  // Backend by-contract guarantees a numeric `from` here (migrate never fires empty).
  const from = preflight.stored.from
  const backup = await takeBackup({
    sourceRoot: storeRoot,
    backupRoot: options.backupRoot,
    sessionFormatVersion: options.currentFormatVersion,
    ...(options.harnessVersion ? { harnessVersion: options.harnessVersion } : {}),
  })

  try {
    await options.migrate({ storeRoot, from, to: options.currentFormatVersion })
  } catch (error: unknown) {
    // Atomic rollback: restore every snapshot byte and prune any stray file the
    // partial migration created that was not in the snapshot.
    await rollbackStore(backup, storeRoot)
    throw error
  }

  return { preflight, backup, migratedFrom: from }
}

/** Recover a store to its exact pre-migration backup state. */
async function rollbackStore(backup: BackupSnapshot, storeRoot: string): Promise<void> {
  await restoreBackup(backup.backupDir, { restoreRoot: storeRoot, overwrite: true })
  const kept = new Set(backup.manifest.entries.map(entry => entry.relPath))
  for (const file of await listRegularFiles(storeRoot)) {
    const rel = relative(storeRoot, file).split(sep).join('/')
    if (rel !== '' && !kept.has(rel)) await rm(file)
  }
}

/** Recursively collect every real file under `dir`, sorted by absolute path. */
async function listRegularFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const directories = [dir]
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index]
    /* v8 ignore next -- index is bounded by directories.length in the loop condition. */
    if (current === undefined) continue
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) directories.push(path)
      /* v8 ignore start -- links/devices are ignored and cannot be created portably on hosted Windows. */
      else if (entry.isFile()) files.push(path)
      /* v8 ignore stop */
    }
  }
  return files.sort()
}
