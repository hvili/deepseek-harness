import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, DEFAULT_VISION_MODEL, DEFAULT_VISION_PROVIDER } from '../src/index.ts'

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

async function harness(adapter: FixtureAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter([DEFAULT_VISION_PROVIDER, 'text'], adapter)
  await ctx.plugin({ inject: ['llm'], apply }, {
    enabled: true,
    visionProvider: DEFAULT_VISION_PROVIDER,
    visionModel: DEFAULT_VISION_MODEL,
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
    const adapter = new FixtureAdapter()
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
})
