import { protocol } from 'electron'
import type { DesktopWebServer } from '@deepseek-ai/dsh-host-desktop-carrier'

/** Renderer origin served exclusively by the in-memory carrier. */
export const APP_INDEX_URL = 'app://dsh/index.html'
const SCHEME = 'app'
const HOST = 'dsh'

/** Register app:// before Electron readiness, making it a secure normal origin. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }])
}

/** Route only app://dsh requests into the zero-port carrier. */
export function registerDesktopProtocol(carrier: DesktopWebServer): void {
  protocol.handle(SCHEME, (request) => {
    try {
      if (new URL(request.url).hostname !== HOST) return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 400 })
    }
    return carrier.dispatch(request)
  })
}
