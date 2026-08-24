/**
 * Restore-wizard orchestration over the session-backup primitives: preview the
 * impact of restoring a snapshot onto a live store (diff current vs snapshot),
 * then transactionally restore with a pre-restore rollback snapshot and a
 * post-restore byte verification. Node stdlib + session-backup only.
 *
 * The interactive confirmation is injected as an {@link RestoreApprove} seam so
 * this package stays a pure, testable decision layer — a UI/CLI wizard wires
 * its real `user-approval` confirmation into that seam later.
 * @module @deepseek-ai/dsh-restore-coordinator
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  readBackupManifest,
  restoreBackup,
  takeBackup,
  verifyBackup,
  type BackupManifest,
} from '@deepseek-ai/dsh-session-backup'

/** How a snapshot restore would change the live store, before touching it. */
export interface RestoreImpact {
  /**
   * Snapshot entries whose current target is missing or holds different bytes:
   * these files will be written.
   */
  readonly toRestore: readonly string[]
  /** Snapshot entries already byte-identical at the target: skipped. */
  readonly identical: readonly string[]
  /**
   * Regular files currently in the target that are NOT recorded in the snapshot.
   * Restoring to the exact snapshot state prunes these (configurable).
   */
  readonly orphans: readonly string[]
}

/** Asks the operator whether to proceed with a restore; `false` declines. */
export type RestoreApprove = (impact: RestoreImpact) => Promise<boolean> | boolean

/** Options shared by {@link planRestore} and {@link runRestore}. */
export interface RestoreCoordinatorOptions {
  /** The snapshot directory to restore from (contains `manifest.json`). */
  readonly backupDir: string
  /** The live store to restore into (created if absent). */
  readonly restoreRoot: string
  /**
   * Backups root where a pre-restore snapshot of the live store is recorded so a
   * failed restore can roll back. Required only when a restore will mutate.
   */
  readonly rollbackRoot: string
  /** Session-log format version stamped on the pre-restore rollback snapshot. */
  readonly sessionFormatVersion: number
  /** Harness version stamped on the pre-restore rollback snapshot. */
  readonly harnessVersion?: string
  /** Prune current-target files not in the snapshot (exact restore). Default true. */
  readonly pruneOrphans?: boolean
  /** Optional operator confirmation asked before any mutation. */
  readonly approve?: RestoreApprove
}

/** Verified preflight result of {@link planRestore}. */
export interface RestorePlan {
  /** The snapshot's impact on the live store, never mutates it. */
  readonly impact: RestoreImpact
  /** Whether the snapshot's manifest and every content file verified. */
  readonly verified: boolean
}

/** Outcome of {@link runRestore}. */
export type RestoreDecision =
/** The operator (or an injected approval) declined; nothing was touched. */
| { readonly outcome: 'declined' }
/** The live store already matched the snapshot; nothing was touched. */
| { readonly outcome: 'nothing-to-do' }
/** The store was restored to the snapshot and post-restore bytes verified. */
| { readonly outcome: 'restored'; readonly impact: RestoreImpact; readonly restored: number; readonly skippedIdentical: number; readonly pruned: number }

/** Thrown when a snapshot fails integrity verification and is refused. */
export class RestoreNotVerifiableError extends Error {
  constructor(mismatches: readonly string[]) {
    super(`restore refused: snapshot failed integrity verification: ${mismatches.join(', ') || 'unknown'}`)
    this.name = 'RestoreNotVerifiableError'
  }
}

/** sha256 of a file's bytes as lowercase hex. */
async function sha256File(file: string): Promise<string> {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

/** Recursively collect every real file under `dir`, sorted by absolute path. */
async function listRegularFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    /* v8 ignore next -- guarded by stack.length above; Array.pop cannot be undefined here. */
    if (current === undefined) break
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      /* v8 ignore start -- sockets/devices are intentionally ignored; portable CI cannot create every filesystem entry kind. */
      else if (entry.isFile()) files.push(path)
      /* v8 ignore stop */
    }
  }
  return files.sort()
}

/** Classify each snapshot entry and the current store into the impact buckets. */
async function computeRestoreImpact(manifest: BackupManifest, restoreRoot: string): Promise<RestoreImpact> {
  const toRestore: string[] = []
  const identical: string[] = []
  const currentSet = new Set<string>()
  for (const file of await listRegularFiles(restoreRoot)) {
    currentSet.add(relative(restoreRoot, file).split(sep).join('/'))
  }
  for (const entry of manifest.entries) {
    currentSet.delete(entry.relPath)
    const target = join(restoreRoot, ...entry.relPath.split('/'))
    let stats; try { stats = await stat(target) } catch {
      toRestore.push(entry.relPath)
      continue
    }
    if (!stats.isFile() || await sha256File(target) !== entry.sha256) toRestore.push(entry.relPath)
    else identical.push(entry.relPath)
  }
  // Any current file left after removing all snapshot entries is an orphan.
  const orphans = [...currentSet].sort()
  return { toRestore, identical, orphans }
}

/**
 * Verify a snapshot and preview how it would change the live store, without
 * mutating anything. Backs the wizard's "select backup → verify → preview".
 * @param options - snapshot, live store (immutable here), and format stamps.
 * @returns the impact preview and the verification verdict.
 * @throws {@link RestoreNotVerifiableError} when the snapshot fails verification.
 */
export async function planRestore(options: RestoreCoordinatorOptions): Promise<RestorePlan> {
  const verification = await verifyBackup(resolve(options.backupDir))
  if (!verification.valid) {
    throw new RestoreNotVerifiableError(
      verification.mismatches.map(m => `${m.relPath} (${m.reason})`),
    )
  }
  const manifest = await readBackupManifest(options.backupDir)
  const impact = await computeRestoreImpact(manifest, resolve(options.restoreRoot))
  return { impact, verified: true }
}

/**
 * Transactionally restore a verified snapshot onto a live store: record a
 * pre-restore rollback snapshot, apply the restore (pruning orphans to reach the
 * exact snapshot state unless disabled), verify every restored byte, and on any
 * failure atomically roll the store back to the pre-restore snapshot.
 * @param options - snapshot, live store, rollback root, and approval seam.
 * @returns the decision: declined, nothing-to-do, or restored.
 * @throws {@link RestoreNotVerifiableError} on an unverifiable snapshot.
 * @throws when the operator declines is NOT thrown — returns `declined`.
 */
export async function runRestore(options: RestoreCoordinatorOptions): Promise<RestoreDecision> {
  const restoreRoot = resolve(options.restoreRoot)
  const { impact } = await planRestore(options)
  const prune = options.pruneOrphans !== false
  const mutates = impact.toRestore.length > 0 || (prune && impact.orphans.length > 0)

  if (!mutates) return { outcome: 'nothing-to-do' }
  if (options.approve && !(await options.approve(impact))) return { outcome: 'declined' }

  // Pre-restore snapshot of the live store so a failed restore can roll back.
  const rollback = await takeBackup({
    sourceRoot: restoreRoot,
    backupRoot: options.rollbackRoot,
    sessionFormatVersion: options.sessionFormatVersion,
    ...(options.harnessVersion ? { harnessVersion: options.harnessVersion } : {}),
  })

  try {
    const result = await restoreBackup(options.backupDir, { restoreRoot, overwrite: true })
    let pruned = 0
    if (prune) {
      const manifest = await readBackupManifest(options.backupDir)
      const kept = new Set(manifest.entries.map(entry => entry.relPath))
      for (const file of await listRegularFiles(restoreRoot)) {
        const rel = relative(restoreRoot, file).split(sep).join('/')
        if (rel !== '' && !kept.has(rel)) {
          await rm(file)
          pruned += 1
        }
      }
    }
    await assertRestoredMatches(options.backupDir, restoreRoot)
    return {
      outcome: 'restored',
      impact,
      restored: result.restored,
      skippedIdentical: result.skippedIdentical,
      pruned,
    }
  } catch (error: unknown) {
    // Atomic rollback to the exact pre-restore snapshot state, pruning any
    // stray file the partial restore created that was not in that snapshot.
    await restoreBackup(rollback.backupDir, { restoreRoot, overwrite: true })
    const kept = new Set(rollback.manifest.entries.map(entry => entry.relPath))
    for (const file of await listRegularFiles(restoreRoot)) {
      const rel = relative(restoreRoot, file).split(sep).join('/')
      if (rel !== '' && !kept.has(rel)) await rm(file)
    }
    throw error
  }
}

/** Assert every snapshot content file is byte-identical at the restore root. */
async function assertRestoredMatches(backupDir: string, restoreRoot: string): Promise<void> {
  const manifest = await readBackupManifest(backupDir)
  const mismatches: string[] = []
  for (const entry of manifest.entries) {
    const target = join(restoreRoot, ...entry.relPath.split('/'))
    /* v8 ignore start -- restoreBackup just wrote and verified these paths;
     * only an external concurrent filesystem mutation can enter these guards. */
    let hash; try { hash = await sha256File(target) } catch { mismatches.push(`${entry.relPath} (missing)`); continue }
    if (hash !== entry.sha256) mismatches.push(`${entry.relPath} (hash)`)
    /* v8 ignore stop */
  }
  /* v8 ignore start -- see concurrent-mutation guard above. */
  if (mismatches.length > 0) {
    throw new Error(`restore verification failed for ${mismatches.join(', ')}`)
  }
  /* v8 ignore stop */
}
