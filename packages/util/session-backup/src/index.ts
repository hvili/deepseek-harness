/**
 * Session-store backup & restore primitives: an integrity-hashed snapshot of a
 * directory tree (a harness session store root) plus list / verify / restore
 * operations. Zero-dependency Node stdlib — a durable rollback primitive that
 * the upgrade preflight, transactional switch, and restore wizard compose.
 *
 * Snapshot layout under a backup store root:
 * ```
 * <backupRoot>/
 *   <backupId>/
 *     manifest.json      # canonical sorted-key JSON (see {@link canonicalBackupManifest})
 *     MANIFEST.sha256    # sha256 of the exact manifest.json bytes (tamper-anchor)
 *     tree/              # byte-for-byte copy of the source store's content
 *       <relPath>...
 * ```
 *
 * `restoreBackup` refuses any backup that fails {@link verifyBackup}, and by
 * default refuses to overwrite an existing target whose bytes differ — so a
 * corrupt or already-vanished backup can never silently clobber newer data.
 * @module @deepseek-ai/dsh-session-backup
 */

import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * One backed-up file, described for integrity revalidation. `relPath` is a
 * platform-independent ('/'-separated) path relative to the source store root.
 */
export interface BackupEntry {
  readonly relPath: string
  /** Byte length of the source file at snapshot time. */
  readonly size: number
  /** Lowercase hex sha256 of the source file's bytes. */
  readonly sha256: string
}

/** Durable description of one backup snapshot. */
export interface BackupManifest {
  /** Sortable unique identifier; lower value = older backup. */
  readonly backupId: string
  /** Unix epoch milliseconds at snapshot time. */
  readonly createdAt: number
  /** Absolute normalized path of the source store that was snapshotted. */
  readonly sourceRoot: string
  /** The session-log format version in force when the snapshot was taken. */
  readonly sessionFormatVersion: number
  /** Harness version that produced the snapshot (empty when unknown). */
  readonly harnessVersion: string
  /** Every content file, sorted by `relPath`; empty for an empty source store. */
  readonly entries: readonly BackupEntry[]
}

/** A taken snapshot: its manifest and the backup directory holding it. */
export interface BackupSnapshot {
  readonly backupDir: string
  readonly manifest: BackupManifest
}

/** A listing entry for a stored backup, sans the full file table. */
export interface BackupSummary {
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

/** Reason one backed-up file is no longer byte-identical to its manifest. */
export interface BackupMismatch {
  readonly relPath: string
  readonly reason:
  /** The content file is missing from the backup tree. */
  | 'missing'
  /** The content file's size differs from the manifest. */
  | 'size'
  /** The content file's sha256 differs from the manifest. */
  | 'hash'
}

/** Result of {@link verifyBackup}. */
export interface BackupVerification {
  /** Whether every manifest entry bytes-match, and the manifest is unaltered. */
  readonly valid: boolean
  /** Zero-length when `valid`; else each differing content path and why. */
  readonly mismatches: readonly BackupMismatch[]
}

/** Result of {@link restoreBackup}. */
export interface BackupRestoreResult {
  /** Content files written (or re-copied) into the restore root. */
  readonly restored: number
  /** Content files already byte-identical at the target and therefore skipped. */
  readonly skippedIdentical: number
}

/**
 * Atomic or deferrable error describing paths a restore refused to touch.
 * Thrown when a restore target already holds different bytes for one or more
 * entries and overwrite was not granted.
 */
export class BackupConflictError extends Error {
  /** Every existing conflicting content path, relative to the restore root. */
  readonly conflicts: readonly string[]

  constructor(conflicts: readonly string[], overwriteGranted: boolean) {
    super(
      overwriteGranted
        ? `backup restore conflicts with existing content at ${conflicts.length} path(s): ${conflicts.join(', ')}`
        : `backup restore refused ${conflicts.length} existing path(s) with different content; confirm overwrite to replace them: ${conflicts.join(', ')}`,
    )
    this.name = 'BackupConflictError'
    this.conflicts = [...conflicts]
  }
}

/** Thrown when a backup is not fully verifiable and therefore not restored. */
export class BackupNotVerifiableError extends Error {
  constructor(reason: string) {
    super(`backup failed integrity verification: ${reason}`)
    this.name = 'BackupNotVerifiableError'
  }
}

/**
 * Mint a sortable backup id: `<epochMs>-<3 random bytes hex>`. Lexicographic
 * order matches creation order, so a backup listing can sort by id alone.
 * @param now - epoch milliseconds; overridable for deterministic tests.
 * @returns a stable backup id string.
 */
export function createBackupId(now: number = Date.now()): string {
  return `${now}-${randomBytes(3).toString('hex')}`
}

/**
 * Serialize a manifest with sorted keys so equivalent manifests have identical
 * bytes (the tamper-anchor hashes these exact bytes).
 * @param manifest - the manifest to serialize.
 * @returns a stable, newline-terminated JSON document.
 */
export function canonicalBackupManifest(manifest: BackupManifest): string {
  return JSON.stringify(manifest, (_key, value) => {
    if (Array.isArray(value) || value === null || typeof value !== 'object') return value
    const record: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      record[key] = (value as Record<string, unknown>)[key]
    }
    return record
  }, 2) + '\n'
}

/** Whether a path is unsafe to resolve as a backup content entry. */
function assertSafeRelPath(relPath: string): void {
  if (relPath === '' || relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)
    || relPath.split('/').includes('..')) {
    throw new Error(`unsafe backup entry path ${JSON.stringify(relPath)}`)
  }
}

/** Recursively collect every real file under `dir`, sorted by absolute path. */
async function listRegularFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile()) files.push(path)
      // Symlinks and other node types are not backed up: a copied link is not
      // byte-defined content, and directory links could re-enter the store.
    }
  }
  return files.sort()
}

/** sha256 of a file's bytes as lowercase hex. */
async function sha256File(file: string): Promise<string> {
  const data = await readFile(file)
  return createHash('sha256').update(data).digest('hex')
}

/** Options for {@link takeBackup}. */
export interface TakeBackupOptions {
  /** The absolute source store root to snapshot (must be a readable directory). */
  readonly sourceRoot: string
  /** The backup store root; the snapshot is written to `<backupRoot>/<backupId>/`. */
  readonly backupRoot: string
  /** The session-log format version in force at snapshot time. */
  readonly sessionFormatVersion: number
  /** Harness version to record; empty string records an absent value. */
  readonly harnessVersion?: string
  /** Explicit snapshot id; `createBackupId()` when omitted. */
  readonly backupId?: string
}

/**
 * Take a full byte-for-byte snapshot of a source store into the backup store,
 * recording a canonical manifest and its tamper-anchor sha256 beside the
 * copied tree.
 * @param options - source, backup store root, and provenance stamps.
 * @returns the backup directory and the recorded manifest.
 */
export async function takeBackup(options: TakeBackupOptions): Promise<BackupSnapshot> {
  const sourceRoot = resolve(options.sourceRoot)
  const backupId = options.backupId ?? createBackupId()
  const snapshotRoot = join(resolve(options.backupRoot), backupId)
  const treeRoot = join(snapshotRoot, 'tree')
  await mkdir(treeRoot, { recursive: true })

  const entries: BackupEntry[] = []
  for (const sourceFile of await listRegularFiles(sourceRoot)) {
    const relPath = relative(sourceRoot, sourceFile).split(sep).join('/')
    assertSafeRelPath(relPath)
    const bytes = await readFile(sourceFile)
    const target = join(treeRoot, ...relPath.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(sourceFile, target)
    entries.push({
      relPath,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }

  const manifest: BackupManifest = {
    backupId,
    createdAt: typeof options.backupId === 'string'
      ? Number(options.backupId.split('-')[0])
      : Date.now(),
    sourceRoot,
    sessionFormatVersion: options.sessionFormatVersion,
    harnessVersion: options.harnessVersion ?? '',
    entries: entries.sort((a, b) => a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0),
  }

  const text = canonicalBackupManifest(manifest)
  const manifestPath = join(snapshotRoot, 'manifest.json')
  await writeFile(manifestPath, text, 'utf8')
  await writeFile(join(snapshotRoot, 'MANIFEST.sha256'), createHash('sha256').update(text).digest('hex'), 'utf8')
  return { backupDir: snapshotRoot, manifest }
}

/** Whether a parsed value looks like a {@link BackupManifest}. */
function isBackupManifest(value: unknown): value is BackupManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record['backupId'] === 'string'
    && typeof record['createdAt'] === 'number'
    && typeof record['sourceRoot'] === 'string'
    && typeof record['sessionFormatVersion'] === 'number'
    && typeof record['harnessVersion'] === 'string'
    && Array.isArray(record['entries'])
}

/**
 * Read and shape-validate one backup's manifest from disk.
 * @param backupDir - the snapshot directory (contains `manifest.json`).
 * @returns the parsed manifest.
 * @throws when `manifest.json` is absent or not a valid manifest.
 */
export async function readBackupManifest(backupDir: string): Promise<BackupManifest> {
  const raw = await readFile(join(backupDir, 'manifest.json'), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isBackupManifest(parsed)) {
    throw new Error(`backup at "${backupDir}" has a malformed manifest.json`)
  }
  return parsed
}

/**
 * Immutable view of one stored backup, cheapest to read.
 * @param backupDir - the directory holding the backup.
 * @returns the backup summary.
 */
export async function readBackupSummary(backupDir: string): Promise<BackupSummary> {
  const manifest = await readBackupManifest(backupDir)
  return {
    backupDir: resolve(backupDir),
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    sessionFormatVersion: manifest.sessionFormatVersion,
    harnessVersion: manifest.harnessVersion,
    entryCount: manifest.entries.length,
    totalBytes: manifest.entries.reduce((sum, entry) => sum + entry.size, 0),
  }
}

/**
 * List stored backups newest-first. Directories without a valid `manifest.json`
 * are silently ignored (a backup root may share space with other data).
 * @param backupRoot - the backup store root to scan.
 * @returns one summary per valid backup, newest first.
 */
export async function listBackups(backupRoot: string): Promise<BackupSummary[]> {
  const root = resolve(backupRoot)
  const summaries: BackupSummary[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      summaries.push(await readBackupSummary(join(root, entry.name)))
    } catch {
      // Not a valid backup directory; ignore.
    }
  }
  return summaries.sort((a, b) =>
    a.backupId < b.backupId ? 1 : a.backupId > b.backupId ? -1 : 0)
}

/**
 * Revalidate a backup against its manifest: the manifest must be byte-unaltered
 * against its recorded `MANIFEST.sha256`, and every content file must match its
 * recorded size and sha256.
 * @param backupDir - the snapshot directory to verify.
 * @returns a verdict plus every differing content path.
 */
export async function verifyBackup(backupDir: string): Promise<BackupVerification> {
  const manifestPath = join(backupDir, 'manifest.json')
  let manifest; try { manifest = await readBackupManifest(backupDir) } catch (error) {
    return { valid: false, mismatches: [{ relPath: 'manifest.json', reason: 'missing' as const }] }
  }
  const recordedAnchor = await readFile(join(backupDir, 'MANIFEST.sha256'), 'utf8')
  const manifestBytes = await readFile(manifestPath, 'utf8')
  if (createHash('sha256').update(manifestBytes).digest('hex') !== recordedAnchor.trim()) {
    return { valid: false, mismatches: [{ relPath: 'manifest.json', reason: 'hash' as const }] }
  }

  const mismatches: BackupMismatch[] = []
  const treeRoot = join(backupDir, 'tree')
  for (const entry of manifest.entries) {
    assertSafeRelPath(entry.relPath)
    const path = join(treeRoot, ...entry.relPath.split('/'))
    let stats; try { stats = await stat(path) } catch {
      mismatches.push({ relPath: entry.relPath, reason: 'missing' })
      continue
    }
    if (stats.size !== entry.size) {
      mismatches.push({ relPath: entry.relPath, reason: 'size' })
      continue
    }
    if (await sha256File(path) !== entry.sha256) {
      mismatches.push({ relPath: entry.relPath, reason: 'hash' })
    }
  }
  return { valid: mismatches.length === 0, mismatches }
}

/** Options for {@link restoreBackup}. */
export interface RestoreBackupOptions {
  /** Directory where restored content is written; created if absent. */
  readonly restoreRoot: string
  /** Replace an existing target whose bytes differ (default false: refuse). */
  readonly overwrite?: boolean
}

/**
 * Restore a fully-verified backup into a target directory. A backup that fails
 * {@link verifyBackup} is refused outright. Content already byte-identical at
 * the target is skipped; different-bytes targets are refused (or replaced only
 * when `overwrite` is granted) — never clobbered silently.
 * @param backupDir - the snapshot directory to restore.
 * @param options - restore target and overwrite policy.
 * @returns how many files were written and how many identical ones were skipped.
 * @throws {@link BackupNotVerifiableError} on a failed-verification backup.
 * @throws {@link BackupConflictError} when a target holds different bytes and overwrite is not granted.
 */
export async function restoreBackup(
  backupDir: string,
  options: RestoreBackupOptions,
): Promise<BackupRestoreResult> {
  const verification = await verifyBackup(backupDir)
  if (!verification.valid) {
    const misfits = verification.mismatches
      .map(mismatch => `${mismatch.relPath} (${mismatch.reason})`)
      .join(', ')
    throw new BackupNotVerifiableError(misfits || 'unknown')
  }

  const manifest = await readBackupManifest(backupDir)
  const restoreRoot = resolve(options.restoreRoot)
  const treeRoot = join(backupDir, 'tree')
  const conflicts: string[] = []
  const identities = new Map<string, string>()
  for (const entry of manifest.entries) {
    assertSafeRelPath(entry.relPath)
    const target = join(restoreRoot, ...entry.relPath.split('/'))
    identities.set(entry.relPath, await sha256File(join(treeRoot, ...entry.relPath.split('/'))))
    let existing; try { existing = await stat(target) } catch { continue }
    if (existing.isFile() && await sha256File(target) !== identities.get(entry.relPath)) {
      conflicts.push(entry.relPath)
    }
  }
  if (conflicts.length > 0 && options.overwrite !== true) {
    throw new BackupConflictError(conflicts, false)
  }

  let restored = 0
  let skippedIdentical = 0
  for (const entry of manifest.entries) {
    const target = join(restoreRoot, ...entry.relPath.split('/'))
    const source = join(treeRoot, ...entry.relPath.split('/'))
    let identical = false
    try { identical = await sha256File(target) === identities.get(entry.relPath) } catch { identical = false }
    if (identical) {
      skippedIdentical += 1
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    restored += 1
  }
  return { restored, skippedIdentical }
}