import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HostInstanceLock, { HostLockContendedError } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function lockPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-lock-'))
  roots.push(root)
  return join(root, 'interactive-host')
}

describe('interactive Host lock', () => {
  it('reports the owning mode and PID to a contender, then releases on dispose', async () => {
    const path = await lockPath()
    const first = new Context()
    const firstLock = await first.plugin(HostInstanceLock, { path, mode: 'desktop', staleMs: 5_000 })
    await firstLock.await()
    const second = new Context()
    await expect(second.plugin(HostInstanceLock, { path, mode: 'web', staleMs: 5_000 }))
      .rejects.toMatchObject<Partial<HostLockContendedError>>({
        name: 'HostLockContendedError',
        owner: { mode: 'desktop', pid: process.pid },
      })
    await firstLock.dispose()
    const third = new Context()
    const thirdLock = await third.plugin(HostInstanceLock, { path, mode: 'web', staleMs: 5_000 })
    await thirdLock.await()
    expect(third.hostInstanceLock.owner?.mode).toBe('web')
    await thirdLock.dispose()
  })
})
