/**
 * Optional image-to-text preprocessing for text-only conversation models.
 *
 * The plugin runs at `agent/pre-step`, before a claimed user message is
 * appended to the session. When enabled, it sends the durable image refs to a
 * configured image-capable route, replaces the image blocks with the returned
 * description, and lets the ordinary text model continue. The replacement is
 * therefore both model-visible and durable in the session log.
 *
 * @module @deepseek-ai/dsh-vision-proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { contentHasImage, createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  ImageBlock,
  StreamChunk,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Cordis loader identity. */
export const name = 'vision-proxy'

/** The LLM runtime is the only required service; settings is optional wiring. */
export const inject = ['llm']

/** Default image-capable route in the bundled pi-ai catalog. */
export const DEFAULT_VISION_PROVIDER = 'qwen-token-plan-cn'

/** Default image-capable model in that route. */
export const DEFAULT_VISION_MODEL = 'kimi-k2.5'

/** Conservative cap for one auxiliary description call. */
export const DEFAULT_MAX_TOKENS = 1024

/** Prompt kept stable so descriptions are factual and compact. */
export const DEFAULT_PROMPT = [
  'You are an image-analysis helper for a text-only coding agent.',
  'Describe the supplied image(s) factually and concisely for another model.',
  'Include visible text (OCR), important objects, layout, UI state, code or error text,',
  'and uncertainty. Do not address the user or invent details.',
].join(' ')

/** Settings namespace exposed to configuration clients. */
export const SETTINGS_NAMESPACE = settingsNamespace('vision-proxy')

/** Plugin and settings-section configuration. */
export interface Config {
  /** Whether image preprocessing is active. */
  enabled?: boolean
  /** Provider route used for the auxiliary image call. */
  visionProvider?: string
  /** Image-capable model used for the auxiliary image call. */
  visionModel?: string
  /** Maximum output tokens for one description call. */
  maxTokens?: number
  /** Instruction sent alongside the image. */
  prompt?: string
}

/** Schemastery schema shared by composition and live settings. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  visionProvider: z.string().default(DEFAULT_VISION_PROVIDER),
  visionModel: z.string().default(DEFAULT_VISION_MODEL),
  maxTokens: z.number().step(1).min(1).max(8192).default(DEFAULT_MAX_TOKENS),
  prompt: z.string().default(DEFAULT_PROMPT),
})

interface ResolvedConfig {
  enabled: boolean
  visionProvider: string
  visionModel: string
  maxTokens: number
  prompt: string
}

/** Apply schema defaults again for programmatic composition callers. */
function resolveConfig(config: Config): ResolvedConfig {
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 8192) {
    throw new Error('vision-proxy: maxTokens must be a positive safe integer no greater than 8192')
  }
  const visionProvider = config.visionProvider ?? DEFAULT_VISION_PROVIDER
  const visionModel = config.visionModel ?? DEFAULT_VISION_MODEL
  if (visionProvider.trim() === '' || visionModel.trim() === '') {
    throw new Error('vision-proxy: visionProvider and visionModel must be non-empty')
  }
  return {
    enabled: config.enabled ?? false,
    visionProvider,
    visionModel,
    maxTokens,
    prompt: config.prompt ?? DEFAULT_PROMPT,
  }
}

/** Recursively collect image blocks, including images nested in tool results. */
function imageBlocks(blocks: readonly ContentBlock[], result: ImageBlock[] = []): ImageBlock[] {
  for (const block of blocks) {
    if (block.type === 'image') result.push(block)
    else if (block.type === 'tool-result') imageBlocks(block.content, result)
  }
  return result
}

/** Extract the user's ordinary text to give the vision helper task context. */
function textBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool-result') return textBlocks(block.content)
    return ''
  }).join('')
}

/** Replace every image in one message with the same combined description. */
function replaceImages(
  blocks: readonly ContentBlock[],
  description: string,
  inserted: { value: boolean },
): ContentBlock[] {
  const next: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      if (!inserted.value) {
        next.push({
          type: 'text',
          text: `\n\n图片内容（由图像分析模型提取）：\n${description.trim()}\n`,
        })
        inserted.value = true
      }
      continue
    }
    if (block.type === 'tool-result') {
      next.push({
        ...block,
        content: replaceImages(block.content, description, inserted),
      })
      continue
    }
    next.push(block)
  }
  return next
}

/** Collect visible text from a stream and surface terminal model failures. */
async function readDescription(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
): Promise<string> {
  let text = ''
  let finish: StreamChunk & { type: 'finish' } | undefined
  for await (const chunk of stream) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish') finish = chunk
  }
  if (finish === undefined) throw new Error('vision-proxy: vision model ended without a finish signal')
  if (finish.reason.kind === 'error' || finish.reason.kind === 'aborted') {
    throw new Error(`vision-proxy: ${finish.reason.failure.message}`)
  }
  if (finish.reason.kind === 'tool-calls') {
    throw new Error('vision-proxy: vision model returned a tool call instead of a description')
  }
  if (text.trim() === '') throw new Error('vision-proxy: vision model returned an empty description')
  return text.trim()
}

/** Build one auxiliary image call. */
function visionRequest(
  config: ResolvedConfig,
  message: UserMessage,
  images: readonly ImageBlock[],
  signal: AbortSignal,
): GenerateOptions {
  const sourceText = textBlocks(message.content).trim()
  return {
    provider: config.visionProvider,
    model: config.visionModel,
    messages: [createUserMessage({
      content: [
        { type: 'text', text: config.prompt },
        ...images,
        ...sourceText === '' ? [] : [{ type: 'text' as const, text: `User text for context: ${sourceText}` }],
      ],
      source: { kind: 'plugin', plugin: name },
    })],
    maxTokens: config.maxTokens,
    signal,
  }
}

/** Convert one claimed message through the configured image model. */
async function transformMessage(
  ctx: Context,
  config: ResolvedConfig,
  message: UserMessage,
  signal: AbortSignal,
): Promise<UserMessage> {
  const images = imageBlocks(message.content)
  if (images.length === 0) return message
  signal.throwIfAborted()
  const info = await ctx.llm.resolveModelInfo(config.visionProvider, config.visionModel, signal)
  if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
    throw new Error(
      `vision-proxy: model "${config.visionModel}" on provider "${config.visionProvider}" does not accept images`,
    )
  }
  const description = await readDescription(
    ctx.llm.stream(visionRequest(config, message, images, signal)),
    signal,
  )
  const replaced = replaceImages(message.content, description, { value: false })
  return freezeMessage({ ...message, content: replaced })
}

/** Register the live setting and the pre-step image transformation. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: (value) => { resolveConfig(value) },
  })

  ctx.on('agent/pre-step', async ({ messages, signal }, next): Promise<PreStepDecision> => {
    const resolved = resolveConfig(current())
    if (!resolved.enabled || !messages.some(message => contentHasImage(message.content))) return next()
    const transformed: UserMessage[] = []
    for (const message of messages) {
      transformed.push(await transformMessage(ctx, resolved, message, signal))
    }
    return { kind: 'enter', messages: transformed }
  })
}
