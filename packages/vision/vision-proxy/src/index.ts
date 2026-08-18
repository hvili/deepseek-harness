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

/** Fatal semantics when the auxiliary vision call fails. */
export const DEFAULT_ERROR_MODE = 'fail'

/** Preserved text inserted before each generated description. */
export const DEFAULT_DESCRIPTION_PREFIX = '图片内容（由图像分析模型提取）：'

/** Default timeout for one auxiliary vision call, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Maximum number of cached image-set descriptions kept per plugin instance. */
export const DESCRIPTION_CACHE_MAX = 64

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
  /** Text inserted before the generated description in the session log. */
  descriptionPrefix?: string
  /** Behavior when the auxiliary vision call fails. */
  errorMode?: 'fail' | 'pass'
  /** Timeout for one auxiliary vision call, in milliseconds. */
  timeoutMs?: number
}

/** Schemastery schema shared by composition and live settings. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  visionProvider: z.string().default(DEFAULT_VISION_PROVIDER),
  visionModel: z.string().default(DEFAULT_VISION_MODEL),
  maxTokens: z.number().step(1).min(1).max(8192).default(DEFAULT_MAX_TOKENS),
  prompt: z.string().default(DEFAULT_PROMPT),
  descriptionPrefix: z.string().default(DEFAULT_DESCRIPTION_PREFIX),
  errorMode: z.union([z.const('fail'), z.const('pass')]).default(DEFAULT_ERROR_MODE),
  timeoutMs: z.number().step(1).min(1000).max(300000).default(DEFAULT_TIMEOUT_MS),
})

interface ResolvedConfig {
  enabled: boolean
  visionProvider: string
  visionModel: string
  maxTokens: number
  prompt: string
  descriptionPrefix: string
  errorMode: 'fail' | 'pass'
  timeoutMs: number
}

/** Apply schema defaults again for programmatic composition callers. */
function resolveConfig(config: Config): ResolvedConfig {
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > 8192) {
    throw new Error('vision-proxy: maxTokens must be a positive safe integer no greater than 8192')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new Error('vision-proxy: timeoutMs must be a safe integer between 1000 and 300000')
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
    descriptionPrefix: config.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
    errorMode: config.errorMode ?? DEFAULT_ERROR_MODE,
    timeoutMs,
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

/** Stable key for one image-set description call. The prompt and provider/model
 * participate so a settings change cannot replay a stale description. */
function descriptionCacheKey(
  config: ResolvedConfig,
  message: UserMessage,
  images: readonly ImageBlock[],
): string {
  const attachmentIds = images
    .map(image => String(image.attachment.attachmentId))
    .sort()
    .join('|')
  const sourceText = textBlocks(message.content).trim()
  return [
    config.visionProvider,
    config.visionModel,
    config.prompt,
    String(config.maxTokens),
    sourceText,
    attachmentIds,
  ].join('\u0000')
}

/** Read a cache entry and refresh its recency. */
function cacheGet(cache: Map<string, string>, key: string): string | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

/** Write a cache entry, evicting the least-recently-used item when full. */
function cacheSet(cache: Map<string, string>, key: string, value: string): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > DESCRIPTION_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** Replace every image in one message with the same combined description. */
function replaceImages(
  blocks: readonly ContentBlock[],
  description: string,
  prefix: string,
  inserted: { value: boolean },
): ContentBlock[] {
  const next: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      if (!inserted.value) {
        next.push({
          type: 'text',
          text: `\n\n${prefix}${description.trim()}\n`,
        })
        inserted.value = true
      }
      continue
    }
    if (block.type === 'tool-result') {
      next.push({
        ...block,
        content: replaceImages(block.content, description, prefix, inserted),
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

/**
 * Bound a signal with a timeout without leaking the timer. Returns a child
 * signal plus a dispose function that must be called after the stream settles.
 */
function withTimeout(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort(signal.reason) }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    controller.abort(new Error(`vision-proxy: vision call timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  if (signal.aborted) {
    clearTimeout(timer)
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const child = controller.signal
  const dispose = (): void => {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
  return { signal: child, dispose }
}

/** Convert one claimed message through the configured image model. */
async function transformMessage(
  ctx: Context,
  config: ResolvedConfig,
  message: UserMessage,
  signal: AbortSignal,
  cache?: Map<string, string>,
): Promise<UserMessage> {
  const images = imageBlocks(message.content)
  if (images.length === 0) return message
  signal.throwIfAborted()
  const key = cache === undefined ? undefined : descriptionCacheKey(config, message, images)
  if (key !== undefined && cache !== undefined) {
    const cached = cacheGet(cache, key)
    if (cached !== undefined) {
      const replaced = replaceImages(message.content, cached, config.descriptionPrefix, { value: false })
      return freezeMessage({ ...message, content: replaced })
    }
  }
  const info = await ctx.llm.resolveModelInfo(config.visionProvider, config.visionModel, signal)
  if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
    throw new Error(
      `vision-proxy: model "${config.visionModel}" on provider "${config.visionProvider}" does not accept images`,
    )
  }
  try {
    const bounded = withTimeout(signal, config.timeoutMs)
    let description: string
    try {
      description = await readDescription(
        ctx.llm.stream(visionRequest(config, message, images, bounded.signal)),
        bounded.signal,
      )
    } finally {
      bounded.dispose()
    }
    if (key !== undefined && cache !== undefined) cacheSet(cache, key, description)
    const replaced = replaceImages(message.content, description, config.descriptionPrefix, { value: false })
    return freezeMessage({ ...message, content: replaced })
  } catch (error) {
    // 'pass' mode deliberately lets the original message through. The main
    // model may then reject it with its own clearer error, or — if the user
    // is experimenting with an image-capable main route — proceed normally.
    if (config.errorMode === 'pass') {
      console.error(`[vision-proxy] image description failed; passing image through (errorMode=pass):`, error)
      return message
    }
    throw error
  }
}

/** Register the live setting and the pre-step image transformation. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  const descriptionCache = new Map<string, string>()
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
      transformed.push(await transformMessage(ctx, resolved, message, signal, descriptionCache))
    }
    return { kind: 'enter', messages: transformed }
  })
}
