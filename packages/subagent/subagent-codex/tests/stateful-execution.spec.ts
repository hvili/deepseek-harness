/** Stateful execution notification ordering at the package-local client edge. */

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { CodexStatefulExecution, type CodexThreadJournal } from '../src/stateful-execution.ts'

interface Frame {
  readonly id?: string
  readonly method?: string
  readonly params?: Record<string, unknown>
}

class AppServerPeer {
  private buffer = ''
  private readonly frames: Frame[] = []
  private readonly waiters = new Set<() => void>()

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += String(chunk)
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

  send(frames: readonly Record<string, unknown>[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }
}

function child(stdout: PassThrough, stdin: PassThrough): SubprocessHandle {
  return {
    pid: 0,
    stdin,
    stdout,
    done: Promise.resolve({ exitCode: 0, signal: null }),
  } as unknown as SubprocessHandle
}

describe('CodexStatefulExecution', () => {
  it('replays terminal notifications that arrive in the same batch as turn/start response', async () => {
    const fromServer = new PassThrough()
    const toServer = new PassThrough()
    const peer = new AppServerPeer(toServer, fromServer)
    const events: SessionEvent[] = []
    const journal: CodexThreadJournal = {
      load: async () => events,
      appendWal: async (data) => {
        events.push({ type: 'codex/thread-start-wal', seq: events.length, time: 0, data })
      },
      appendReference: async (data) => {
        events.push({ type: 'codex/thread-reference', seq: events.length, time: 0, data })
      },
    }
    const execution = new CodexStatefulExecution({
      cwd: 'D:/workspace',
      env: {},
      disposeGraceMs: 1,
      spawn: () => child(fromServer, toServer),
      journal,
    })
    const running = execution.execute(['Return the batched final answer.'])

    const initialize = await peer.request('initialize')
    peer.send([{ id: initialize.id, result: {} }])
    const startThread = await peer.request('thread/start')
    peer.send([{ id: startThread.id, result: { thread: { id: 'thread-1', ephemeral: false } } }])
    const startTurn = await peer.request('turn/start')
    peer.send([
      { id: startTurn.id, result: { turn: { id: 'turn-1' } } },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { type: 'agentMessage', phase: 'final_answer', text: 'BATCHED_FINAL' },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
      },
    ])

    await expect(running).resolves.toEqual({
      reference: { version: 1, threadId: 'thread-1' },
      text: 'BATCHED_FINAL',
    })
  })
})
