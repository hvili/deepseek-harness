/** Focused unit checks for the non-destructive Web/Host recovery gate. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRecoverySourceUnchanged, classifySymlinkError, copyRecoveryDataset, createRecoveryFixture,
  snapshotRecoverySource,
} from './product-web-recovery-support.ts'

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
})
