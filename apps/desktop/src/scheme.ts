/** Privileged renderer origin registered before Electron becomes ready. */

import { protocol } from 'electron'

/** Renderer document served exclusively by the in-memory carrier. */
export const APP_INDEX_URL = 'app://dsh/index.html'

/** Custom protocol name shared by bootstrap registration and Main handling. */
export const APP_SCHEME = 'app'

/** Sole accepted authority for the custom protocol. */
export const APP_HOST = 'dsh'

/** Register app:// synchronously before any Host dependency is imported. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }])
}
