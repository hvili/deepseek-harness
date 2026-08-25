/** Durable Codex-thread reference and fresh-process resume evidence. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CodexAppServerClient } from '@deepseek-ai/dsh-codex-app-server'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  CODEX_THREAD_REFERENCE_VERSION,
  CodexPersistentThreadClient,
  createCodexThreadReference,
  foldCodexThreadReference,
  recoverCodexThreadStartWal,
  seedCodexThreadReference,
  startCodexThreadWithWal,
} from '../src/thread-state.ts'

type Frame = Record<string, unknown>

class ProtocolPeer {
  private buffer = ''
  private readonly frames: Frame[] = []
  private readonly waiters = new Set<() => void>()

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as Frame)
      }
      for (const wake of this.waiters) wake()
      this.waiters.clear()
    })
  }

  async request(method: string): Promise<Frame> {
    for (;;) {
      const index = this.frames.findIndex(frame => frame.method === method)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>(resolve => this.waiters.add(resolve))
    }
  }

  respond(request: Frame, result: unknown): void {
    this.output.write(`${JSON.stringify({ id: request.id, result })}\n`)
  }
}

async function initializedClient(): Promise<{
  readonly client: CodexAppServerClient
  readonly peer: ProtocolPeer
}> {
  const fromServer = new PassThrough()
  const toServer = new PassThrough()
  const peer = new ProtocolPeer(toServer, fromServer)
  const client = new CodexAppServerClient(fromServer, toServer)
  client.start()
  const pending = client.initialize({ name: 'test', title: 'Test', version: '1' }, {})
  const request = await peer.request('initialize')
  peer.respond(request, {})
  await pending
  return { client, peer }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mountPersistence(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

describe('Codex persistent thread state', () => {
  it('starts a non-ephemeral thread and accepts only its persistent identity', async () => {
    const { client, peer } = await initializedClient()
    const threads = new CodexPersistentThreadClient(client)
    const started = threads.start('D:/workspace', { approvalPolicy: 'never' })
    const request = await peer.request('thread/start')
    expect(request.params).toEqual({ cwd: 'D:/workspace', ephemeral: false, approvalPolicy: 'never' })
    peer.respond(request, { thread: { id: 'codex-thread-1', ephemeral: false } })
    await expect(started).resolves.toEqual({
      version: CODEX_THREAD_REFERENCE_VERSION,
      threadId: 'codex-thread-1',
    })
    client.close()
  })

  it('rejects an ephemeral or mismatched thread instead of persisting a misleading reference', async () => {
    const first = await initializedClient()
    const started = new CodexPersistentThreadClient(first.client).start('D:/workspace')
    const startRequest = await first.peer.request('thread/start')
    first.peer.respond(startRequest, { thread: { id: 'temporary', ephemeral: true } })
    await expect(started).rejects.toThrow('did not return a persistent thread')
    first.client.close()

    const second = await initializedClient()
    const resumed = new CodexPersistentThreadClient(second.client).resume(createCodexThreadReference('stored'))
    const resumeRequest = await second.peer.request('thread/resume')
    expect(resumeRequest.params).toEqual({ threadId: 'stored' })
    second.peer.respond(resumeRequest, { thread: { id: 'other', ephemeral: false } })
    await expect(resumed).rejects.toThrow('returned another thread')
    second.client.close()
  })

  it('restores the DSH-owned reference after a fresh persistence mount and resumes that exact thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-thread-restart-'))
    roots.push(root)
    const sessionId = SessionId('codex-thread-restart')
    const first = await mountPersistence(root)
    const session = first.sessions.create(sessionId, { meta: { cwd: 'D:/workspace' } })
    session.append('codex/thread-reference', createCodexThreadReference('codex-thread-restart'))
    await expect(first.sessions.flush(session)).resolves.toBe(true)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const restarted = await mountPersistence(root)
    const stored = await restarted.sessionPersistence.inspect(sessionId)
    const reference = foldCodexThreadReference(stored.events)
    expect(reference).toEqual({ version: CODEX_THREAD_REFERENCE_VERSION, threadId: 'codex-thread-restart' })

    const { client, peer } = await initializedClient()
    const resumed = new CodexPersistentThreadClient(client).resume(reference!)
    const resumeRequest = await peer.request('thread/resume')
    expect(resumeRequest.params).toEqual({ threadId: 'codex-thread-restart' })
    peer.respond(resumeRequest, { thread: { id: 'codex-thread-restart', ephemeral: false } })
    await expect(resumed).resolves.toEqual(reference)
    client.close()
  })

  it('rejects duplicate, malformed, and unsupported durable reference records', () => {
    const reference = createCodexThreadReference('codex-thread-1')
    const seed = seedCodexThreadReference(SessionId('thread-state'), undefined, reference)
    expect(foldCodexThreadReference(seed)).toEqual(reference)
    expect(() => seedCodexThreadReference(SessionId('thread-state'), seed, reference))
      .toThrow('already has a Codex thread reference')

    const malformed = [{ type: 'codex/thread-reference', seq: 0, time: 0, data: { version: 1, threadId: '' } }]
    expect(() => foldCodexThreadReference(malformed as never)).toThrow('invalid persisted Codex thread reference thread id')
    const future = [{ type: 'codex/thread-reference', seq: 0, time: 0, data: { version: 2, threadId: 'future' } }]
    expect(() => foldCodexThreadReference(future as never)).toThrow('version is unsupported')
  })

  it('fails closed for malformed public resume values and non-absolute app-server cwd values', async () => {
    const { client } = await initializedClient()
    const threads = new CodexPersistentThreadClient(client)
    await expect(threads.start('relative-workspace')).rejects.toThrow('must be an absolute path')
    await expect(threads.resume({ version: 1, threadId: 'id', extra: true } as never))
      .rejects.toThrow('unknown field')
    await expect(threads.resume({ version: 2, threadId: 'id' } as never))
      .rejects.toThrow('version is unsupported')
    client.close()
  })

  it('recovers an observed accepted id but fails closed for an unobserved start WAL', () => {
    const accepted = [{
      type: 'codex/thread-start-wal', seq: 0, time: 0,
      data: { version: 1, operationId: 'op-1', state: 'accepted', threadId: 'codex-thread-accepted' },
    }]
    expect(recoverCodexThreadStartWal(accepted as never)).toEqual({
      version: CODEX_THREAD_REFERENCE_VERSION,
      threadId: 'codex-thread-accepted',
    })
    const unresolved = [{
      type: 'codex/thread-start-wal', seq: 0, time: 0,
      data: { version: 1, operationId: 'op-2', state: 'prepared' },
    }]
    expect(() => recoverCodexThreadStartWal(unresolved as never))
      .toThrow('requires reconciliation')
  })

  it('does not publish a reference when fault injection rejects the accepted WAL write', async () => {
    const { client, peer } = await initializedClient()
    const threads = new CodexPersistentThreadClient(client)
    const entries: unknown[] = []
    const references: unknown[] = []
    const started = startCodexThreadWithWal(threads, 'D:/workspace', {
      appendWal: async (entry) => {
        entries.push(entry)
        if (entry.state === 'accepted') throw new Error('injected accepted WAL durability failure')
      },
      appendReference: async (reference) => { references.push(reference) },
    })
    const request = await peer.request('thread/start')
    peer.respond(request, { thread: { id: 'accepted-but-not-logged', ephemeral: false } })
    await expect(started).rejects.toThrow('injected accepted WAL durability failure')
    expect(entries).toMatchObject([{ state: 'prepared' }, {
      state: 'accepted', threadId: 'accepted-but-not-logged',
    }])
    expect(references).toEqual([])
    client.close()
  })
})
