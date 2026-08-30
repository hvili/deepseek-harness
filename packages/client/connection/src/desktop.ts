/** In-process Host bridge used by the Electron Main process. */

import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { RpcId, type HostFrame, type MuxFrame, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { API_PATH } from './api-path.ts'
import { createApiGatewayFetch } from './api-gateway.ts'
import { HostConnectionService } from './rpc-host.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-connection'

/** Service key consumed by Electron Main. */
export const DESKTOP_BRIDGE_SERVICE = 'desktopBridge'

/** Host half of the Electron bridge. */
export interface DesktopBridgeHost {
  /** Dispatch a unary/respond request. */
  fetch(request: Request): Promise<Response>
  /** Open the session mux event stream. */
  openMux(signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>
  /** Open the host event stream. */
  openHost(signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>
}
/** Service adapting the API Proxy and event streams to Electron Main. */
export class DesktopBridgeService extends Service implements DesktopBridgeHost {
  /**
   * @param ctx - owning plugin context.
   * @param fetchHandler - shared gateway handler from the Web connection row.
   */
  constructor(ctx: Context, private readonly fetchHandler: { fetch(request: Request): Promise<Response> }) {
    super(ctx, DESKTOP_BRIDGE_SERVICE)
  }

  fetch(request: Request): Promise<Response> {
    return this.fetchHandler.fetch(request)
  }

  openMux(signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.openStream('mux', signal)
  }

  openHost(signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>> {
    return this.openStream('host', signal)
  }

  private openStream<F extends MuxFrame | HostFrame>(
    stream: 'mux' | 'host', signal: AbortSignal,
  ): AsyncIterable<RpcRequest<F>> {
    const api = this.ctx.get('apiProxy')
    if (api === undefined) throw new Error('desktop-connection: apiProxy service is unavailable')
    const request = { rpcId: RpcId(randomUUID()), payload: {} }
    const frames = stream === 'mux' ? api.events.mux(request, signal) : api.events.host(request, signal)
    return frames as AsyncIterable<RpcRequest<F>>
  }
}

/** Existing Web connection service must activate before this adapter. */
export const inject = ['connection']

/**
 * Provide the in-process desktop bridge over the existing connection registry.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as HostConnectionService
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, createApiGatewayFetch(ctx))
  void new DesktopBridgeService(ctx, fetchHandler)
}
