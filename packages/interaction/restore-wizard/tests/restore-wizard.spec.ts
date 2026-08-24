import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
import { main, parsePreviewArgs, readPreview } from '../src/preview-reader.ts'

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
  await Promise.all(tmpRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
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
      {
        ...options(backupDir, liveStore, await tmp()),
        harnessVersion: 'test-harness',
        pruneOrphans: true,
      },
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

  it('supplies a stable mismatch when a seam cannot provide one', async () => {
    const seam: PreviewSeam = {
      confine: argv => ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }),
      spawn: () => Promise.resolve(JSON.stringify({ verified: false, impact: null })),
    }
    await expect(restoreWithApproval(
      seam,
      cmd,
      () => Promise.resolve(true),
      options('/backup', '/restore', '/rollback'),
    )).rejects.toThrow('snapshot not verifiable')
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
    const { reason: _reason, ...withoutReason } = options(backupDir, liveStore, await tmp())
    const result = await service.restore({ ...withoutReason, signal: new AbortController().signal })

    expect(result.outcome).toBe('declined')
    expect(approvals).toHaveLength(1)
  })

  it('constructs the real process seam and exposes list/preview helpers', async () => {
    const ctx = new Context()
    Object.defineProperty(ctx, 'sandbox', {
      value: { confine: (argv: readonly string[]): ConfinedArgv => ({
        argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [],
      }) },
    })
    const service = new RestoreWizardService(ctx, { previewCommand: cmd.previewCommand })
    expect(service.seam.confine(['node'], { mode: 'read-only', workspaceRoot: '/tmp' }).argv)
      .toEqual(['node'])
    await expect(service.seam.spawn([
      process.execPath,
      '-e',
      'process.stdout.write("preview-ok")',
    ])).resolves.toBe('preview-ok')
    await expect(service.seam.spawn([])).rejects.toThrow('restore preview command is empty')

    const liveStore = await tmp()
    const backupRoot = await tmp()
    const { backupDir } = await seedStore(backupRoot)
    const listed = await service.list(backupRoot)
    expect(listed[0]?.backupDir).toBe(backupDir)

    ;(service as unknown as { seam: PreviewSeam }).seam = fakeSandboxSeam().seam
    await expect(service.preview(options(backupDir, liveStore, await tmp())))
      .resolves.toMatchObject({ verified: true })
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

  it('rejects missing flags and values', () => {
    expect(() => parsePreviewArgs([])).toThrow('missing required flag --backup-dir')
    expect(() => parsePreviewArgs([
      '--backup-dir', '--restore-root', '/r', '--rollback-root', '/rr', '--session-format-version', '3',
    ])).toThrow('missing value for required flag --backup-dir')
  })

  it('propagates unexpected preview failures and writes the direct main result', async () => {
    const backupRoot = await tmp()
    const { backupDir } = await seedStore(backupRoot)
    const restoreFile = join(await tmp(), 'not-a-directory')
    await writeFile(restoreFile, 'file', 'utf8')
    await expect(readPreview({
      backupDir,
      restoreRoot: restoreFile,
      rollbackRoot: await tmp(),
      sessionFormatVersion: 3,
    })).rejects.toThrow()

    const output: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(String(chunk))
      return true
    }
    try {
      await main(previewArgv(cmd, options(backupDir, await tmp(), await tmp())).slice(2))
    } finally {
      process.stdout.write = originalWrite
    }
    expect(JSON.parse(output.join(''))).toMatchObject({ verified: true })
  })
})
