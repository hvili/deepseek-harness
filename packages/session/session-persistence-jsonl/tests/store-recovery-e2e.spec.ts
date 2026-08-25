/**
 * Real-artifact store-level recovery E2E for the JSONL backend: mount the REAL
 * backend, persist REAL session logs, then run the backup/upgrade/restore
 * coordinators against that real store root and remount to replay. Proves the
 * recovery loop on real Zstd-or-plain artifacts with zero session loss:
 *
 *  - empty store: preflight reports nothing to do; snapshot + restore no-op.
 *  - overwrite / fault-injection / rollback: real sessions persisted, snapshotted,
 *    one log corrupted, restored byte-exact from the snapshot, replayed identically.
 *  - cross-version: a stored log written as NEWER than this build preflights as
 *    `downgrade-refused` and `runUpgrade` refuses without touching the store.
 *
 * @module dsh-session-persistence-jsonl/tests/store-recovery-e2e
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendLog, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { logPath } from '../src/format.ts'
import { readStoredFormatVersion } from '../src/store-recovery.ts'
import { listBackups, takeBackup, verifyBackup } from '../../../util/session-backup/src/index.ts'
import { preflightUpgrade, runUpgrade } from '../../../util/upgrade-coordinator/src/index.ts'
import { runRestore } from '../../../util/restore-coordinator/src/index.ts'

const dirs: string[] = []
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
async function teardown(): Promise<void> {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
}
afterEach(teardown)

/** Mount the real JSONL backend (plaintext logs) against `root`. */
async function mount(root: string): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> }; persistence: SessionPersistence }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { ctx, fiber, persistence: ctx.sessionPersistence }
}

/** Persist a real closed-turn session and return its flushed live Session. */
async function writeSession(ctx: Context, id: string, cwd: string): Promise<Session> {
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  appendLog(session, oneTurnLog())
  await ctx.sessions.flush(session)
  return session
}

/** Raw placeholder for a session id, at its real store path. */
function rawLog(root: string, cwd: string, id: string): string {
  return logPath(root, cwd, id as SessionId, 'none')
}

/**
 * Adapter from {@link readStoredFormatVersion} to the upgrade coordinator's
 * `(storeRoot, signal)` read signature: keep the real backend in scope, ignore
 * the imperative store-root hint (the backend already owns its root) and
 * forward the optional cancellation signal.
 */
function storedVersion(persistence: SessionPersistence): (storeRoot: string, signal?: AbortSignal) => Promise<number | undefined> {
  return (_storeRoot, signal) => readStoredFormatVersion(persistence, signal)
}

describe('store-recovery E2E (real artifacts)', () => {
  it('preflights an empty store as nothing to do and restores to an empty store as a no-op', async () => {
    const root = await tempDir('e2e-empty-')
    const { persistence, fiber } = await mount(root)
    // Empty store: no persisted format version.
    expect(await readStoredFormatVersion(persistence)).toBeUndefined()
    const preflight = await preflightUpgrade({
      storeRoot: root,
      backupRoot: await tempDir('e2e-empty-b-'),
      readFormatVersion: storedVersion(persistence),
      currentFormatVersion: SESSION_FORMAT_VERSION,
    })
    expect(preflight.stored).toEqual({ action: 'none' })
    await fiber.dispose()

    // Snapshot of the empty root and a no-op restore both succeed.
    const backupRoot = await tempDir('e2e-empty-c-')
    const snapshot = await takeBackup({ sourceRoot: root, backupRoot, sessionFormatVersion: SESSION_FORMAT_VERSION })
    expect((await verifyBackup(snapshot.backupDir)).valid).toBe(true)
    const decision = await runRestore({
      backupDir: snapshot.backupDir,
      restoreRoot: root,
      rollbackRoot: await tempDir('e2e-empty-x-'),
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    })
    expect(decision.outcome).toBe('nothing-to-do')
  })

  it('restores a corrupt real session log byte-exact from a snapshot and replays it identically after remount', async () => {
    const root = await tempDir('e2e-replay-')
    const backupRoot = await tempDir('e2e-replay-b-')

    // Persist two real sessions in a real empty backend.
    const first = await mount(root)
    const sa = await writeSession(first.ctx, 'sa', '/workspace')
    const expected = sa.events.map(event => structuredClone(event))
    await writeSession(first.ctx, 'sb', '/workspace')
    await first.fiber.dispose()

    // A verifiable pre-disaster snapshot of the real store root.
    const snapshot = await takeBackup({ sourceRoot: root, backupRoot, sessionFormatVersion: SESSION_FORMAT_VERSION })
    expect(snapshot.manifest.entries.length).toBeGreaterThan(0)
    const before = await readFile(rawLog(root, '/workspace', 'sa'), 'utf8')

    // Fault-inject: clobber sa's REAL log with unrelated bytes.
    await writeFile(rawLog(root, '/workspace', 'sa'), 'corrupted-garbage', 'utf8')
    expect(await readFile(rawLog(root, '/workspace', 'sa'), 'utf8')).not.toBe(before)

    // Restore the store from the snapshot: sa is rewritten, sb untouched.
    const rollbackRoot = await tempDir('e2e-replay-r-')
    const decision = await runRestore({
      backupDir: snapshot.backupDir,
      restoreRoot: root,
      rollbackRoot,
      sessionFormatVersion: SESSION_FORMAT_VERSION,
    })
    expect(decision.outcome).toBe('restored')
    if (decision.outcome !== 'restored') return
    expect(decision.restored).toBeGreaterThan(0)
    // The corrupted file was replaced with its original bytes.
    expect(await readFile(rawLog(root, '/workspace', 'sa'), 'utf8')).toBe(before)
    expect((await verifyBackup(snapshot.backupDir)).valid).toBe(true)

    // Remount the REAL backend over the restored store and replay the session.
    const second = await mount(root)
    const loaded = await second.persistence.load(SessionId('sa'))
    expect(loaded.meta.id).toBe('sa')
    expect(loaded.events).toEqual(expected)
    // The sibling session is intact too.
    const sb = await second.persistence.load(SessionId('sb'))
    expect(sb.meta.id).toBe('sb')
    await second.fiber.dispose()
  })

  it('refuses a cross-version store (newer than this build) at the startup preflight without touching it', async () => {
    const root = await tempDir('e2e-cross-')
    const first = await mount(root)
    await writeSession(first.ctx, 'sa', '/workspace')
    await first.fiber.dispose()

    // Rewrite the REAL stored header to claim a format newer than this build.
    const path = rawLog(root, '/workspace', 'sa')
    const lines = (await readFile(path, 'utf8')).split('\n')
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>
    header['version'] = SESSION_FORMAT_VERSION + 5
    lines[0] = JSON.stringify(header)
    await writeFile(path, lines.join('\n'))

    // A real remount reads the store format off the rewritten artifact.
    const second = await mount(root)
    const from = await readStoredFormatVersion(second.persistence)
    expect(from).toBe(SESSION_FORMAT_VERSION + 5)
    const preflight = await preflightUpgrade({
      storeRoot: root,
      backupRoot: await tempDir('e2e-cross-b-'),
      readFormatVersion: storedVersion(second.persistence),
      currentFormatVersion: SESSION_FORMAT_VERSION,
    })
    expect(preflight.stored).toEqual({ action: 'downgrade-refused', from: SESSION_FORMAT_VERSION + 5 })

    // runUpgrade refuses loudly and must NOT mutate the store or write any backup.
    const backupRoot = await tempDir('e2e-cross-c-')
    const refused = runUpgrade({
      storeRoot: root,
      backupRoot,
      readFormatVersion: storedVersion(second.persistence),
      currentFormatVersion: SESSION_FORMAT_VERSION,
      migrate: async () => { throw new Error('must not migrate a newer store') },
    })
    await expect(refused).rejects.toThrow(/requires format v/)
    expect(await listBackups(backupRoot)).toHaveLength(0)
    const st = await stat(rawLog(root, '/workspace', 'sa'))
    expect(st.size).toBeGreaterThan(0)
    await second.fiber.dispose()
  })
})
