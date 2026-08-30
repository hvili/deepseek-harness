/** Package-owned invariant for the interactive Host lock. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-instance-lock'

/** Stable invariant plugin name. */
export const name = 'host-instance-lock-invariant'

/** Invariant service dependency. */
export const inject = ['invariants']

/**
 * Require an activated lock service to expose its owner record.
 * @param ctx - invariant context.
 */
const install: InvariantInstaller = (ctx, fail) => {
  const service = ctx.get('hostInstanceLock')
  if (service !== undefined && service.owner === undefined) fail('active host lock has no owner record')
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
