/** Package-owned invariant companion for the Codex app-server integration seam. @module @deepseek-ai/dsh-codex-app-server/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-codex-app-server'

/** Cordis companion plugin name. */
export const name = 'codex-app-server-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: callers own connection policy while this stateless seam owns protocol and process helpers. */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
