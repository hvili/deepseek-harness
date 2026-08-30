/**
 * Browser caller for generic Connection unary RPC channels over the desktop
 * bridge — the IPC mirror of {@link createWebConnectionRpc}: same correlation
 * and envelope validation, transport swapped from `globalThis.fetch` to the
 * bridge.
 * @module @deepseek-ai/dsh-client-connection/ipc-rpc
 */

import {
  RpcId,
  serverResponseSchema,
  type ClientRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientConnectionRpc } from '../rpc.ts'
import type { DesktopBridge, DesktopBridgeResponse } from './desktop-bridge.ts'
import { randomUuid } from './random-uuid.ts'

const INTERNAL_BASE = 'http://dsh.internal'
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Create the bridge-backed generic RPC caller.
 * @param bridge - the preload-exposed desktop bridge.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createIpcConnectionRpc(bridge: DesktopBridge): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const response = await bridgeFetch(bridge, new URL(`${channel}/${endpoint}`, INTERNAL_BASE), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      }, signal)
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const full = serverResponseSchema.parse(await response.json())
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}
/**
 * One bridge round trip: converts a `RequestInit` into the clone-safe bridge
 * request, rejects on abort, and rebuilds a `Response` from the JSON answer.
 * @param bridge - the desktop bridge.
 * @param input - the request URL.
 * @param init - request options; only method/headers/body/signal are used.
 * @param signal - optional abandonment signal (wired to {@link DesktopBridge.cancel}).
 * @returns the rebuilt Response.
 */
async function bridgeFetch(
  bridge: DesktopBridge,
  input: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted === true) throw abortError(signal)
  const id = `rpc_${randomUuid()}`
  const promise = new Promise<DesktopBridgeResponse>((resolve, reject) => {
    // Abort rejects the caller even when the bridge ignores the cancel.
    const onAbort = (): void => {
      bridge.cancel(id)
      reject(abortError(signal as AbortSignal))
    }
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    bridge.fetch({
      id,
      url: input.href,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      ...init.body !== undefined ? { body: init.body } : {},
    }).then(resolve, reject).finally(() => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    })
  })
  const { status, headers, body } = await promise
  return new Response(body, { status, headers })
}

/** Mirror fetch's abort rejection (the signal's reason when it is an Error). */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}

function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection rpc: invalid target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
