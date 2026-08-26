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

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: invalid ${label}`)
  }
  return value
}

type StatefulFailureStage =
  | 'aborted'
  | 'initialize'
  | 'journal'
  | 'thread'
  | 'turn-start'
  | 'turn'
  | 'protocol'
  | 'process'
  | 'interrupt'
  | 'teardown'

const STATEFUL_FAILURE_MESSAGES: Record<StatefulFailureStage, string> = {
  aborted: 'subagent-codex: stateful Codex execution was aborted',
  initialize: 'subagent-codex: stateful Codex initialization failed',
  journal: 'subagent-codex: stateful Codex Session journal failed',
  thread: 'subagent-codex: stateful Codex thread setup failed',
  'turn-start': 'subagent-codex: stateful Codex turn start failed',
  turn: 'subagent-codex: stateful Codex turn failed',
  protocol: 'subagent-codex: stateful Codex protocol failed',
  process: 'subagent-codex: stateful Codex app-server exited before turn completion',
  interrupt: 'subagent-codex: stateful Codex interrupt request failed',
  teardown: 'subagent-codex: stateful Codex process teardown failed',
}

class CodexStatefulExecutionError extends Error {
  constructor(
    readonly stage: StatefulFailureStage,
    message: string,
  ) {
    super(message)
    this.name = 'CodexStatefulExecutionError'
  }
}

function statefulFailure(stage: StatefulFailureStage, _cause?: unknown): CodexStatefulExecutionError {
  return new CodexStatefulExecutionError(stage, STATEFUL_FAILURE_MESSAGES[stage])
}

function persistedStateFailure(cause: unknown): CodexStatefulExecutionError {
  const message = cause instanceof Error ? cause.message : ''
  if (message.includes('requires reconciliation')) {
    return new CodexStatefulExecutionError(
      'thread',
      'subagent-codex: persisted Codex thread start requires reconciliation',
    )
  }
  if (message.includes('unsupported') || message.includes('version')) {
    return new CodexStatefulExecutionError(
      'thread',
      'subagent-codex: persisted Codex thread state is unsupported',
    )
  }
  if (message.includes('conflict')) {
    return new CodexStatefulExecutionError(
      'thread',
      'subagent-codex: persisted Codex thread state conflicts',
    )
  }
  return statefulFailure('thread', cause)
}

function normalizeStatefulFailure(
  error: unknown,
  stage: StatefulFailureStage,
  signal?: AbortSignal,
): Error {
  if (signal?.aborted) return statefulFailure('aborted', error)
  if (error instanceof CodexStatefulExecutionError) return error
  return statefulFailure(stage, error)
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
    let inputBlocks: ReturnType<typeof textInput> = []
    let child: SubprocessHandle | undefined
    let client: CodexAppServerClient | undefined
    let removeWireObservers = (): void => {}
    let cleanupFailure: unknown
    let executionFailure: unknown
    let executionFailed = false
    let result: CodexStatefulTurn | undefined

    try {
      signal?.throwIfAborted()
      inputBlocks = textInput(input)
      try {
        child = this.spec.spawn({
          argv: codexAppServerArgv(),
          cwd: this.spec.cwd,
          env: this.spec.env,
          graceMs: this.spec.disposeGraceMs,
          signal,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        })
      } catch (error: unknown) {
        throw statefulFailure('initialize', error)
      }

      const inputStream = child.stdout as NonNullable<SubprocessHandle['stdout']>
      const outputStream = child.stdin as NonNullable<SubprocessHandle['stdin']>
      client = new CodexAppServerClient(inputStream, outputStream)
      const terminalFailure = Promise.withResolvers<never>()
      const terminalCompletion = Promise.withResolvers<void>()
      let terminalSettled = false
      let threadId: string | undefined
      let turnId: string | undefined
      let finalAnswer: string | undefined
      const earlyNotifications: Array<{ method: string; params: Record<string, unknown> }> = []
      const fail = (error: CodexStatefulExecutionError): void => {
        if (terminalSettled) return
        terminalSettled = true
        terminalFailure.reject(error)
      }
      const complete = (): void => {
        if (terminalSettled) return
        terminalSettled = true
        terminalCompletion.resolve()
      }
      void terminalFailure.promise.catch(() => {})
      const waitFor = async <T>(pending: Promise<T>): Promise<T> => (
        await Promise.race([pending, terminalFailure.promise])
      )
      const processNotification = (method: string, params: Record<string, unknown>): void => {
        if (terminalSettled) return
        if (threadId === undefined || turnId === undefined) {
          if (method === 'item/completed' || method === 'turn/completed') {
            earlyNotifications.push({ method, params })
          }
          return
        }
        try {
          if (method === 'item/completed' && params.threadId === threadId && params.turnId === turnId) {
            const item = object(params.item, 'stateful item')
            if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase === null)) {
              if (typeof item.text !== 'string') throw statefulFailure('protocol')
              if (item.phase === 'final_answer' || finalAnswer === undefined) finalAnswer = item.text
            }
            return
          }
          if (method !== 'turn/completed') return
          if (params.threadId !== threadId) throw statefulFailure('protocol')
          const turn = object(params.turn, 'stateful completed turn')
          if (turn.id !== turnId || turn.status !== 'completed') throw statefulFailure('turn')
          complete()
        } catch (error: unknown) {
          fail(error instanceof CodexStatefulExecutionError ? error : statefulFailure('protocol', error))
        }
      }
      client.onRequest(() => Promise.reject(
        new Error('subagent-codex: unsupported stateful app-server request'),
      ))
      client.onNotification(processNotification)
      const onInputEnd = (): void => { fail(statefulFailure('protocol')) }
      const onInputError = (error: Error): void => { fail(statefulFailure('protocol', error)) }
      const onOutputError = (error: Error): void => { fail(statefulFailure('protocol', error)) }
      const onChildDone = (): void => { fail(statefulFailure('process')) }
      const childDone = child.done.then(onChildDone, (error) => { fail(statefulFailure('process', error)) })
      void childDone.catch(() => {})
      inputStream.on('end', onInputEnd)
      inputStream.on('close', onInputEnd)
      inputStream.on('error', onInputError)
      outputStream.on('error', onOutputError)
      removeWireObservers = (): void => {
        inputStream.off('end', onInputEnd)
        inputStream.off('close', onInputEnd)
        inputStream.off('error', onInputError)
        outputStream.off('error', onOutputError)
      }
      const interrupt = (): void => {
        if (terminalSettled) return
        if (threadId !== undefined && turnId !== undefined) {
          const activeClient = client
          if (activeClient === undefined) {
            fail(statefulFailure('interrupt'))
            return
          }
          let pending: Promise<unknown>
          try {
            pending = activeClient.request('turn/interrupt', { threadId, turnId })
          } catch (error: unknown) {
            pending = Promise.reject(error)
          }
          void pending.catch((error: unknown) => {
            if (!terminalSettled) fail(statefulFailure('interrupt', error))
          })
        }
        fail(statefulFailure('aborted'))
      }
      signal?.addEventListener('abort', interrupt, { once: true })
      const removeAbortListener = (): void => { signal?.removeEventListener('abort', interrupt) }
      removeWireObservers = (): void => {
        removeAbortListener()
        inputStream.off('end', onInputEnd)
        inputStream.off('close', onInputEnd)
        inputStream.off('error', onInputError)
        outputStream.off('error', onOutputError)
      }
      if (signal?.aborted) interrupt()

      let stage: StatefulFailureStage = 'initialize'
      try {
        signal?.throwIfAborted()
        client.start()
        await waitFor(client.initialize(
          { name: 'dsh-stateful-codex', title: 'DSH Stateful Codex', version: '1' },
          {},
          signal,
        ))
        stage = 'journal'
        const persistent = new CodexPersistentThreadClient(client)
        const events = await waitFor(this.spec.journal.load(signal))
        let stored: CodexThreadReference | undefined
        try {
          stored = recoverCodexThreadStartWal(events)
        } catch (error: unknown) {
          throw persistedStateFailure(error)
        }
        let reference: CodexThreadReference
        stage = 'thread'
        if (stored !== undefined) {
          if (!events.some(event => event.type === 'codex/thread-reference')) {
            await waitFor(this.spec.journal.appendReference(stored, signal))
          }
          reference = await waitFor(persistent.resume(stored, signal))
        } else {
          reference = await waitFor(startCodexThreadWithWal(
            persistent,
            this.spec.cwd,
            this.spec.journal,
            this.spec.threadOptions,
            signal,
          ))
        }
        stage = 'turn-start'
        const response = object(await waitFor(client.request('turn/start', {
          threadId: reference.threadId,
          input: inputBlocks,
        }, signal)), 'stateful turn/start response')
        const nextTurnId = requiredId(object(response.turn, 'stateful turn/start turn').id, 'stateful turn/start turn id')
        threadId = reference.threadId
        turnId = nextTurnId
        for (const notification of earlyNotifications.splice(0)) {
          processNotification(notification.method, notification.params)
        }
        stage = 'turn'
        await Promise.race([terminalCompletion.promise, terminalFailure.promise])
        if (finalAnswer === undefined || finalAnswer.trim().length === 0) {
          throw statefulFailure('turn')
        }
        result = { reference, text: finalAnswer }
      } catch (error: unknown) {
        throw normalizeStatefulFailure(error, stage, signal)
      }
    } catch (error: unknown) {
      executionFailed = true
      executionFailure = normalizeStatefulFailure(error, 'initialize', signal)
    } finally {
      try {
        client?.close()
      } catch (error: unknown) {
        cleanupFailure ??= error
      }
      if (child !== undefined) {
        try {
          await disposeCodexAppServerChild(child)
        } catch (error: unknown) {
          cleanupFailure ??= error
        }
      }
      try {
        removeWireObservers()
      } catch (error: unknown) {
        cleanupFailure ??= error
      }
    }

    if (executionFailed) throw executionFailure
    if (cleanupFailure !== undefined) throw statefulFailure('teardown', cleanupFailure)
    return result as CodexStatefulTurn
  }
}
