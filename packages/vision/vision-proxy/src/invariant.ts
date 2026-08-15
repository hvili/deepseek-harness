/** Runtime invariant companion for the vision-proxy plugin. */

/** Package manifest name used by invariant discovery. */
export const name = '@deepseek-ai/dsh-vision-proxy'

/** The companion is loaded by the invariant service during test composition. */
export const inject = ['invariants']

/**
 * This plugin has no independent durable registry. Its only state transition
 * is the agent/pre-step waterfall, which is covered by the composition tests.
 */
export function apply(): void {
  // No runtime invariant: agent/pre-step transformation is asserted in tests.
}
