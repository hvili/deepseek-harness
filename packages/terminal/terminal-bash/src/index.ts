/**
 * Persistent shell PTY backend over the subprocess terminal primitive, shared
 * sandbox policy, bounded output, and provider-owned session cleanup.
 * @module @deepseek-ai/dsh-terminal-bash
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TerminalBackendCleanupError } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSpawnSpec, TerminalSendOperation } from '@deepseek-ai/dsh-terminal'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import { ENCODING_PREAMBLE } from '@deepseek-ai/dsh-pwsh-local'
import { type Config, type ResolvedConfig, resolveConfig, type ShellDialect, validateConfig } from './config.ts'
import { LocalPtySession } from './session.ts'
import { CONTROLLED_PROMPT } from './sanitize.ts'

export { Config } from './config.ts'
export type { Config as TerminalLocalConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'terminal-bash'
/** Required services: terminal registry, shared confinement policy, projection registry, and process substrate. */
export const inject = ['terminals', 'sandboxPolicy', 'sessionProjections', 'subprocess']

interface SandboxModeFenceState {
  pty: Context['terminals']
  sandboxPolicy: Context['sandboxPolicy']
  sessionProjections: Context['sessionProjections']
}

const sandboxModeFences = new WeakMap<Agent, SandboxModeFenceState>()

function ensureSandboxModeFence(ctx: Context, owner: Agent): void {
  const existing = sandboxModeFences.get(owner)
  if (existing !== undefined) {
    existing.pty = ctx.terminals
    existing.sandboxPolicy = ctx.sandboxPolicy
    existing.sessionProjections = ctx.sessionProjections
    return
  }
  const state: SandboxModeFenceState = {
    pty: ctx.terminals,
    sandboxPolicy: ctx.sandboxPolicy,
    sessionProjections: ctx.sessionProjections,
  }
  sandboxModeFences.set(owner, state)
  owner.ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (session !== owner.session || event.type !== 'sandbox/mode') return
    const folded = state.sessionProjections.stateOf(session, 'sandboxMode') ?? null
    const currentMode = folded ?? state.sandboxPolicy.defaultMode
    if (event.data.mode === currentMode || !state.pty.hasOwnerActivity(owner)) return
    throw new Error(
      `cannot change sandbox mode from "${currentMode}" to "${event.data.mode}" while persistent terminal sessions are open or being created; wait for creation to settle and close them first`,
    )
  }, { global: true })
}

function childEnvironment(spec: TerminalBackendSpawnSpec, dialect: ShellDialect): Record<string, string> {
  // The subprocess provider supplies its own scrubbed ambient base; these are
  // deliberate terminal-specific overrides layered after it.
  const common = {
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    DSH_SHELL: '1',
    DSH_SESSION_ID: spec.owner.id,
    DSH_PTY_SESSION_ID: spec.sessionId,
  }
  if (dialect === 'pwsh') {
    // pwsh ignores PS1/PROMPT_COMMAND; its prompt is installed by the startup
    // bootstrap instead, and NO_COLOR keeps the renderer quiet.
    return { ...common, NO_COLOR: '1' }
  }
  return {
    ...common,
    PS1: CONTROLLED_PROMPT,
    // Re-asserting PS1 after the marker keeps prompt readiness working when a
    // command overwrote the shell variable: bash runs PROMPT_COMMAND before
    // rendering each prompt, so an override never survives to the next prompt.
    PROMPT_COMMAND: `printf "\\033]133;D;%s\\007" "$?"; PS1='${CONTROLLED_PROMPT}'`,
    BASH_SILENCE_DEPRECATION_WARNING: '1',
  }
}

/**
 * The pwsh prompt function that emits the shared OSC `133;D;` + BEL marker
 * before every prompt, mirroring bash's PROMPT_COMMAND. `[char]27`/`[char]7`
 * build the control bytes at runtime because raw ESC characters in submitted
 * input are unreliable under PSReadLine.
 */
export const PWSH_PROMPT_SETUP =
  "function prompt { [Console]::Write([char]27 + ']133;D;' + [int]$LASTEXITCODE + [char]7); '" + CONTROLLED_PROMPT + "' }"

function spawnArgv(ctx: Context, config: ResolvedConfig, policy: SandboxExecutionPolicy): string[] {
  const argv = [config.shellPath, ...config.shellArgs]
  if (policy.mode === 'danger-full-access') return argv
  const sandbox = ctx.get('sandbox')
  if (sandbox === undefined) {
    throw new Error(`terminal-bash: sandbox mode "${policy.mode}" requires a ctx.sandbox provider in the execution world`)
  }
  // Re-state the discriminant because object spread does not preserve its narrowed type.
  return sandbox.confine(argv, { ...policy, mode: policy.mode }).argv
}

// TODO(pty-initialize-race-home): Fold this outer abort race into
// LocalPtySession.initialize when the send-state consolidation lands; the
// session already owns the send lifecycle the race protects.
async function startupSession(
  session: LocalPtySession,
  dialect: ShellDialect,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<void> {
  let startupOperation: TerminalSendOperation | undefined
  const start = async (): Promise<void> => {
    if (dialect === 'bash') {
      await session.initialize(signal)
      return
    }
    // pwsh cannot install its prompt from the environment. The setup must be
    // submitted through the session, and the first submission races the shell's
    // own startup: a line queued before pwsh's interactive loop runs is echoed
    // by the tty yet can be consumed by the shell's startup terminal probing
    // and never executed. A settled send is therefore not evidence that the
    // setup ran; readiness requires the owned prompt marker
    // (promptAcknowledged). An unacknowledged settle resubmits the setup — it
    // is idempotent — and from the third attempt alternates with a submitted
    // empty line that cancels a partially consumed line before the next
    // resubmission. The absolute deadline bounds every cycle.
    let viewport = ''
    let unacknowledged = 0
    for (;;) {
      startupOperation = session.startSend({
        text: unacknowledged > 0 && unacknowledged % 2 === 0 ? '' : ENCODING_PREAMBLE + PWSH_PROMPT_SETUP,
        submit: true,
        ...signal !== undefined ? { signal } : {},
      })
      const result = await startupOperation.done
      if (result.waitReason === 'session_exit') throw new Error('PTY shell exited during startup')
      if (result.waitReason === 'timeout') throw new Error('PTY shell did not reach readiness before startup timeout')
      if (result.viewport.length > 0) viewport = result.viewport
      if (session.promptAcknowledged) break
      unacknowledged += 1
    }
    // Resubmissions queue behind the shell's own reading, and the terminal's
    // own echo of the acknowledging line can render as a late burst that
    // carries marker evidence. Either would settle a send started now on
    // leftover startup output instead of its own command, so wait for the
    // output stream to go quiet first. The window stays below the
    // `inferred_idle` tier: the deadline still bounds the whole sequence.
    await session.quiesce(Math.min(config.idleSilenceMs, 500), config.timeoutMs, signal)
    session.motd = viewport
    session.motd = viewport
  }
  const races: Promise<void>[] = []
  let onAbort: (() => void) | undefined
  if (signal !== undefined) {
    const aborted = Promise.withResolvers<never>()
    onAbort = () => { aborted.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    races.push(aborted.promise)
  }
  let deadlineTimer: NodeJS.Timeout | undefined
  if (dialect === 'pwsh') {
    const deadline = Promise.withResolvers<never>()
    deadlineTimer = setTimeout(() => {
      startupOperation?.cancel()
      deadline.reject(new Error('PTY shell did not reach readiness before startup timeout'))
    }, config.timeoutMs)
    races.push(deadline.promise)
  }
  try {
    signal?.throwIfAborted()
    await Promise.race([start(), ...races])
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
    if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/** Local shell backend registered under the configured type. */
export class BashTerminalBackend implements TerminalBackend {
  readonly type: string

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly spawnTerminal: (
      spec: SubprocessTerminalSpawnSpec,
    ) => Promise<SubprocessTerminalHandle> = spec => ctx.subprocess.spawnTerminal(spec),
    private readonly createSession: (
      terminal: SubprocessTerminalHandle,
      config: ResolvedConfig,
    ) => LocalPtySession = (terminal, config) => new LocalPtySession(terminal, config),
  ) {
    this.type = config.backendType
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<LocalPtySession> {
    spec.signal?.throwIfAborted()
    ensureSandboxModeFence(this.ctx, spec.owner)
    const policy = this.ctx.sandboxPolicy.resolve({ session: spec.owner.session })
    const argv = spawnArgv(this.ctx, this.config, policy)
    if (argv[0] === undefined) throw new Error('terminal-bash: sandbox returned empty argv')
    const terminal = await this.spawnTerminal({
      argv,
      cwd: spec.cwd ?? policy.workspaceRoot,
      env: childEnvironment(spec, this.config.shellDialect),
      rows: this.config.rows,
      cols: this.config.cols,
      graceMs: this.config.disposeGraceMs,
      signal: spec.signal,
    })
    const session = this.createSession(terminal, this.config)
    try {
      await startupSession(session, this.config.shellDialect, this.config, spec.signal)
      return session
    } catch (error) {
      try {
        await session.close('PTY startup failed')
      } catch (closeError: unknown) {
        throw new TerminalBackendCleanupError(error, closeError)
      }
      throw error
    }
  }
}

/** Register the local PTY backend. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  validateConfig(resolved)
  ctx.terminals.registerBackend(new BashTerminalBackend(ctx, resolved))
}
