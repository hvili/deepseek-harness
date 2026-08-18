import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listBackups, readBackupManifest } from '@deepseek-ai/dsh-session-backup'
import {
  preflightUpgrade,
  runUpgrade,
  type UpgradeCoordinatorOptions,
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

/** Build coordinator options with a fixed probe and a writable store. */
function optionsFor(
  root: string,
  backupRoot: string,
  probe: (root: string) => Promise<number | undefined> | number | undefined,
  current = 2,
  harnessVersion?: string,
): UpgradeCoordinatorOptions {
  return {
    storeRoot: root,
    backupRoot,
    readFormatVersion: async storeRoot => await probe(storeRoot),
    currentFormatVersion: current,
    // exactOptionalPropertyTypes forbids `harnessVersion: undefined`, so set
    // the optional field only when the caller actually passed a version.
    ...(harnessVersion !== undefined ? { harnessVersion } : {}),
  }
}

describe('preflightUpgrade', () => {
  it('treats an empty store as nothing to do', async () => {
    const store = await tempDir('dshu-pf-empty-')
    const preflight = await preflightUpgrade(optionsFor(store, await tempDir('dshu-pf-r-'), () => undefined, 2))
    expect(preflight).toEqual({ from: undefined, stored: { action: 'none' } })
  })

  it('leaves a store already at the current version alone', async () => {
    const store = await tempDir('dshu-pf-same-')
    const preflight = await preflightUpgrade(optionsFor(store, await tempDir('dshu-pf-r-'), () => 2, 2))
    expect(preflight).toEqual({ from: 2, stored: { action: 'none' } })
  })

  it('decides migrate for an older store', async () => {
    const store = await tempDir('dshu-pf-old-')
    const preflight = await preflightUpgrade(optionsFor(store, await tempDir('dshu-pf-r-'), () => 1, 2))
    expect(preflight).toEqual({ from: 1, stored: { action: 'migrate', from: 1 } })
  })

  it('refuses a store newer than this build reads', async () => {
    const store = await tempDir('dshu-pf-new-')
    const preflight = await preflightUpgrade(optionsFor(store, await tempDir('dshu-pf-r-'), () => 3, 2))
    expect(preflight).toEqual({ from: 3, stored: { action: 'downgrade-refused', from: 3 } })
  })
})

describe('runUpgrade', () => {
  it('no-ops without creating a backup or running the migration when nothing is needed', async () => {
    const store = await tempDir('dshu-ru-none-')
    await writeFile(join(store, 'log.jsonl'), 'v2-content', 'utf8')
    const backupRoot = await tempDir('dshu-ru-none-r-')
    const migrate = vi.fn(async () => void 0)

    const result = await runUpgrade({ ...optionsFor(store, backupRoot, async root => (await readOrUndefined(join(root, 'log.jsonl'))) === 'v2-content' ? 2 : undefined, 2), migrate })

    expect(result.preflight.stored).toEqual({ action: 'none' })
    expect(result.backup).toBeUndefined()
    expect(result.migratedFrom).toBeUndefined()
    expect(migrate).not.toHaveBeenCalled()
    expect(await readdir(backupRoot)).toEqual([])
    expect(await readOrUndefined(join(store, 'log.jsonl'))).toBe('v2-content')
  })

  it('refuses a downgrade without touching the store or running the migration', async () => {
    const store = await tempDir('dshu-ru-down-')
    await writeFile(join(store, 'log.jsonl'), 'newer-content', 'utf8')
    const backupRoot = await tempDir('dshu-ru-down-r-')
    const migrate = vi.fn(async () => void 0)

    await expect(runUpgrade({ ...optionsFor(store, backupRoot, () => 5, 2), migrate })).rejects.toThrow(/requires format v5/)
    expect(migrate).not.toHaveBeenCalled()
    expect(await readdir(backupRoot)).toEqual([])
    expect(await readOrUndefined(join(store, 'log.jsonl'))).toBe('newer-content')
  })

  it('auto-backs-up, runs the migration, and reports the migrated-from version', async () => {
    const store = await tempDir('dshu-ru-ok-')
    await writeFile(join(store, 'log.jsonl'), 'old-content', 'utf8')
    const backupRoot = await tempDir('dshu-ru-ok-r-')
    const migrate = vi.fn(async (context: { storeRoot: string }) => {
      await writeFile(join(context.storeRoot, 'log.jsonl'), 'new-content', 'utf8')
    })

    const result = await runUpgrade({ ...optionsFor(store, backupRoot, () => 1, 2, '9.9.9'), migrate })

    expect(result.preflight.stored).toEqual({ action: 'migrate', from: 1 })
    expect(result.migratedFrom).toBe(1)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(migrate.mock.calls[0]![0]).toMatchObject({ to: 2, from: 1 })
    expect(await readOrUndefined(join(store, 'log.jsonl'))).toBe('new-content')

    // A verifiable pre-migration snapshot was recorded under the backup root.
    expect(result.backup).toBeDefined()
    const summaries = await listBackups(backupRoot)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.harnessVersion).toBe('9.9.9')
    expect(summaries[0]!.sessionFormatVersion).toBe(2)
    const manifest = await readBackupManifest(result.backup!.backupDir)
    expect(manifest.entries.map(entry => entry.relPath)).toEqual(['log.jsonl'])
    expect(manifest.entries[0]!.sha256).not.toBe(undefined)
    // The snapshot preserves the pre-migration bytes.
    expect(await readOrUndefined(join(result.backup!.backupDir, 'tree', 'log.jsonl'))).toBe('old-content')
  })

  it('atomically rolls back a failed migration to the exact pre-upgrade state', async () => {
    const store = await tempDir('dshu-ru-fail-')
    await mkdir(join(store, 'sess'), { recursive: true })
    await writeFile(join(store, 'sess', 'log.jsonl'), 'original-bytes', 'utf8')
    await writeFile(join(store, 'sess', 'meta.json'), 'original-meta', 'utf8')
    await writeFile(join(store, 'pre-existing.jsonl'), 'keep-me', 'utf8')
    const backupRoot = await tempDir('dshu-ru-fail-r-')

    const migrationError = new Error('mid-migration crash')
    const migrate = vi.fn(async (context: { storeRoot: string }) => {
      // Partial mutation: rewrite an existing file and create a new stray file.
      await writeFile(join(context.storeRoot, 'sess', 'log.jsonl'), 'half-migrated', 'utf8')
      await writeFile(join(context.storeRoot, 'sess', 'new-stray.jsonl'), 'stray', 'utf8')
      throw migrationError
    })

    await expect(runUpgrade({ ...optionsFor(store, backupRoot, () => 1, 2), migrate })).rejects.toBe(migrationError)

    // Every original file is byte-restored; the stray file the migration created is pruned.
    expect(await readOrUndefined(join(store, 'sess', 'log.jsonl'))).toBe('original-bytes')
    expect(await readOrUndefined(join(store, 'sess', 'meta.json'))).toBe('original-meta')
    expect(await readOrUndefined(join(store, 'pre-existing.jsonl'))).toBe('keep-me')
    await expect(stat(join(store, 'sess', 'new-stray.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})