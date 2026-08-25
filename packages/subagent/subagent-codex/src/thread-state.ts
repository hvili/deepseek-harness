/**
 * Durable Codex thread-reference vocabulary and the narrow stable app-server
 * operations required to create or reopen that external execution identity.
 * The reference lives in a DSH Session event; it never imports or mirrors the
 * Codex project database.
 *
 * @module @deepseek-ai/dsh-subagent-codex/thread-state
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { CodexAppServerClient } from '@deepseek-ai/dsh-codex-app-server'
import { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { isAbsolute } from 'node:path'

/** Opaque external identity assigned by Codex to one persistent thread. */
export type CodexThreadId = Branded<'CodexThreadId'>

/** Current wire-compatible persistent-reference payload version. */
export const CODEX_THREAD_REFERENCE_VERSION = 1

/** Current write-ahead record version for persistent Codex thread creation. */
export const CODEX_THREAD_START_WAL_VERSION = 1

/** The DSH-owned durable pointer to a Codex persistent thread. */
export interface CodexThreadReference {
  /** Payload version ({@link CODEX_THREAD_REFERENCE_VERSION}). */
  readonly version: typeof CODEX_THREAD_REFERENCE_VERSION
  /** Opaque Codex thread id; it is not a DSH Session id. */
  readonly threadId: CodexThreadId
}

/**
 * A durably recorded thread-start attempt. `prepared` deliberately blocks
 * recovery because Codex does not accept a caller-supplied idempotency key.
 */
export interface CodexThreadStartWal {
  /** WAL record version. */
  readonly version: typeof CODEX_THREAD_START_WAL_VERSION
  /** DSH-generated operation identity used only for audit and recovery. */
  readonly operationId: string
  /** Whether the external identity has reached durable DSH storage. */
  readonly state: 'prepared' | 'accepted'
  /** Observed external id, present only after it reaches the WAL. */
  readonly threadId?: CodexThreadId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The one external Codex execution identity attached to this DSH Session.
     * It is log-only and required: a runtime that cannot interpret this record
     * must not pretend it can safely resume the linked Codex conversation.
     */
    'codex/thread-reference': CodexThreadReference
    /**
     * Durable write-ahead evidence for a persistent Codex `thread/start`.
     * A remaining `prepared` record is an unresolved external side effect and
     * makes automatic continuation unavailable until reconciliation.
     */
    'codex/thread-start-wal': CodexThreadStartWal
  }
}

/** Persistent-thread fields selected by a later product policy adapter. */
export interface CodexPersistentThreadOptions {
  /** Stable Codex approval policy for the new thread. */
  readonly approvalPolicy?: 'never' | 'on-request'
  /** Optional native automatic reviewer. */
  readonly approvalsReviewer?: 'auto_review'
  /** Optional native sandbox setting. */
  readonly sandbox?: 'workspace-write' | 'danger-full-access'
}

/** Durable callbacks for the three ordered records of a persistent start. */
export interface CodexThreadStartJournal {
  /** Record an intent before requesting any upstream side effect. */
  readonly appendWal: (entry: CodexThreadStartWal, signal?: AbortSignal) => Promise<void>
  /** Commit the durable DSH-owned external reference. */
  readonly appendReference: (reference: CodexThreadReference, signal?: AbortSignal) => Promise<void>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`subagent-codex: invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function parseThreadId(value: unknown, label: string): CodexThreadId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`subagent-codex: invalid ${label}`)
  }
  return value as CodexThreadId
}

function parseReference(value: unknown, label: string): CodexThreadReference | undefined {
  const source = record(value, label)
  const keys = Object.keys(source)
  if (keys.some(key => key !== 'version' && key !== 'threadId')) {
    throw new Error(`subagent-codex: ${label} has an unknown field`)
  }
  if (typeof source.version !== 'number') {
    throw new Error(`subagent-codex: invalid ${label} version`)
  }
  if (source.version !== CODEX_THREAD_REFERENCE_VERSION) return undefined
  return {
    version: CODEX_THREAD_REFERENCE_VERSION,
    threadId: parseThreadId(source.threadId, `${label} thread id`),
  }
}

function parseWal(value: unknown, label: string): CodexThreadStartWal {
  const source = record(value, label)
  const keys = Object.keys(source)
  if (keys.some(key => key !== 'version' && key !== 'operationId' && key !== 'state' && key !== 'threadId')) {
    throw new Error(`subagent-codex: ${label} has an unknown field`)
  }
  if (source.version !== CODEX_THREAD_START_WAL_VERSION) {
    throw new Error(`subagent-codex: ${label} version is unsupported`)
  }
  if (typeof source.operationId !== 'string' || source.operationId.length === 0) {
    throw new Error(`subagent-codex: invalid ${label} operation id`)
  }
  if (source.state === 'prepared') {
    if (source.threadId !== undefined) throw new Error(`subagent-codex: invalid ${label} prepared thread id`)
    return { version: CODEX_THREAD_START_WAL_VERSION, operationId: source.operationId, state: 'prepared' }
  }
  if (source.state !== 'accepted') throw new Error(`subagent-codex: invalid ${label} state`)
  return {
    version: CODEX_THREAD_START_WAL_VERSION,
    operationId: source.operationId,
    state: 'accepted',
    threadId: parseThreadId(source.threadId, `${label} thread id`),
  }
}

function responseReference(
  response: unknown,
  operation: 'thread/start' | 'thread/resume',
  expectedThreadId?: CodexThreadId,
): CodexThreadReference {
  const thread = record(record(response, `${operation} response`).thread, `${operation} thread`)
  if (thread.ephemeral !== false) {
    throw new Error(`subagent-codex: ${operation} did not return a persistent thread`)
  }
  const reference = createCodexThreadReference(parseThreadId(thread.id, `${operation} thread id`))
  if (expectedThreadId !== undefined && reference.threadId !== expectedThreadId) {
    throw new Error(`subagent-codex: ${operation} returned another thread`)
  }
  return reference
}

/**
 * Validate a newly observed external thread id before it reaches the DSH log.
 * @param threadId - opaque id from Codex's `thread/start` response.
 * @returns the current durable reference payload.
 */
export function createCodexThreadReference(threadId: string): CodexThreadReference {
  return {
    version: CODEX_THREAD_REFERENCE_VERSION,
    threadId: parseThreadId(threadId, 'Codex thread id'),
  }
}

/**
 * Fold the one required persistent Codex reference from a DSH Session log.
 * @param events - complete event sequence loaded from the DSH persistence backend.
 * @returns the supported reference, or `undefined` when the Session has none.
 * @throws when the log has duplicate, malformed, or unsupported references.
 */
export function foldCodexThreadReference(events: readonly SessionEvent[]): CodexThreadReference | undefined {
  let reference: CodexThreadReference | undefined
  for (const event of events) {
    if (event.type !== 'codex/thread-reference') continue
    if (reference !== undefined) {
      throw new Error('subagent-codex: a Session may contain only one Codex thread reference')
    }
    const parsed = parseReference(event.data, 'persisted Codex thread reference')
    if (parsed === undefined) {
      throw new Error('subagent-codex: persisted Codex thread reference version is unsupported')
    }
    reference = parsed
  }
  return reference
}

/**
 * Recover a reference from the durable create journal without guessing after
 * a response-loss crash. Callers must append the returned reference before
 * submitting another turn.
 * @param events - complete Session log loaded from DSH persistence.
 * @returns existing reference or an accepted id ready to commit.
 * @throws when creation remains unobserved, records conflict, or data is malformed.
 */
export function recoverCodexThreadStartWal(events: readonly SessionEvent[]): CodexThreadReference | undefined {
  const reference = foldCodexThreadReference(events)
  let wal: CodexThreadStartWal | undefined
  for (const event of events) {
    if (event.type !== 'codex/thread-start-wal') continue
    const next = parseWal(event.data, 'persisted Codex thread start WAL')
    if (wal === undefined) {
      wal = next
      continue
    }
    if (wal.state !== 'prepared' || next.state !== 'accepted' || wal.operationId !== next.operationId) {
      throw new Error('subagent-codex: invalid Codex thread start WAL transition')
    }
    wal = next
  }
  if (reference !== undefined) {
    if (wal?.state === 'accepted' && wal.threadId !== reference.threadId) {
      throw new Error('subagent-codex: Codex thread WAL conflicts with the persisted reference')
    }
    return reference
  }
  if (wal === undefined) return undefined
  if (wal.state === 'prepared') {
    throw new Error('subagent-codex: unresolved Codex thread start WAL requires reconciliation')
  }
  return createCodexThreadReference(wal.threadId as string)
}

/**
 * Stage a durable thread reference before a Session is published.
 * @param sessionId - DSH Session that will own the external reference.
 * @param seed - optional existing complete event prefix.
 * @param reference - already-validated external identity.
 * @returns contiguous seed events with exactly one reference record.
 */
export function seedCodexThreadReference(
  sessionId: SessionId,
  seed: readonly SessionEvent[] | undefined,
  reference: CodexThreadReference,
): SessionEvent[] {
  if (foldCodexThreadReference(seed ?? []) !== undefined) {
    throw new Error('subagent-codex: a Session already has a Codex thread reference')
  }
  const staged = Session.create(sessionId, seed)
  staged.append('codex/thread-reference', reference)
  return [...staged.events]
}

/**
 * Create or reopen a persistent Codex thread through an initialized app-server.
 * This class owns neither subprocess lifecycle nor DSH Session persistence.
 */
export class CodexPersistentThreadClient {
  constructor(private readonly appServer: CodexAppServerClient) {}

  /**
   * Start one non-ephemeral Codex thread.
   * @param cwd - absolute workspace passed to Codex.
   * @param options - policy fields selected by the owning product adapter.
   * @param signal - optional request cancellation.
   * @returns the durable external reference to persist in the DSH Session.
   */
  async start(
    cwd: string,
    options: CodexPersistentThreadOptions = {},
    signal?: AbortSignal,
  ): Promise<CodexThreadReference> {
    if (!isAbsolute(cwd)) throw new Error('subagent-codex: persistent Codex thread cwd must be an absolute path')
    return responseReference(await this.appServer.request('thread/start', {
      cwd,
      ephemeral: false,
      ...options,
    }, signal), 'thread/start')
  }

  /**
   * Reopen exactly the Codex thread identified by an already persisted reference.
   * @param reference - durable DSH-owned external reference.
   * @param signal - optional request cancellation.
   * @returns the verified unchanged reference.
   */
  async resume(reference: CodexThreadReference, signal?: AbortSignal): Promise<CodexThreadReference> {
    const validated = parseReference(reference, 'Codex thread reference')
    if (validated === undefined) throw new Error('subagent-codex: Codex thread reference version is unsupported')
    return responseReference(await this.appServer.request('thread/resume', {
      threadId: validated.threadId,
    }, signal), 'thread/resume', validated.threadId)
  }
}

/**
 * Create a persistent thread with durable write-ahead evidence. The callback
 * order is an at-least-once protocol: an observed id is never used for a turn
 * until its accepted WAL and final reference both resolve. A process crash
 * before Codex returns an id remains an intentionally fail-closed `prepared`
 * record because the upstream method has no idempotency key or lookup token.
 * @param threads - initialized persistent-thread app-server client.
 * @param cwd - absolute app-server workspace.
 * @param journal - durable DSH Session journal operations.
 * @param options - selected native persistent-thread policy.
 * @param signal - optional cancellation for all records and request.
 * @returns the reference committed by the journal.
 */
export async function startCodexThreadWithWal(
  threads: CodexPersistentThreadClient,
  cwd: string,
  journal: CodexThreadStartJournal,
  options: CodexPersistentThreadOptions = {},
  signal?: AbortSignal,
): Promise<CodexThreadReference> {
  const operationId = crypto.randomUUID()
  const base: Pick<CodexThreadStartWal, 'version' | 'operationId'> = {
    version: CODEX_THREAD_START_WAL_VERSION,
    operationId,
  }
  await journal.appendWal({ ...base, state: 'prepared' }, signal)
  const reference = await threads.start(cwd, options, signal)
  await journal.appendWal({ ...base, state: 'accepted', threadId: reference.threadId }, signal)
  await journal.appendReference(reference, signal)
  return reference
}
