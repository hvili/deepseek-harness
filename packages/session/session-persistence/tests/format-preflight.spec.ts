/**
 * Reject continued boot when persisted session data was written by a harness
 * NEWER than the running build, while tolerating older-format logs (the
 * coordinator refuses those individually on open).
 * @module @deepseek-ai/dsh-session-persistence/tests/format-preflight
 */

import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision, type SessionPersistenceSnapshot } from '../src/index.ts'
import { assertStoredFormatNotNewer } from '../src/index.ts'

function source(versions: number[]): { listSnapshots(): Promise<SessionPersistenceSnapshot[]> } {
  return {
    listSnapshots: async () => versions.map((version, i) => ({
      header: { version, id: SessionId(`s${i}`), createdAt: 1000 + i },
      revision: SessionPersistenceRevision(`s${i}`),
    }) satisfies SessionPersistenceSnapshot),
  }
}

describe('assertStoredFormatNotNewer', () => {
  it('resolves when no persisted session is newer than the supported format', async () => {
    const src = source([SESSION_FORMAT_VERSION, SESSION_FORMAT_VERSION])
    await expect(assertStoredFormatNotNewer(src)).resolves.toBeUndefined()
  })

  it('resolves when the only out-of-date logs are older (per-session refusal on open)', async () => {
    const src = source([SESSION_FORMAT_VERSION - 1])
    await expect(assertStoredFormatNotNewer(src)).resolves.toBeUndefined()
  })

  it('rejects loudly when a persisted session requires a newer format', async () => {
    const src = source([SESSION_FORMAT_VERSION, SESSION_FORMAT_VERSION + 5])
    await expect(assertStoredFormatNotNewer(src)).rejects.toThrow(/newer harness/)
  })

  it('rejects with a reader label and single-session wording', async () => {
    const src = source([SESSION_FORMAT_VERSION + 99])
    await expect(assertStoredFormatNotNewer(src, 'dsh v0.1')).rejects.toThrow(/dsh v0\.1/)
  })

  it('rejects with plural wording for multiple newer sessions', async () => {
    const src = source([SESSION_FORMAT_VERSION + 1, SESSION_FORMAT_VERSION + 2])
    await expect(assertStoredFormatNotNewer(src)).rejects.toThrow(/2 persisted sessions require/)
  })
})
