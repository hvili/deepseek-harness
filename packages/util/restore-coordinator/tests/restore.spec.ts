import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listBackups,
  takeBackup,
} from '@deepseek-ai/dsh-session-backup'
import {
  planRestore,
  RestoreNotVerifiableError,
  runRestore,
  type RestoreCoordinatorOptions,
} from '../src/index.ts'

const scoped = new Set<string>()
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  scoped.add(dir)
  return dir
}
async function teardown(): Promise<void> {
  for (const dir of scoped) await rm(dir, { recursive: true, force: true })
  scoped.clear()
}
afterEach(teardown)

async function readOrUndefined(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8') } catch { return undefined }
}

/** Writable store shaped like the JSONL backend's per-project/per-session layout. */
async function makeStore(root: string, files: ReadonlyArray<readonly [relPath: string, content: string]>): Promise<void> {
  for (const [rel, content] of files) {
    const target = join(root, ...rel.split('/'))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
}

function opts(
  backupDir: string,
  restoreRoot: string,
  rollbackRoot: string,
  extra: Partial<RestoreCoordinatorOptions> = {},
): RestoreCoordinatorOptions {
  return { backupDir, restoreRoot, rollbackRoot, sessionFormatVersion: 2, ...extra }
}

/** Snapshot a one-off source store of the given files and return its backup dir. */
async function snapshotOf(backupRoot: string, files: ReadonlyArray<readonly [relPath: string, content: string]>): Promise<string> {
  const src = await tempDir('drc-snap-')
  await makeStore(src, files)
  return (await takeBackup({ sourceRoot: src, backupRoot, sessionFormatVersion: 2 })).backupDir
}

describe('planRestore', () => {
  it('refuses a snapshot that fails integrity verification', async () => {
    const backupRoot = await tempDir('drc-plan-t-r-')
    const backupDir = await snapshotOf(backupRoot, [['log.jsonl', 'A']])
    // Tamper with a content byte; the manifest anchor stays pristine.
    await writeFile(join(backupDir, 'tree', 'log.jsonl'), 'TAMPERED', 'utf8')

    await expect(planRestore(opts(backupDir, await tempDir('drc-plan-t-s-'), await tempDir('drc-plan-t-x-'))))
      .rejects.toBeInstanceOf(RestoreNotVerifiableError)
  })

  it('previews restore/missing/identical/orphan impact without mutating the target', async () => {
    const backupRoot = await tempDir('drc-plan-i-r-')
    const backupDir = await snapshotOf(backupRoot, [['a.json', 'A'], ['sub/b.json', 'B']])
    const store = await tempDir('drc-plan-i-s-')
    // 'b' matches the snapshot, 'c' is an orphan, 'a' is missing from the store.
    await makeStore(store, [['sub/b.json', 'B'], ['c.json', 'C']])

    const plan = await planRestore(opts(backupDir, store, await tempDir('drc-plan-i-x-')))
    expect(plan.verified).toBe(true)
    expect(plan.impact.toRestore).toEqual(['a.json'])
    expect(plan.impact.identical).toEqual(['sub/b.json'])
    expect(plan.impact.orphans).toEqual(['c.json'])
    // Preview must not mutate: store bytes are untouched.
    expect(await readOrUndefined(join(store, 'sub', 'b.json'))).toBe('B')
    expect(await readOrUndefined(join(store, 'c.json'))).toBe('C')
  })
})

describe('runRestore', () => {
  it('no-ops when the store already matches the snapshot', async () => {
    const backupRoot = await tempDir('drc-ru-none-r-')
    const backupDir = await snapshotOf(backupRoot, [['a.json', 'A']])
    const store = await tempDir('drc-ru-none-s-')
    await makeStore(store, [['a.json', 'A']])
    const rollbackRoot = await tempDir('drc-ru-none-x-')
    const approve = vi.fn(async () => true)

    const decision = await runRestore(opts(backupDir, store, rollbackRoot, { approve }))
    expect(decision.outcome).toBe('nothing-to-do')
    expect(approve).not.toHaveBeenCalled()
    expect(await listBackups(rollbackRoot)).toHaveLength(0)
  })

  it('declines on an injected approval denial without touching the store', async () => {
    const backupRoot = await tempDir('drc-ru-dec-r-')
    const backupDir = await snapshotOf(backupRoot, [['a.json', 'A']])
    const store = await tempDir('drc-ru-dec-s-')
    await makeStore(store, [['stray.json', 'S']])
    const rollbackRoot = await tempDir('drc-ru-dec-x-')

    const decision = await runRestore(opts(backupDir, store, rollbackRoot, { approve: async () => false }))
    expect(decision.outcome).toBe('declined')
    expect(await listBackups(rollbackRoot)).toHaveLength(0)
    expect(await readOrUndefined(join(store, 'stray.json'))).toBe('S')
  })

  it('restores missing/differing files, prunes orphans, records a rollback snapshot, and verifies bytes', async () => {
    const backupRoot = await tempDir('drc-ru-ok-r-')
    const backupDir = await snapshotOf(backupRoot, [['a.json', 'A'], ['sub/b.json', 'B']])
    const store = await tempDir('drc-ru-ok-s-')
    await makeStore(store, [['sub/b.json', 'STALE'], ['orphan.json', 'discard']])
    const rollbackRoot = await tempDir('drc-ru-ok-x-')

    const decision = await runRestore(opts(backupDir, store, rollbackRoot))
    expect(decision.outcome).toBe('restored')
    if (decision.outcome !== 'restored') return
    expect(decision.impact.toRestore).toEqual(['a.json', 'sub/b.json'])
    expect(decision.impact.orphans).toEqual(['orphan.json'])
    expect(decision.pruned).toBe(1) // orphan.json was pruned for exact restore

    expect(await readOrUndefined(join(store, 'a.json'))).toBe('A')
    expect(await readOrUndefined(join(store, 'sub', 'b.json'))).toBe('B')
    await expect(stat(join(store, 'orphan.json'))).rejects.toMatchObject({ code: 'ENOENT' })

    // A verifiable pre-restore snapshot of the live store was recorded.
    const summaries = await listBackups(rollbackRoot)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.sessionFormatVersion).toBe(2)
    expect(await readOrUndefined(join(summaries[0]!.backupDir, 'tree', 'orphan.json'))).toBe('discard')
  })

  it('keeps orphans when pruneOrphans is disabled', async () => {
    const backupRoot = await tempDir('drc-ru-nopp-r-')
    const backupDir = await snapshotOf(backupRoot, [['a.json', 'A']])
    const store = await tempDir('drc-ru-nopp-s-')
    await makeStore(store, [['kept.json', 'K']])
    const rollbackRoot = await tempDir('drc-ru-nopp-x-')

    const decision = await runRestore(opts(backupDir, store, rollbackRoot, { pruneOrphans: false }))
    expect(decision.outcome).toBe('restored')
    if (decision.outcome !== 'restored') return
    expect(decision.pruned).toBe(0)
    expect(await readOrUndefined(join(store, 'a.json'))).toBe('A')
    expect(await readOrUndefined(join(store, 'kept.json'))).toBe('K')
  })

  it('rolls the store back to the pre-restore snapshot when a restore fails mid-way', async () => {
    const backupRoot = await tempDir('drc-ru-fail-r-')
    const backupDir = await snapshotOf(backupRoot, [['log.jsonl', 'snapshot-bytes']])
    const store = await tempDir('drc-ru-fail-s-')
    // A directory at the snapshot path blocks the file copy, forcing a mid-restore failure.
    await mkdir(join(store, 'log.jsonl'))
    const rollbackRoot = await tempDir('drc-ru-fail-x-')

    await expect(runRestore(opts(backupDir, store, rollbackRoot))).rejects.toBeInstanceOf(Error)
    // The pre-restore state (the blocking directory) is left intact; the restore did not clobber it.
    const summaries = await listBackups(rollbackRoot)
    expect(summaries).toHaveLength(1)
    expect(await readOrUndefined(join(store, 'log.jsonl'))).toBeUndefined()
    const st = await stat(join(store, 'log.jsonl'))
    expect(st.isDirectory()).toBe(true)
  })
})
