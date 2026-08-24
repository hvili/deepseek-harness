import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, DEFAULT_VISION_MODEL, DEFAULT_VISION_PROVIDER, type Config } from '../src/index.ts'

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class FixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: provider === DEFAULT_VISION_PROVIDER ? ['text', 'image'] : ['text'],
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.provider === DEFAULT_VISION_PROVIDER) {
      yield* textResponse('a screenshot containing a settings dialog')
      return
    }
    if (options.messages.some(message => message.content.some(block => block.type === 'image'))) {
      throw new Error('text route received an image')
    }
    yield* textResponse('main answer')
  }
}

/** Vision route fails, but the main route can accept images (pass-through test). */
class PassThroughMainAdapter extends FixtureAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.provider === DEFAULT_VISION_PROVIDER) {
      throw new Error('vision provider is down')
    }
    yield* textResponse('main answer')
  }
}

class ResponseAdapter extends FixtureAdapter {
  constructor(
    private readonly chunks: readonly StreamChunk[],
    private readonly beforeStream?: (options: GenerateOptions) => void | Promise<void>,
    private readonly modalities: readonly ('text' | 'image')[] = ['text', 'image'],
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: this.modalities })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await this.beforeStream?.(options)
    yield* this.chunks
  }
}

async function harness(
  adapter: FixtureAdapter,
  overrides: Partial<Config> = {},
  includeEnabled = true,
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter([DEFAULT_VISION_PROVIDER, 'text'], adapter)
  await ctx.plugin({ inject: ['llm'], apply }, {
    ...includeEnabled ? { enabled: true } : {},
    visionProvider: DEFAULT_VISION_PROVIDER,
    visionModel: DEFAULT_VISION_MODEL,
    ...overrides,
  })
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

let directId = 0
async function intercept(
  ctx: Context,
  messages: UserMessage[],
  signal: AbortSignal = new AbortController().signal,
) {
  const agent = ctx.agentLoop.create(SessionId(`vision-proxy-direct-${String(directId += 1)}`), {
    provider: 'text', model: 'text',
  })
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function imageMessage(id: string, content: UserMessage['content'] = []): UserMessage {
  return createUserMessage({
    content: [
      ...content,
      {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(id),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      },
    ],
    source: { kind: 'user' },
  })
}

describe('vision-proxy composition', () => {
  it('converts an image to durable text before a text-only main request', async () => {
    const adapter = new FixtureAdapter()
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('vision-proxy'), { provider: 'text', model: 'text' })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [
        { type: 'text', text: 'What is shown?' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId('fixture-image'),
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    }))
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]?.provider).toBe(DEFAULT_VISION_PROVIDER)
    expect(adapter.requests[0]?.messages[0]?.content.some(block => block.type === 'image')).toBe(true)
    const main = adapter.requests[1]
    expect(main?.provider).toBe('text')
    expect(JSON.stringify(main?.messages)).toContain('a screenshot containing a settings dialog')
    expect(JSON.stringify(main?.messages)).not.toContain('fixture-image')
    const logged = agent.session.events.find(event => event.type === 'user/message')
    expect(logged?.type === 'user/message' && JSON.stringify(logged.data.content)).toContain('a screenshot containing a settings dialog')
    await ctx.root.fiber.dispose()
  })

  it('leaves images untouched when the switch is off', async () => {
    const adapter = new PassThroughMainAdapter()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['text'], adapter)
    await ctx.plugin({ inject: ['llm'], apply }, { enabled: false })
    const agent = ctx.agentLoop.create(SessionId('vision-proxy-off'), { provider: 'text', model: 'text' })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('fixture-image-off'),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    }))
    await idle
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.messages[0]?.content.some(block => block.type === 'image')).toBe(true)
    await ctx.root.fiber.dispose()
  })

  it('passes the original image through when errorMode is pass and the vision call fails', async () => {
    const adapter = new PassThroughMainAdapter()
    const ctx = await harness(adapter, { errorMode: 'pass' })
    const agent = ctx.agentLoop.create(SessionId('vision-proxy-pass'), { provider: 'text', model: 'text' })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('fixture-image-pass'),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    }))
    await idle
    // The vision request failed, but the original image still reaches the main model.
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]?.provider).toBe(DEFAULT_VISION_PROVIDER)
    expect(adapter.requests[1]?.messages[0]?.content.some(block => block.type === 'image')).toBe(true)
    await ctx.root.fiber.dispose()
  })

  it('uses the configured description prefix in the durable replacement', async () => {
    const adapter = new FixtureAdapter()
    const ctx = await harness(adapter, { descriptionPrefix: 'VISION:' })
    const agent = ctx.agentLoop.create(SessionId('vision-proxy-prefix'), { provider: 'text', model: 'text' })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('fixture-image-prefix'),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    }))
    await idle
    const main = adapter.requests[1]
    expect(main?.provider).toBe('text')
    expect(JSON.stringify(main?.messages)).toContain('VISION:a screenshot containing a settings dialog')
    await ctx.root.fiber.dispose()
  })

  it('reuses a cached description for the same image set', async () => {
    const adapter = new FixtureAdapter()
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('vision-proxy-cache'), { provider: 'text', model: 'text' })
    const image = () => createUserMessage({
      content: [
        { type: 'text', text: 'What is shown?' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId('fixture-image-cache'),
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    })
    const firstIdle = waitForIdle(ctx, agent)
    agent.followup(image())
    await firstIdle
    expect(adapter.requests).toHaveLength(2)
    const secondIdle = waitForIdle(ctx, agent)
    agent.followup(image())
    await secondIdle
    // The first request was the vision description, the second is the main
    // answer; a third request would mean the vision model was called again.
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests[0]?.provider).toBe(DEFAULT_VISION_PROVIDER)
    expect(adapter.requests[1]?.provider).toBe('text')
    expect(adapter.requests[2]?.provider).toBe('text')
    await ctx.root.fiber.dispose()
  })

  it('recurses through tool results, preserves text-only messages, and inserts one description', async () => {
    const adapter = new FixtureAdapter()
    const ctx = await harness(adapter)
    const nested = createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: CallId('vision-nested'),
        content: [
          { type: 'text', text: 'nested context' },
          ...imageMessage('nested-image').content,
          ...imageMessage('second-image').content,
        ],
      }],
      source: { kind: 'user' },
    })
    const textOnly = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source: { kind: 'user' } })

    const decision = await intercept(ctx, [textOnly, nested])
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      expect(decision.messages[0]).toBe(textOnly)
      const rendered = JSON.stringify(decision.messages[1])
      expect(rendered.match(/a screenshot containing a settings dialog/g)).toHaveLength(1)
      expect(rendered).not.toContain('nested-image')
    }
    expect(JSON.stringify(adapter.requests[0])).toContain('nested context')
    await ctx.root.fiber.dispose()
  })

  it('rejects invalid programmatic config and an explicitly text-only vision route', async () => {
    const invalid: Partial<Config>[] = [
      { maxTokens: 0 },
      { timeoutMs: 999 },
      { visionProvider: ' ' },
    ]
    for (const overrides of invalid) {
      const ctx = await harness(new FixtureAdapter(), overrides)
      await expect(intercept(ctx, [imageMessage(`invalid-${JSON.stringify(overrides)}`)]))
        .rejects.toThrow('vision-proxy:')
      await ctx.root.fiber.dispose()
    }

    const ctx = await harness(new FixtureAdapter(), {
      visionProvider: 'text', visionModel: 'text', errorMode: 'pass',
    })
    await expect(intercept(ctx, [imageMessage('text-only-route')]))
      .rejects.toThrow('does not accept images')
    await ctx.root.fiber.dispose()
  })

  it('uses the disabled default and propagates failures in fail mode', async () => {
    const disabled = await harness(new FixtureAdapter(), {}, false)
    const original = imageMessage('disabled-default')
    await expect(intercept(disabled, [original]))
      .resolves.toMatchObject({ kind: 'enter', messages: [original] })
    await disabled.root.fiber.dispose()

    const failing = await harness(new ResponseAdapter([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'hard failure', code: 'UNKNOWN' } } },
    ]))
    await expect(intercept(failing, [imageMessage('fail-mode')]))
      .rejects.toThrow('vision-proxy: hard failure')
    await failing.root.fiber.dispose()
  })

  it('handles every terminal description failure in pass-through mode', async () => {
    const cases: readonly StreamChunk[][] = [
      [{ type: 'text-delta', index: 0, text: 'unterminated' }],
      [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider failed', code: 'FAILED' } } }],
      [{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'provider aborted', code: 'ABORTED' } } }],
      [{ type: 'finish', reason: { kind: 'tool-calls' } }],
      [{ type: 'finish', reason: { kind: 'stop' } }],
    ]
    const error = console.error
    console.error = () => {}
    try {
      for (const chunks of cases) {
        const ctx = await harness(new ResponseAdapter(chunks), { errorMode: 'pass' })
        const original = imageMessage(`failure-${String(chunks[0]?.type)}`)
        const decision = await intercept(ctx, [original])
        expect(decision).toMatchObject({ kind: 'enter', messages: [original] })
        await ctx.root.fiber.dispose()
      }
    } finally {
      console.error = error
    }
  })

  it('propagates parent aborts, handles the resolve race, and enforces the timeout', async () => {
    const error = console.error
    console.error = () => {}
    try {
      const duringStream = new AbortController()
      const streamAdapter = new ResponseAdapter(textResponse('unused'), () => {
        duringStream.abort(new Error('cancel during stream'))
      })
      const streamCtx = await harness(streamAdapter, { errorMode: 'pass' })
      await expect(intercept(streamCtx, [imageMessage('abort-stream')], duringStream.signal))
        .resolves.toMatchObject({ kind: 'enter' })
      await streamCtx.root.fiber.dispose()

      const duringResolve = new AbortController()
      class ResolveRaceAdapter extends ResponseAdapter {
        override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
          duringResolve.abort(new Error('cancel during resolve'))
          return super.resolveModel(provider, model)
        }
      }
      const raceCtx = await harness(new ResolveRaceAdapter(textResponse('unused')), { errorMode: 'pass' })
      await expect(intercept(raceCtx, [imageMessage('abort-resolve')], duringResolve.signal))
        .resolves.toMatchObject({ kind: 'enter' })
      await raceCtx.root.fiber.dispose()

      const timeoutAdapter = new ResponseAdapter([], options => new Promise<void>((_resolve, reject) => {
        const signal = options.signal
        if (signal === undefined) throw new Error('vision request did not carry its timeout signal')
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('vision request aborted'))
        }, { once: true })
      }))
      const timeoutCtx = await harness(timeoutAdapter, { errorMode: 'pass', timeoutMs: 1000 })
      await expect(intercept(timeoutCtx, [imageMessage('timeout')]))
        .resolves.toMatchObject({ kind: 'enter' })
      await timeoutCtx.root.fiber.dispose()
    } finally {
      console.error = error
    }
  })

  it('evicts the oldest description after the bounded cache fills', async () => {
    const adapter = new FixtureAdapter()
    const ctx = await harness(adapter)
    for (let index = 0; index < 129; index += 1) {
      await intercept(ctx, [imageMessage(`cache-${String(index)}`)])
    }
    expect(adapter.requests).toHaveLength(129)
    await intercept(ctx, [imageMessage('cache-0')])
    expect(adapter.requests).toHaveLength(130)
    await ctx.root.fiber.dispose()
  })
})
