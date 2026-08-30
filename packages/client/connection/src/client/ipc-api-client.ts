/**
 * Electron IPC carrier: the `AbstractApiClient` subclass whose `doFetch` and
 * stream openers ride the desktop bridge instead of HTTP/WebSocket. Protocol
 * invariants (rpcId minting, envelope validation, value parse) stay in the
 * base class; only the transport changes, exactly as the gui-layering note's
 * subclass table reserves for an IPC bridge.
 * @module @deepseek-ai/dsh-client-connection/ipc-api-client
 */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import type { DesktopBridge, DesktopBridgeRequest } from './desktop-bridge.ts'

type Frame = MuxFrame | HostFrame
type StreamName = 'mux' | 'host'
type Parser<F> = { parse(value: unknown): F }

interface StreamItem<F> {
  kind: 'frame' | 'end'
  envelope?: RpcRequest<F>
}
/** Monotonic per-client request id (the wire needs only uniqueness within one client). */
let nextRequestId = 0

/** Normalize a RequestInit headers value into the bridge's plain record. */
function headersRecord(headers: RequestInit['headers']): Record<string, string> {
  const record: Record<string, string> = {}
  if (headers === undefined) return record
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) record[name.toLowerCase()] = value
    return record
  }
  if (headers instanceof Headers) {
    headers.forEach((value, name) => { record[name.toLowerCase()] = value })
    return record
  }
  for (const [name, value] of Object.entries(headers)) record[name.toLowerCase()] = value
  return record
}

/** Mirror fetch's abort rejection (the signal's reason when it is an Error). */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}

/**
 * Renderer-side desktop carrier. `doFetch` serializes the call over
 * {@link DesktopBridge.fetch} and rebuilds a `Response` from the plain-JSON
 * answer; `openMux`/`openHost` subscribe to the bridge's downlink streams and
 * yield validated frames with the same inbox/wake shape as the WebSocket
 * carrier.
 */
export class IpcApiClient extends AbstractApiClient {
  /**
   * @param bridge - the preload-exposed desktop bridge.
   * @param timeoutMs - bounded-unary deadline, forwarded to the base class.
   */
  constructor(private readonly bridge: DesktopBridge, timeoutMs?: number) {
    super(timeoutMs)
  }

  /** The underlying bridge, for consumers that need transport facts. */
  get transport(): DesktopBridge {
    return this.bridge
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    // RequestInit.signal is `AbortSignal | null`; normalize so the closures
    // below see a single undefined-only type.
    const signal = init?.signal ?? undefined
    if (signal?.aborted === true) {
      return Promise.reject(abortError(signal))
    }
    const id = `rpc_${String(++nextRequestId)}`
    // The base class always sends a stringified JSON body; a non-string body
    // would be a caller bug, so the cast names the contract instead of
    // silently stringifying an object.
    const body = init?.body === undefined ? undefined : init.body as string
    const request: DesktopBridgeRequest = {
      id,
      url: input.href,
      method: init?.method ?? 'GET',
      headers: headersRecord(init?.headers),
      ...body !== undefined ? { body } : {},
    }
    return new Promise<Response>((resolve, reject) => {
      // Abort (caller or the base class's bounded deadline) rejects the caller
      // even when the bridge ignores the cancel — mirroring InProcessApiClient.
      const onAbort = (): void => {
        this.bridge.cancel(id)
        reject(abortError(signal as AbortSignal))
      }
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      void this.bridge.fetch(request).then(
        ({ status, headers, body }) => { resolve(new Response(body, { status, headers })) },
        reject,
      ).finally(() => {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      })
    })
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readIpcStream('mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readIpcStream('host', signal, hostFrameSchema, onOpen)
  }

  private async *readIpcStream<F extends Frame>(
    stream: StreamName,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const inbox: StreamItem<F>[] = []
    let wake: (() => void) | undefined
    let closed = false
    const enqueue = (item: StreamItem<F>): void => {
      // The end marker bypasses the closed guard; later frames never arrive.
      if (closed && item.kind !== 'end') return
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const finish = (): void => {
      closed = true
      enqueue({ kind: 'end' })
    }
    const subscription = this.bridge.subscribe(stream, (full: ServerRequest) => {
      let frame: F
      try {
        const parsed = serverRequestSchema.parse(full)
        frame = frameSchema.parse(parsed.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed IPC frame on ${stream}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    })
    subscription.onEnd(() => { finish() })
    const handleAbort = (): void => { finish() }
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    // A live subscription is the stream-established signal, before any frame.
    onOpen?.()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as StreamItem<F>
          if (item.kind === 'end') return
          yield item.envelope as RpcRequest<F>
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      subscription.unsubscribe()
    }
  }
}
