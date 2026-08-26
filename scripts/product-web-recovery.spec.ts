/** Focused unit checks for the non-destructive Web/Host recovery gate. */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRecoverySourceUnchanged, classifySymlinkError, copyRecoveryDataset, createRecoveryFixture,
  inspectRecoveryDataset, rebaseSessionJsonlForRecovery, snapshotRecoverySource,
} from './product-web-recovery-support.ts'
import {
  encodeSegment, projectDir,
} from '../packages/session/session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '../packages/session/session-persistence-jsonl/src/zstd.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const roots = temporaryRoots.splice(0)
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
})

describe('product Web recovery support', () => {
  it('keeps the source checksum stable while producing a rebased copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-product-web-recovery-'))
    temporaryRoots.push(root)
    const dataset = await createRecoveryFixture(root)
    const before = await snapshotRecoverySource(dataset)
    const copy = await copyRecoveryDataset(dataset, join(root, 'copy-world'))
    const storage = JSON.parse(await readFile(join(copy.home, 'storages', 'workspace.json'), 'utf8')) as {
      tables: { workspaces: Record<string, { path: string }> }
    }
    expect(storage.tables.workspaces[dataset.workspaceId]?.path).toBe(copy.workspace)
    expect(JSON.stringify(storage)).not.toContain(dataset.sourceWorkspace)
    const after = await snapshotRecoverySource(dataset)
    expect(() => { assertRecoverySourceUnchanged(before, after) }).not.toThrow()
  })

  it('classifies Windows symlink EPERM as an environment limitation only for the probe', () => {
    const error = Object.assign(new Error('symbolic link privilege unavailable'), { code: 'EPERM' })
    expect(classifySymlinkError(error, 'probe', 'win32')).toBe('environment-limitation')
    expect(classifySymlinkError(error, 'product-copy', 'win32')).toBe('product-failure')
    expect(classifySymlinkError(error, 'probe', 'linux')).toBe('product-failure')
  })

  it('rebases only the Session header cwd and preserves event content', () => {
    const sourceWorkspace = join('D:', 'source-workspace')
    const targetWorkspace = join('D:', 'copied-workspace')
    const userText = join(sourceWorkspace, 'nested', 'file.txt')
    const header = JSON.stringify({
      type: 'session', version: 2, id: 'session', createdAt: 1, cwd: sourceWorkspace, delegationDepth: 0,
    })
    const event = JSON.stringify({ type: 'user/message', seq: 0, time: 2, data: { text: userText } })

    const rebased = rebaseSessionJsonlForRecovery(`${header}\n${event}\n`, sourceWorkspace, targetWorkspace)
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>)

    expect(rebased[0]?.cwd).toBe(targetWorkspace)
    expect(rebased[1]).toEqual(JSON.parse(event))
  })

  it('accepts an attachment-free multi-frame zstd Session and preserves every event row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-product-web-recovery-zstd-'))
    temporaryRoots.push(root)
    const fixture = await createRecoveryFixture(root)
    const sessionDirectory = join(
      projectDir(join(fixture.sourceHome, 'sessions'), fixture.sourceWorkspace),
      encodeSegment(fixture.sessionId),
    )
    const plainPath = join(sessionDirectory, 'session.jsonl')
    const compressedPath = join(sessionDirectory, 'session.jsonl.zstd')
    const records = (await readFile(plainPath, 'utf8')).trimEnd().split(/\r?\n/u)
    const userEvent = JSON.parse(records[2] ?? '{}') as { data?: { content?: unknown[] } }
    if (userEvent.data === undefined || !Array.isArray(userEvent.data.content)) {
      throw new Error('fixture user event lost its content array')
    }
    userEvent.data.content = userEvent.data.content.filter(item => (
      typeof item !== 'object' || item === null || !('type' in item) || item.type !== 'image'
    ))
    records[2] = JSON.stringify(userEvent)
    const expectedEventRows = records.slice(1)
    const frames = await Promise.all([
      compressZstdFrame(`${records[0]}\n`),
      compressZstdFrame(`${expectedEventRows.join('\n')}\n`),
    ])
    await writeFile(compressedPath, Buffer.concat(frames))
    await unlink(plainPath)

    const dataset = await inspectRecoveryDataset(fixture.sourceHome, fixture.sourceWorkspace)
    expect(dataset.attachment).toBeUndefined()
    expect(dataset.homeProjection).toBe('selected-records')
    expect(dataset.workspaceProjection).toBe('isolated-empty')
    const copy = await copyRecoveryDataset(dataset, join(root, 'copy-world'))
    const copiedSession = join(
      projectDir(join(copy.home, 'sessions'), copy.workspace),
      encodeSegment(dataset.sessionId),
      'session.jsonl',
    )
    const copiedRecords = (await readFile(copiedSession, 'utf8')).trimEnd().split(/\r?\n/u)
    expect((JSON.parse(copiedRecords[0] ?? '{}') as { cwd?: string }).cwd).toBe(copy.workspace)
    expect(copiedRecords.slice(1)).toEqual(expectedEventRows)
    expect(existsSync(join(dirname(copiedSession), 'session.jsonl.zstd'))).toBe(false)
    expect(existsSync(join(copy.home, 'attachments'))).toBe(false)
    expect(existsSync(join(copy.workspace, 'recovery-fixture.txt'))).toBe(false)
  })

  it('fails closed when an image node has a malformed attachment reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-product-web-recovery-malformed-'))
    temporaryRoots.push(root)
    const fixture = await createRecoveryFixture(root)
    const plainPath = join(
      projectDir(join(fixture.sourceHome, 'sessions'), fixture.sourceWorkspace),
      encodeSegment(fixture.sessionId),
      'session.jsonl',
    )
    const records = (await readFile(plainPath, 'utf8')).trimEnd().split(/\r?\n/u)
    const userEvent = JSON.parse(records[2] ?? '{}') as {
      data?: { content?: Array<{ type?: string; attachment?: unknown }> }
    }
    const image = userEvent.data?.content?.find(item => item.type === 'image')
    if (image === undefined) throw new Error('fixture user event lost its image node')
    image.attachment = { attachmentId: fixture.attachment?.attachmentId }
    records[2] = JSON.stringify(userEvent)
    await writeFile(plainPath, `${records.join('\n')}\n`, 'utf8')

    await expect(inspectRecoveryDataset(fixture.sourceHome, fixture.sourceWorkspace))
      .rejects.toThrow('malformed image attachment reference')
  })
})
