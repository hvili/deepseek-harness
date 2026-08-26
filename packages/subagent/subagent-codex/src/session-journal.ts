/** DSH Session-backed durable journal for Codex thread identity records. */

import type { Session, SessionEvent, SessionStore } from '@deepseek-ai/dsh-session'
import {
  foldCodexThreadReference,
  validateCodexThreadReference,
  type CodexThreadReference,
  type CodexThreadStartWal,
} from './thread-state.ts'
import type { CodexThreadJournal } from './stateful-execution.ts'

/**
 * Production DSH Session seam for the stateful Codex adapter.
 *
 * The owning product mounts/restores the Session through its selected
 * SessionPersistence backend first. This adapter reads that complete validated
 * event log, appends only DSH events, and resolves each write only after the
 * SessionStore's awaited `session/flush` barrier succeeds.
 */
export class DshSessionCodexThreadJournal implements CodexThreadJournal {
  constructor(
    private readonly session: Session,
    private readonly sessions: Pick<SessionStore, 'flush'>,
  ) {}

  /** Return the complete validated event snapshot owned by the DSH Session. */
  load(signal?: AbortSignal): Promise<readonly SessionEvent[]> {
    signal?.throwIfAborted()
    return Promise.resolve(this.session.events)
  }

  /** Append WAL evidence and wait for the DSH Session flush barrier. */
  async appendWal(entry: CodexThreadStartWal, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.session.append('codex/thread-start-wal', entry)
    await this.flush()
  }

  /**
   * Append one reference, or treat the same existing id as an idempotent retry.
   * A different existing id is a hard conflict; no header metadata is touched.
   */
  async appendReference(reference: CodexThreadReference, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const validated = validateCodexThreadReference(reference)
    const existing = foldCodexThreadReference(this.session.events)
    if (existing !== undefined) {
      if (existing.threadId !== validated.threadId) {
        throw new Error('subagent-codex: Codex thread reference conflicts with the Session')
      }
    } else {
      this.session.append('codex/thread-reference', validated)
    }
    await this.flush()
  }

  private async flush(): Promise<void> {
    const durable = await this.sessions.flush(this.session)
    if (!durable) {
      throw new Error('subagent-codex: DSH Session journal has no persistence flush listener')
    }
  }
}
