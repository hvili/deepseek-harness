import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { takeBackup } from '@deepseek-ai/dsh-session-backup'
import { RestoreNotVerifiableError } from '@deepseek-ai/dsh-restore-coordinator'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import {
  previewArgv,
  previewRestore,
  restoreWithApproval,
  RestoreWizardService,
  type PreviewSeam,
  type RestoreWizardRunOptions,
} from '../src/index.ts'
import { parsePreviewArgs, readPreview } from '../src/preview-reader.ts'

const tmpRoots: string[] = []

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-restore-wizard-'))
  tmpRoots.push(dir)
  return dir
}

async function writeFileUnder(root: string, rel: string, content: string): Promise<void> {
  const parts = rel.split('/')
  const dir = parts.length > 1 ? parts.slice(0, -1).join(sep) : ''
  await mkdir(join(root, ...(dir === '' ? [] : dir.split(sep))), { recursive: true })
  await writeFile(join(root, ...parts), content, 'utf8')
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A fresh seeded source whose byte state can be snapshotted. */
async function seedStore(backupRoot: string): Promise<{ backupDir: string }> {
  const source = await tmp()
  await writeFileUnder(source, 'a.jsonl', 'good\n')
  await writeFileUnder(source, 'b.txt', 'bbb\n')
  const { backupDir } = await takeBackup({ sourceRoot: source, backupRoot, sessionFormatVersion: 3 })
  return { backupDir }
}

interface FakeSeam {
  seam: PreviewSeam
  confined: { argv: string[] | null; policy: SandboxPolicy | null }
}

/** Simulate the sandbox: record confinement, then run the preview-reader logic. */
function fakeSandboxSeam(): FakeSeam {
  const confined: { argv: string[] | null; policy: SandboxPolicy | null } = { argv: null, policy: null }
  const seam: PreviewSeam = {
    confine: (argv, policy): ConfinedArgv => {
      confined.argv = [...argv]
      confined.policy = policy
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    },
    spawn: async (argv) => {
      const args = parsePreviewArgs(argv.slice(2))
      const preview = await readPreview(args)
      return JSON.stringify(preview)
    },
  }
  return { seam, confined }
}

function options(backupDir: string, restoreRoot: string, rollbackRoot: string): RestoreWizardRunOptions {
  return {
    backupDir,
    restoreRoot,
    rollbackRoot,
    sessionFormatVersion: 3,
    agent: {} as Agent,
    reason: 'restore a corrupted store',
  }
}

const cmd = { nodeCommand: 'node', previewCommand: '/app/lib/preview-reader.js' }

describe('previewRestore (sandbox read-only)', () => {
  it('confines read-only at the restore root and returns the impact diff', async () => {
    const liveStore = await tmp()
    const backRoot = await tmp()
    const { backupDir } = await seedStore(backRoot)

    // Live store diverges: a.jsonl changed, c.txt is an orphan.
    await writeFileUnder(liveStore, 'a.jsonl', 'changed\n')
    await writeFileUnder(liveStore, 'c.txt', 'orphan\n')

    const fake = fakeSandboxSeam()
    const result = await previewRestore(fake.seam, cmd, options(backupDir, liveStore, await tmp()))

    expect(fake.confined.policy?.mode).toBe('read-only')
    expect(fake.confined.policy?.workspaceRoot).toBe(liveStore)
    expect(fake.confined.argv?.slice(0, 2)).toEqual(['node', '/app/lib/preview-reader.js'])
    expect(fake.confined.argv).toContain(backupDir)

    expect(result.verified).toBe(true)
    expect(result.impact?.toRestore).toContain('a.jsonl')
    // b.txt exists only in the snapshot, so it would be (re)written, not skipped.
    expect(result.impact?.toRestore).toContain('b.txt')
    expect(result.impact?.identical).toHaveLength(0)
    expect(result.impact?.orphans).toContain('c.txt')
  })
})

describe('restoreWithApproval (full loop)', () => {
  it('previews, asks approval with the impact, then restores when allowed', async () => {
    const liveStore = await tmp()
    const { backupDir } = await seedStore(await tmp())
    await writeFileUnder(liveStore, 'a.jsonl', 'bad\n')
    await writeFileUnder(liveStore, 'orphan.txt', 'stray\n')

    let approvedImpact: unknown
    const fake = fakeSandboxSeam()
    const result = await restoreWithApproval(
      fake.seam,
      cmd,
      async (impact) => {
        approvedImpact = impact
        return true
      },
      options(backupDir, liveStore, await tmp()),
    )

    expect(fake.confined.policy?.mode).toBe('read-only')
    expect(approvedImpact).toBeDefined()
    expect(result.outcome).toBe('restored')
    if (result.outcome === 'restored') {
      // Both a.jsonl (diverged) and b.txt (only in the snapshot) are restored.
      expect(result.restored).toBe(2)
      expect(await readFile(join(liveStore, 'a.jsonl'), 'utf8')).toBe('good\n')
    }
    // The orphan is pruned to reach the exact snapshot state.
    await expect(readFile(join(liveStore, 'orphan.txt'), 'utf8')).rejects.toThrow()
  })

  it('touches nothing and returns declined when approval is refused', async () => {
    const liveStore = await tmp()
    const { backupDir } = await seedStore(await tmp())
    await writeFileUnder(liveStore, 'a.jsonl', 'bad\n')

    const fake = fakeSandboxSeam()
    let asked = false
    const result = await restoreWithApproval(
      fake.seam,
      cmd,
      async () => {
        asked = true
        return false
      },
      options(backupDir, liveStore, await tmp()),
    )

    expect(asked).toBe(true)
    expect(result.outcome).toBe('declined')
    expect(await readFile(join(liveStore, 'a.jsonl'), 'utf8')).toBe('bad\n')
  })

  it('refuses an unverifiable snapshot without ever asking approval', async () => {
    const liveStore = await tmp()
    const { backupDir } = await seedStore(await tmp())
    // Tamper the snapshot so integrity verification fails.
    await writeFile(join(backupDir, 'manifest.json'), '{"tampered":true}', 'utf8')

    const fake = fakeSandboxSeam()
    let asked = false
    await expect(
      restoreWithApproval(
        fake.seam,
        cmd,
        async () => {
          asked = true
          return true
        },
        options(backupDir, liveStore, await tmp()),
      ),
    ).rejects.toBeInstanceOf(RestoreNotVerifiableError)
    expect(asked).toBe(false)
    expect(fake.confined.policy?.mode).toBe('read-only')
  })
})

describe('RestoreWizardService (real ctx.approval + ctx.sandbox wiring)', () => {
  function mountService(
    liveStore: string,
    backupDir: string,
    grant: string,
  ): { service: RestoreWizardService; approvals: unknown[] } {
    const approvals: unknown[] = []
    const sandbox = {
      confine: (argv: readonly string[]): ConfinedArgv =>
        ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }),
    }
    const approvalService = {
      request: async (req: unknown): Promise<string> => {
        approvals.push(req)
        return grant
      },
    }
    const service = Object.create(RestoreWizardService.prototype) as RestoreWizardService
    ;(service as unknown as { ctx: object }).ctx = { sandbox, approval: approvalService }
    service.config = { previewCommand: cmd.previewCommand, nodeCommand: cmd.nodeCommand }
    ;(service as unknown as { seam: PreviewSeam }).seam = {
      confine: sandbox.confine,
      spawn: async (argv: string[]) => JSON.stringify(await readPreview(parsePreviewArgs(argv.slice(2)))),
    }
    void liveStore
    void backupDir
    return { service, approvals }
  }

  it('asks ctx.approval for the exact restore before running it', async () => {
    const liveStore = await tmp()
    const { backupDir } = await seedStore(await tmp())
    await writeFileUnder(liveStore, 'a.jsonl', 'bad\n')
    const agent = { session: { events: [] } } as unknown as Agent

    const { service, approvals } = mountService(liveStore, backupDir, 'allowed-once')
    const result = await service.restore({ ...options(backupDir, liveStore, await tmp()), agent })

    expect(result.outcome).toBe('restored')
    expect(approvals).toHaveLength(1)
    const request = approvals[0] as { toolName: string; agent: Agent; reason: string }
    expect(request.toolName).toBe('restore_wizard')
    expect(request.agent).toBe(agent)
    expect(request.reason).toBe('restore a corrupted store')
  })

  it('fails closed to declined when ctx.approval rejects', async () => {
    const liveStore = await tmp()
    const { backupDir } = await seedStore(await tmp())
    await writeFileUnder(liveStore, 'a.jsonl', 'bad\n')

    const { service, approvals } = mountService(liveStore, backupDir, 'rejected')
    const result = await service.restore(options(backupDir, liveStore, await tmp()))

    expect(result.outcome).toBe('declined')
    expect(approvals).toHaveLength(1)
  })
})

describe('previewArgv', () => {
  it('builds the exact CLI shape the preview-reader parses', () => {
    const argv = previewArgv(cmd, options('/b', '/r', '/rollback'))
    expect(argv.slice(0, 2)).toEqual(['node', '/app/lib/preview-reader.js'])
    const parsed = parsePreviewArgs(argv.slice(2))
    expect(parsed).toMatchObject({ backupDir: '/b', restoreRoot: '/r', rollbackRoot: '/rollback' })
    expect(parsed.sessionFormatVersion).toBe(3)
  })
})