/**
 * Desktop bundle marker. Its patch is the runtime surface: it replaces the
 * TCP carrier with the Electron protocol carrier and adds the Main-process IPC
 * bridge. Keeping this module intentionally tiny means it introduces no second
 * application lifecycle beside Electron's owner.
 */

/** Stable Cordis plugin name for diagnostics. */
export const name = 'desktop-app-bundle'

/** Desktop bundle does not need an imperative host plugin. */
export function apply(): void {}
