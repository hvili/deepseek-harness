/** Cross-process ownership lock for interactive Harness Hosts. */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hostname } from 'node:os'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import lockfile from 'proper-lockfile'

/** Stable Cordis plugin name. */
export const name = 'host-instance-lock'

/** Lock owner modes surfaced to a contending launcher. */
export type InteractiveHostMode = 'web' | 'desktop'

/** Persisted, non-secret lock owner information. */
export interface HostLockOwner {
  /** Owning process id. */
  pid: number
  /** Interactive surface that acquired the lock. */
  mode: InteractiveHostMode
  /** Machine name for diagnostics. */
  hostname: string
  /** ISO acquisition timestamp. */
  acquiredAt: string
}

/** Instance lock configuration. */
export interface Config {
  /** Stable lock target shared by Web and desktop launchers. */
  path: string
  /** Current interactive surface. */
  mode: InteractiveHostMode
  /** Milliseconds after which an unrefreshed lock may be recovered. */
  staleMs?: number
}

/** Validated configuration schema. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  mode: z.union([z.const('web'), z.const('desktop')]).required(),
  staleMs: z.natural().min(5_000).default(15_000),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current interactive Host ownership record. */
    hostInstanceLock: HostInstanceLock
  }
}

/** Error reported when another interactive Host owns the shared Home. */
export class HostLockContendedError extends Error {
  /**
   * @param path - shared lock target.
   * @param owner - readable owner metadata, when available.
   */
  constructor(readonly path: string, readonly owner?: HostLockOwner) {
    const detail = owner === undefined
      ? 'another interactive Host owns the shared Harness home'
      : `${owner.mode} Host PID ${String(owner.pid)} owns the shared Harness home`
    super(`dsh: ${detail}`)
    this.name = 'HostLockContendedError'
  }
}

/** Service owning one proper-lockfile lease until its Cordis fiber disposes. */
export class HostInstanceLock extends Service {
  static Config = Config
  private currentOwner: HostLockOwner | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'hostInstanceLock')
  }

  /** Current ownership record after activation. */
  get owner(): HostLockOwner | undefined {
    return this.currentOwner
  }

  /** Acquire the shared lease and publish owner metadata. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    await mkdir(dirname(this.config.path), { recursive: true })
    let release: () => Promise<void>
    try {
      release = await lockfile.lock(this.config.path, {
        realpath: false,
        retries: 0,
        stale: this.config.staleMs ?? 15_000,
        update: Math.max(1_000, Math.floor((this.config.staleMs ?? 15_000) / 3)),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error
      throw new HostLockContendedError(this.config.path, await readOwner(this.config.path))
    }
    const owner: HostLockOwner = {
      pid: process.pid,
      mode: this.config.mode,
      hostname: hostname(),
      acquiredAt: new Date().toISOString(),
    }
    try {
      await writeFile(ownerPath(this.config.path), JSON.stringify(owner) + '\n', { encoding: 'utf8' })
    } catch (error) {
      await release()
      throw error
    }
    this.currentOwner = owner
    yield async () => {
      this.currentOwner = undefined
      await release()
      await removeOwner(this.config.path, owner)
    }
  }
}

function ownerPath(path: string): string {
  return `${path}.owner.json`
}

async function readOwner(path: string): Promise<HostLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(ownerPath(path), 'utf8')) as Partial<HostLockOwner>
    if (typeof value.pid !== 'number' || (value.mode !== 'web' && value.mode !== 'desktop')
      || typeof value.hostname !== 'string' || typeof value.acquiredAt !== 'string') return undefined
    return value as HostLockOwner
  } catch {
    return undefined
  }
}

/** Remove only this lease's metadata; a new owner may already have replaced it. */
async function removeOwner(path: string, owner: HostLockOwner): Promise<void> {
  const current = await readOwner(path)
  if (current?.pid !== owner.pid || current.mode !== owner.mode || current.acquiredAt !== owner.acquiredAt) return
  try {
    await unlink(ownerPath(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export default HostInstanceLock
