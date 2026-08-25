import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BackupConflictError,
  BackupNotVerifiableError,
  canonicalBackupManifest,
  createBackupId,
  listBackups,
  readBackupManifest,
  restoreBackup,
  takeBackup,
  verifyBackup,
} from '../src/index.ts'

const sha256Of = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

/** A sessions store shaped like the JSONL backend's per-project/per-session layout. */
async function makeStore(root: string, files: ReadonlyArray<readonly [relPath: string, content: string]>): Promise<void> {
  for (const [rel, content] of files) {
    const target = join(root, ...rel.split('/'))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
}

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

const STORE_FILES: readonly [relPath: string, content: string][] = [
  ['proj-a/sess-1/main.jsonl.zstd', '{"type":"session","version":1}\n{"type":"event"}\n'],
  ['proj-a/sess-2/main.jsonl.zstd', '{"type":"session","version":1}\n'],
  ['proj-b/deep/nested/sess-3/main.jsonl.zstd', 'empty tail\n'],
]

describe('createBackupId / canonicalBackupManifest', () => {
  it('formats the overwrite-granted conflict diagnostic', () => {
    expect(new BackupConflictError(['a.jsonl'], true).message)
      .toContain('conflicts with existing content')
  })

  it('mints sortable, unique ids from a timestamp prefix', () => {
    const older = createBackupId(1_000)
    const newer = createBackupId(9_000)
    expect(older < newer).toBe(true)
    expect(createBackupId(5_000)).not.toBe(createBackupId(5_000))
  })

  it('serializes equal manifests to identical bytes regardless of key order', () => {
    const a = canonicalBackupManifest({ backupId: '1', createdAt: 1, sourceRoot: '/s', sessionFormatVersion: 2, harnessVersion: 'v', entries: [{ relPath: 'a', size: 1, sha256: 'aa' }] })
    const b = canonicalBackupManifest({ entries: [{ sha256: 'aa', size: 1, relPath: 'a' }], createdAt: 1, harnessVersion: 'v', sessionFormatVersion: 2, sourceRoot: '/s', backupId: '1' })
    expect(a).toBe(b)
  })
})

describe('takeBackup', () => {
  it('snapshots nested files, records hashes/sizes, and anchors the manifest', async () => {
    const source = await tempDir('dshb-src-')
    const backupRoot = await tempDir('dshb-root-')
    await makeStore(source, STORE_FILES)

    const { backupDir, manifest } = await takeBackup({
      sourceRoot: source, backupRoot,
      sessionFormatVersion: 7, harnessVersion: '1.2.3', backupId: '1000-abc',
    })

    expect(backupDir).toBe(join(backupRoot, '1000-abc'))
    expect(manifest.backupId).toBe('1000-abc')
    expect(manifest.createdAt).toBe(1000)
    expect(manifest.sessionFormatVersion).toBe(7)
    expect(manifest.harnessVersion).toBe('1.2.3')
    expect(manifest.entries.map(entry => entry.relPath)).toEqual([
      'proj-a/sess-1/main.jsonl.zstd',
      'proj-a/sess-2/main.jsonl.zstd',
      'proj-b/deep/nested/sess-3/main.jsonl.zstd',
    ])
    const expectedShas = STORE_FILES.map(([, content]) => sha256Of(content))
    expect(manifest.entries.map(entry => entry.sha256)).toEqual(expectedShas)
    expect(manifest.entries.map(entry => entry.size)).toEqual(
      STORE_FILES.map(([, content]) => Buffer.byteLength(content)),
    )

    // The tamper-anchor bytes match the exact canonical manifest on disk.
    const manifestBytes = await readFile(join(backupDir, 'manifest.json'), 'utf8')
    const anchor = await readFile(join(backupDir, 'MANIFEST.sha256'), 'utf8')
    expect(sha256Of(manifestBytes)).toBe(anchor.trim())
    expect(manifestBytes).toBe(canonicalBackupManifest(manifest))

    // Every source byte is reproduced under tree/.
    for (const [rel, content] of STORE_FILES) {
      expect(await readFile(join(backupDir, 'tree', ...rel.split('/')), 'utf8')).toBe(content)
    }
  })

  it('records no entries for an empty store yet still writes the anchors', async () => {
    const source = await tempDir('dshb-empty-')
    const backupRoot = await tempDir('dshb-root-')
    const { manifest } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    expect(manifest.entries).toEqual([])
    const anchor = await readFile(join(backupRoot, manifest.backupId, 'MANIFEST.sha256'), 'utf8')
    expect(anchor.trim()).toBe(sha256Of(canonicalBackupManifest(manifest)))
  })
})

describe('listBackups / readBackupManifest', () => {
  it('lists valid backups newest-first and ignores non-backup directories', async () => {
    const source = await tempDir('dshb-ls-src-')
    const backupRoot = await tempDir('dshb-ls-root-')
    await makeStore(source, [['only.jsonl', 'x']])
    await mkdir(join(backupRoot, 'not-a-backup'))
    await writeFile(join(backupRoot, 'not-a-directory'), 'ignore', 'utf8')

    await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1, backupId: '2000-old' })
    await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1, backupId: '3000-new' })

    const summaries = await listBackups(backupRoot)
    expect(summaries.map(s => s.backupId)).toEqual(['3000-new', '2000-old'])
    expect(summaries[0]?.entryCount).toBe(1)
    expect(summaries[0]?.totalBytes).toBe(1)
    expect(summaries[0]?.backupDir).toBe(join(backupRoot, '3000-new'))
  })

  it('round-trips the manifest through the read path', async () => {
    const source = await tempDir('dshb-rt-src-')
    const backupRoot = await tempDir('dshb-rt-root-')
    await makeStore(source, [['a/b.jsonl', 'data']])
    const { backupDir, manifest } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 3 })
    expect(await readBackupManifest(backupDir)).toEqual(manifest)
  })

  it('rejects non-object manifest shapes', async () => {
    const backupDir = await tempDir('dshb-malformed-')
    for (const value of [null, []]) {
      await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(value), 'utf8')
      await expect(readBackupManifest(backupDir)).rejects.toThrow('malformed manifest.json')
    }
  })
})

describe('verifyBackup', () => {
  it('rejects every unsafe manifest entry path form', async () => {
    const source = await tempDir('dshb-path-src-')
    const backupRoot = await tempDir('dshb-path-root-')
    await makeStore(source, [['safe.jsonl', 'x']])
    const { backupDir, manifest } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    for (const relPath of ['', '/absolute', 'C:/absolute', '../escape']) {
      const text = canonicalBackupManifest({
        ...manifest,
        entries: [{ ...manifest.entries[0]!, relPath }],
      })
      await writeFile(join(backupDir, 'manifest.json'), text, 'utf8')
      await writeFile(join(backupDir, 'MANIFEST.sha256'), sha256Of(text), 'utf8')
      await expect(verifyBackup(backupDir)).rejects.toThrow('unsafe backup entry path')
    }
  })

  it('accepts an intact backup', async () => {
    const source = await tempDir('dshb-v-src-')
    const backupRoot = await tempDir('dshb-v-root-')
    await makeStore(source, STORE_FILES)
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    expect(await verifyBackup(backupDir)).toEqual({ valid: true, mismatches: [] })
  })

  it('detects a tampered content file by hash', async () => {
    const source = await tempDir('dshb-t-src-')
    const backupRoot = await tempDir('dshb-t-root-')
    await makeStore(source, [['f.jsonl', 'original']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    await writeFile(join(backupDir, 'tree', 'f.jsonl'), 'tampered', 'utf8')
    const result = await verifyBackup(backupDir)
    expect(result.valid).toBe(false)
    expect(result.mismatches).toEqual([{ relPath: 'f.jsonl', reason: 'hash' }])
  })

  it('detects a removed content file', async () => {
    const source = await tempDir('dshb-m-src-')
    const backupRoot = await tempDir('dshb-m-root-')
    await makeStore(source, [['g.jsonl', 'data']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    await rm(join(backupDir, 'tree', 'g.jsonl'))
    const result = await verifyBackup(backupDir)
    expect(result.valid).toBe(false)
    expect(result.mismatches).toEqual([{ relPath: 'g.jsonl', reason: 'missing' }])
  })

  it('detects a manifest changed without re-anchoring', async () => {
    const source = await tempDir('dshb-j-src-')
    const backupRoot = await tempDir('dshb-j-root-')
    await makeStore(source, [['h.jsonl', 'data']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    const manifest = await readBackupManifest(backupDir)
    await writeFile(join(backupDir, 'manifest.json'), canonicalBackupManifest({ ...manifest, harnessVersion: 'forged' }), 'utf8')
    const result = await verifyBackup(backupDir)
    expect(result.valid).toBe(false)
    expect(result.mismatches).toEqual([{ relPath: 'manifest.json', reason: 'hash' }])
  })
})

describe('restoreBackup', () => {
  it('refuses a tampered backup outright', async () => {
    const source = await tempDir('dshb-rb-t-src-')
    const backupRoot = await tempDir('dshb-rb-t-root-')
    await makeStore(source, [['f.jsonl', 'original']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    await writeFile(join(backupDir, 'tree', 'f.jsonl'), 'tampered', 'utf8')
    await expect(restoreBackup(backupDir, { restoreRoot: await tempDir('dshb-rb-t-out-') }))
      .rejects.toBeInstanceOf(BackupNotVerifiableError)
  })

  it('round-trips bytes into an empty restore root, preserving nested layout', async () => {
    const source = await tempDir('dshb-rb-src-')
    const backupRoot = await tempDir('dshb-rb-root-')
    await makeStore(source, STORE_FILES)
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    const restoreRoot = await tempDir('dshb-rb-out-')

    const result = await restoreBackup(backupDir, { restoreRoot })
    expect(result.restored).toBe(STORE_FILES.length)
    expect(result.skippedIdentical).toBe(0)
    for (const [rel, content] of STORE_FILES) {
      expect(await readFile(join(restoreRoot, ...rel.split('/')), 'utf8')).toBe(content)
    }
  })

  it('refuses different-bytes targets and skips identical ones', async () => {
    const source = await tempDir('dshb-rb-c-src-')
    const backupRoot = await tempDir('dshb-rb-c-root-')
    await makeStore(source, [['keep.jsonl', 'identical'], ['change.jsonl', 'backup-copy']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    const restoreRoot = await tempDir('dshb-rb-c-out-')
    await makeStore(restoreRoot, [['keep.jsonl', 'identical'], ['change.jsonl', 'divergent-live']])

    await expect(restoreBackup(backupDir, { restoreRoot })).rejects.toSatisfy(
      (error: unknown) => error instanceof BackupConflictError
        && error.conflicts.includes('change.jsonl')
        && !error.conflicts.includes('keep.jsonl'),
    )
    // Nothing was clobbered by the refused restore.
    expect(await readFile(join(restoreRoot, 'change.jsonl'), 'utf8')).toBe('divergent-live')
  })

  it('overwrites only when granted', async () => {
    const source = await tempDir('dshb-rb-o-src-')
    const backupRoot = await tempDir('dshb-rb-o-root-')
    await makeStore(source, [['change.jsonl', 'backup-copy']])
    const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 1 })
    const restoreRoot = await tempDir('dshb-rb-o-out-')
    await makeStore(restoreRoot, [['change.jsonl', 'divergent-live']])

    const result = await restoreBackup(backupDir, { restoreRoot, overwrite: true })
    expect(result.restored).toBe(1)
    expect(result.skippedIdentical).toBe(0)
    expect(await readFile(join(restoreRoot, 'change.jsonl'), 'utf8')).toBe('backup-copy')
  })
})
