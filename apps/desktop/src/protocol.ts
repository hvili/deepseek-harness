import { protocol } from 'electron'
import type { DesktopWebServer } from '@deepseek-ai/dsh-host-desktop-carrier'
import { APP_HOST, APP_SCHEME } from './scheme.ts'

/** Route only app://dsh requests into the zero-port carrier. */
export function registerDesktopProtocol(carrier: DesktopWebServer): void {
  protocol.handle(APP_SCHEME, (request) => {
    try {
      if (new URL(request.url).hostname !== APP_HOST) return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 400 })
    }
    return carrier.dispatch(request)
  })
}
