/**
 * Stateful Codex execution over a fresh package-local app-server process.
 * The adapter owns one process per turn and composes durable thread-reference
 * journaling supplied by the DSH Session owner.
 *
 * @module @deepseek-ai/dsh-subagent-codex/stateful-execution
 */

import {
  CodexAppServerClient,
  codexAppServerArgv,
  disposeCodexAppServerChild,
} from '@deepseek-ai/dsh-codex-app-server'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  CodexPersistentThreadClient,
  startCodexThreadWithWal,
  type CodexPersistentThreadOptions,
  type CodexThreadReference,
  type CodexThreadStartWal,
  recoverCodexThreadStartWal,
} from './thread-state.ts'

/** Durable operations supplied by the owning DSH Session persistence adapter. */
export interface CodexThreadJournal {
  /** Load the complete validated Session event log. */
  readonly load: (signal?: AbortSignal) => Promise<readonly SessionEvent[]>
  /** Persist a write-ahead record before or after the upstream side effect. */
  readonly appendWal: (entry: CodexThreadStartWal, signal?: AbortSignal) => Promise<void>
  /** Persist the final `codex/thread-reference` record before a turn begins. */
  readonly appendReference: (reference: CodexThreadReference, signal?: AbortSignal) => Promise<void>
}

/** Process and policy settings for one stateful Codex execution adapter. */
export interface CodexStatefulExecutionSpec {
  /** Absolute workspace accepted by the app-server's `thread/start`. */
  readonly cwd: string
  /** Persistent-thread policy selected by the product owner. */
  readonly threadOptions?: CodexPersistentThreadOptions
  /** Explicit child environment layered over the subprocess service scrub. */
  readonly env: Record<string, string>
  /** Process-tree termination grace owned by the subprocess service. */
  readonly disposeGraceMs: number
  /** Spawn operation from the DSH subprocess capability. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Durable Session event journal. Every method resolves only after durability. */
  readonly journal: CodexThreadJournal
}

/** A completed stateful Codex turn with its reused external reference. */
export interface CodexStatefulTurn {
  /** The persistent external identity used for this turn. */
  readonly reference: CodexThreadReference
  /** The selected final assistant text. */
  readonly text: string
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function textInput(input: readonly string[]): Array<{ type: 'text'; text: string; text_elements: [] }> {
  if (input.length === 0 || input.every(value => value.trim().length === 0)) {
    throw new Error('subagent-codex: stateful Codex turn input must not be empty')
  }
  return input.map(text => ({ type: 'text', text, text_elements: [] }))
}

/**
 * Executes one turn in a durable Codex thread. A fresh app-server process is
 * always disposed before this method resolves or rejects; native Codex state
 * survives only in its upstream-owned CODEX_HOME storage.
 */
export class CodexStatefulExecution {
  constructor(private readonly spec: CodexStatefulExecutionSpec) {}

  /**
   * Create or resume the recorded thread, then execute one text turn.
   * @param input - non-empty text parts passed to the official `turn/start` method.
   * @param signal - cancellation signal for the complete process and turn lifetime.
   * @returns the persisted external reference and selected final answer.
   */
  async execute(input: readonly string[], signal?: AbortSignal): Promise<CodexStatefulTurn> {
    const child = this.spec.spawn({
      argv: codexAppServerArgv(),
      cwd: this.spec.cwd,
      env: this.spec.env,
      graceMs: this.spec.disposeGraceMs,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    })
    const client = new CodexAppServerClient(
      child.stdout as NonNullable<SubprocessHandle['stdout']>,
      child.stdin as NonNullable<SubprocessHandle['stdin']>,
    )
    let threadId: string | undefined
    let turnId: string | undefined
    let finalAnswer: string | undefined
    const completed = Promise.withResolvers<void>()
    client.onRequest(async (method) => {
      throw new Error(`subagent-codex: unsupported stateful app-server request ${method}`)
    })
    client.onNotification((method, params) => {
      if (method === 'item/completed' && params.threadId === threadId && params.turnId === turnId) {
        const item = object(params.item, 'stateful item')
        if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase === null)) {
          if (typeof item.text !== 'string') throw new Error('subagent-codex: invalid stateful agent message')
          if (item.phase === 'final_answer' || finalAnswer === undefined) finalAnswer = item.text
        }
        return
      }
      if (method === 'turn/completed' && params.threadId === threadId) {
        const turn = object(params.turn, 'stateful completed turn')
        if (turn.id !== turnId) return
        if (turn.status !== 'completed') {
          completed.reject(new Error(`subagent-codex: stateful Codex turn ended with ${String(turn.status)}`))
        } else {
          completed.resolve()
        }
      }
    })
    const interrupt = (): void => {
      if (threadId !== undefined && turnId !== undefined) {
        client.request('turn/interrupt', { threadId, turnId }).catch(() => {})
      }
    }
    signal?.addEventListener('abort', interrupt, { once: true })
    try {
      signal?.throwIfAborted()
      client.start()
      await client.initialize({ name: 'dsh-stateful-codex', title: 'DSH Stateful Codex', version: '1' }, {}, signal)
      const persistent = new CodexPersistentThreadClient(client)
      const events = await this.spec.journal.load(signal)
      const stored = recoverCodexThreadStartWal(events)
      let reference: CodexThreadReference
      if (stored !== undefined) {
        if (!events.some(event => event.type === 'codex/thread-reference')) {
          await this.spec.journal.appendReference(stored, signal)
        }
        reference = await persistent.resume(stored, signal)
      } else {
        reference = await startCodexThreadWithWal(
          persistent,
          this.spec.cwd,
          this.spec.journal,
          this.spec.threadOptions,
          signal,
        )
      }
      const response = object(await client.request('turn/start', {
        threadId: reference.threadId,
        input: textInput(input),
      }, signal), 'stateful turn/start response')
      turnId = String(object(response.turn, 'stateful turn/start turn').id)
      threadId = reference.threadId
      await completed.promise
      if (finalAnswer === undefined || finalAnswer.trim().length === 0) {
        throw new Error('subagent-codex: stateful Codex turn completed without a final answer')
      }
      return { reference, text: finalAnswer }
    } finally {
      signal?.removeEventListener('abort', interrupt)
      client.close()
      await disposeCodexAppServerChild(child)
    }
  }
}
