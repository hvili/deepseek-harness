/** Stateful execution terminal coordination at the package-local client edge. */

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
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
  readonly methods: string[] = []

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += String(chunk)
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) {
          const frame = JSON.parse(line) as Frame
          if (frame.method !== undefined) this.methods.push(frame.method)
          this.frames.push(frame)
        }
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

class TestChild {
  readonly pid = 1
  readonly stderr = undefined
  readonly collected = {}
  readonly done: Promise<SubprocessOutcome>
  private readonly doneState = Promise.withResolvers<SubprocessOutcome>()
  private readonly treeState = Promise.withResolvers<undefined>()
  private doneSettled = false
  private treeSettled = false
  terminated = false

  constructor(
    readonly stdout: PassThrough,
    readonly stdin: PassThrough,
  ) {
    this.done = this.doneState.promise
  }

  terminate(): void {
    this.terminated = true
    this.stopTree()
    this.resolveDone({ exitCode: 0, signal: null })
  }

  async waitForExit(): Promise<boolean> {
    await this.treeState.promise
    return true
  }

  exit(outcome: SubprocessOutcome): void {
    this.stopTree()
    this.resolveDone(outcome)
  }

  fail(error: Error): void {
    this.stopTree()
    if (this.doneSettled) return
    this.doneSettled = true
    this.doneState.reject(error)
  }

  private stopTree(): void {
    if (this.treeSettled) return
    this.treeSettled = true
    this.treeState.resolve(undefined)
  }

  private resolveDone(outcome: SubprocessOutcome): void {
    if (this.doneSettled) return
    this.doneSettled = true
    this.doneState.resolve(outcome)
  }
}

function memoryJournal(seed: readonly SessionEvent[] = []): CodexThreadJournal {
  const events: SessionEvent[] = [...seed]
  return {
    load: async () => events,
    appendWal: async (data) => {
      events.push({ type: 'codex/thread-start-wal', seq: events.length, time: 0, data })
    },
    appendReference: async (data) => {
      events.push({ type: 'codex/thread-reference', seq: events.length, time: 0, data })
    },
  }
}

function executionFixture(seed?: readonly SessionEvent[]): {
  readonly execution: CodexStatefulExecution
  readonly peer: AppServerPeer
  readonly child: TestChild
} {
  const fromServer = new PassThrough()
  const toServer = new PassThrough()
  const peer = new AppServerPeer(toServer, fromServer)
  const child = new TestChild(fromServer, toServer)
  const execution = new CodexStatefulExecution({
    cwd: 'D:/workspace',
    env: {},
    disposeGraceMs: 1,
    spawn: () => child,
    journal: memoryJournal(seed),
  })
  return { execution, peer, child }
}

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('stateful execute did not settle')) }, 500)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function prepareTurn(
  execution: CodexStatefulExecution,
  peer: AppServerPeer,
  signal?: AbortSignal,
): Promise<{ readonly running: Promise<unknown> }> {
  const running = execution.execute(['Return the final answer.'], signal)
  const initialize = await peer.request('initialize')
  peer.send([{ id: initialize.id, result: {} }])
  const startThread = await peer.request('thread/start')
  peer.send([{ id: startThread.id, result: { thread: { id: 'thread-1', ephemeral: false } } }])
  const startTurn = await peer.request('turn/start')
  peer.send([{ id: startTurn.id, result: { turn: { id: 'turn-1' } } }])
  return { running }
}

async function expectTreeStopped(child: TestChild): Promise<void> {
  await expect(child.waitForExit()).resolves.toBe(true)
  expect(child.terminated).toBe(true)
}

describe('CodexStatefulExecution', () => {
  it('replays terminal notifications that arrive in the same batch as turn/start response', async () => {
    const { execution, peer, child } = executionFixture()
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

    await expect(settleWithin(running)).resolves.toEqual({
      reference: { version: 1, threadId: 'thread-1' },
      text: 'BATCHED_FINAL',
    })
    await expectTreeStopped(child)
  })

  it('rejects when the app-server exits after turn/start without turn/completed', async () => {
    const { execution, peer, child } = executionFixture()
    const { running } = await prepareTurn(execution, peer)
    child.exit({ exitCode: 17, signal: null })

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: stateful Codex app-server exited before turn completion',
    )
    await expectTreeStopped(child)
  })

  it('fails closed on durable prepared-only recovery without starting another thread', async () => {
    const { execution, peer, child } = executionFixture([{
      type: 'codex/thread-start-wal',
      seq: 0,
      time: 0,
      data: { version: 1, operationId: 'unresolved-start', state: 'prepared' },
    }])
    const running = execution.execute(['This turn must not start a second thread.'])
    const initialize = await peer.request('initialize')
    peer.send([{ id: initialize.id, result: {} }])

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: persisted Codex thread start requires reconciliation',
    )
    expect(peer.methods).not.toContain('thread/start')
    await expectTreeStopped(child)
  })

  it('rejects safely when the child completion promise fails', async () => {
    const { execution, peer, child } = executionFixture()
    const { running } = await prepareTurn(execution, peer)
    child.fail(new Error('SECRET stderr path D:/private/token'))

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: stateful Codex app-server exited before turn completion',
    )
    await expectTreeStopped(child)
  })

  it('settles promptly on abort even when the interrupt request fails', async () => {
    const controller = new AbortController()
    const { execution, peer, child } = executionFixture()
    const running = execution.execute(['Return the final answer.'], controller.signal)
    const initialize = await peer.request('initialize')
    peer.send([{ id: initialize.id, result: {} }])
    const startThread = await peer.request('thread/start')
    peer.send([{ id: startThread.id, result: { thread: { id: 'thread-1', ephemeral: false } } }])
    const startTurn = await peer.request('turn/start')
    peer.send([{ id: startTurn.id, result: { turn: { id: 'turn-1' } } }])

    await new Promise<void>(resolve => setImmediate(resolve))
    const settled = settleWithin(running)
    controller.abort()
    const interrupt = await peer.request('turn/interrupt')
    peer.send([{ id: interrupt.id, error: { code: -32000, message: 'SECRET interrupt failure' } }])
    await expect(settled).rejects.toThrow(
      'subagent-codex: stateful Codex execution was aborted',
    )
    await expectTreeStopped(child)
  })

  it('rejects when the JSON-RPC input stream ends before a terminal notification', async () => {
    const { execution, peer, child } = executionFixture()
    const { running } = await prepareTurn(execution, peer)
    child.stdout.end()

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: stateful Codex protocol failed',
    )
    await expectTreeStopped(child)
  })

  it('rejects when the JSON-RPC output transport fails', async () => {
    const { execution, peer, child } = executionFixture()
    const { running } = await prepareTurn(execution, peer)
    child.stdin.destroy(new Error('SECRET transport failure'))

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: stateful Codex protocol failed',
    )
    await expectTreeStopped(child)
  })

  it('rejects malformed turn/completed notifications and stops the process tree', async () => {
    const { execution, peer, child } = executionFixture()
    const { running } = await prepareTurn(execution, peer)
    peer.send([{
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
    }])

    await expect(settleWithin(running)).rejects.toThrow(
      'subagent-codex: stateful Codex turn failed',
    )
    await expectTreeStopped(child)
  })
})
