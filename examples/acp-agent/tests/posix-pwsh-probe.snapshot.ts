// TEMPORARY DIAGNOSTIC — POSIX pwsh PTY probe.
//
// The hosted Linux snapshot lane is the only place a real POSIX pwsh runs a
// PTY under this harness. The persistent-pwsh snapshot has failed there for
// the whole fix series: a native interactive `pwsh -NoLogo -NoProfile` under
// TERM=dumb exits during startup, while `pwsh -NoExit -Command <bootstrap>`
// runs the bootstrap, renders the installed prompt, and then never consumes
// later PTY stdin. This probe drives pwsh directly through node-pty (no
// harness layers) and prints every chunk with timestamps plus the exit
// outcome, so one CI run identifies which launch contract a POSIX persistent
// session can rely on. It asserts nothing beyond "the probe ran" and must be
// deleted once the persistent pwsh path is settled.
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

interface ProbePty {
  readonly pid: number
  write(data: string): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

type PtySpawn = (file: string, args: string[], options: Record<string, unknown>) => ProbePty

const hasPwsh = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

function loadPtySpawn(): PtySpawn {
  // node-pty is a dependency of the local subprocess provider; resolving it
  // from that package keeps the probe inside the installed dependency graph
  // without adding a dependency to this example.
  const subprocessLocalUrl = import.meta.resolve('@deepseek-ai/dsh-subprocess-local')
  const ptyRequire = createRequire(subprocessLocalUrl) as (id: string) => { spawn: PtySpawn }
  return ptyRequire('node-pty').spawn
}

interface ProbeStep {
  readonly atMs: number
  readonly write?: string
}

async function runProbe(name: string, argv: string[], env: Record<string, string>, steps: ProbeStep[]): Promise<void> {
  const ptySpawn = loadPtySpawn()
  const cwd = mkdtempSync(join(tmpdir(), `dsh-pty-probe-${name}-`))
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt
  console.log(`PPROBE ${name} SPAWN argv=${JSON.stringify(argv)} env=${JSON.stringify(env)} cwd=${cwd}`)

  const exit = Promise.withResolvers<{ exitCode: number; signal: number | undefined }>()
  let pty: ProbePty | undefined
  try {
    pty = ptySpawn(argv[0] as string, argv.slice(1), {
      name: 'xterm',
      cols: 160,
      rows: 40,
      cwd,
      env: { ...process.env, ...env },
    })
    const dataDisposable = pty.onData((data) => {
      console.log(`PPROBE ${name} OUT t=${elapsed()} data=${JSON.stringify(data)}`)
    })
    const exitDisposable = pty.onExit(({ exitCode, signal }) => {
      console.log(`PPROBE ${name} EXIT t=${elapsed()} exitCode=${exitCode} signal=${signal ?? 'none'}`)
      exit.resolve({ exitCode, signal })
    })

    let cursor = 0
    for (const step of steps) {
      const remaining = step.atMs - elapsed()
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
      if (step.write !== undefined) {
        console.log(`PPROBE ${name} WRITE t=${elapsed()} data=${JSON.stringify(step.write)}`)
        pty.write(step.write)
      }
      cursor += 1
    }
    void cursor

    // Give post-command output and a natural exit up to 8s.
    const settled = await Promise.race([
      exit.promise.then(() => true),
      new Promise<false>(resolve => setTimeout(() => { resolve(false) }, 8_000)),
    ])
    if (!settled) console.log(`PPROBE ${name} STILL_RUNNING t=${elapsed()}`)
    dataDisposable.dispose()
    exitDisposable.dispose()
  } catch (error: unknown) {
    console.log(`PPROBE ${name} PROBE_ERROR t=${elapsed()} error=${JSON.stringify(String(error))}`)
    exit.resolve({ exitCode: -1, signal: undefined })
  } finally {
    try {
      pty?.kill()
    } catch {
      // The probe only guarantees the child is gone before the next one.
    }
  }
  await new Promise(resolve => setTimeout(resolve, 200))
}

describe.skipIf(process.platform !== 'linux' || !hasPwsh)('POSIX pwsh PTY probe (diagnostic)', () => {
  it('records launch contracts under TERM=dumb and xterm', { timeout: 120_000 }, async () => {
    const version = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' })
    console.log(`PPROBE VERSION pwsh=${JSON.stringify(version.stdout.trim())} status=${version.status}`)

    // Native interactive shell, harness TERM. Writes CR then LF submits.
    await runProbe('native-dumb', [resolvePwshPath(), '-NoLogo', '-NoProfile'], { TERM: 'dumb', NO_COLOR: '1' }, [
      { atMs: 1_500, write: 'Write-Output PPD1_CR_OK\r' },
      { atMs: 3_500, write: 'Write-Output PPD1_LF_OK\n' },
      { atMs: 5_500, write: 'exit\r' },
    ])

    // Native interactive shell with a real terminal type, same writes.
    await runProbe('native-xterm', [resolvePwshPath(), '-NoLogo', '-NoProfile'], { TERM: 'xterm-256color', NO_COLOR: '1' }, [
      { atMs: 1_500, write: 'Write-Output PPD2_CR_OK\r' },
      { atMs: 3_500, write: 'Write-Output PPD2_LF_OK\n' },
      { atMs: 5_500, write: 'exit\r' },
    ])

    // argv bootstrap via -NoExit -Command (the current POSIX harness shape).
    await runProbe('argv-command', [resolvePwshPath(), '-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Write-Output PPD3_BOOT'], { TERM: 'dumb', NO_COLOR: '1' }, [
      { atMs: 1_500, write: 'Write-Output PPD3_CR_OK\r' },
      { atMs: 3_500, write: 'Write-Output PPD3_LF_OK\n' },
      { atMs: 5_500, write: 'exit\r' },
    ])

    // Same argv bootstrap with PSReadLine removed before the interactive loop.
    await runProbe('argv-no-readline', [resolvePwshPath(), '-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Write-Output PPD4_BOOT; Remove-Module PSReadLine'], { TERM: 'dumb', NO_COLOR: '1' }, [
      { atMs: 1_500, write: 'Write-Output PPD4_CR_OK\r' },
      { atMs: 3_500, write: 'Write-Output PPD4_LF_OK\n' },
      { atMs: 5_500, write: 'exit\r' },
    ])

    // argv bootstrap that removes PSReadLine and then drives an explicit
    // [Console]::In reader, isolating the line-reader layer entirely.
    await runProbe('argv-explicit-reader', [
      resolvePwshPath(), '-NoLogo', '-NoProfile', '-NoExit', '-Command',
      'Write-Output PPD5_BOOT; Remove-Module PSReadLine; while ($true) { $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }; Invoke-Expression $line }',
    ], { TERM: 'dumb', NO_COLOR: '1' }, [
      { atMs: 1_500, write: 'Write-Output PPD5_CR_OK\r' },
      { atMs: 3_500, write: 'Write-Output PPD5_LF_OK\n' },
      { atMs: 5_500, write: 'exit\n' },
    ])

    expect(true).toBe(true)
  })
})
