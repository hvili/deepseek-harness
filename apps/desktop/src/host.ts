/** Desktop Profile composition and in-process Host boot. */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot, composeEntries, ensureDesktopProfile, healProfilesModuleFallback,
  loadOptionalPatches, loadProfile,
} from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh-desktop'
const ROOT_CONFIG = 'desktop.root.yml'
const EMPTY_ROOT = '[]\n'

/** Boot result retained by Main until application shutdown. */
export interface DesktopHost {
  ctx: Context
  profileDir: string
}

/**
 * Compose the marked desktop Profile and activate it without a CLI server or
 * browser handoff. `app` owns this package's dependency closure in both source
 * and packaged layouts, so it is the installation anchor for bundle lookup.
 */
export async function bootDesktopHost(home: string): Promise<DesktopHost> {
  const installAnchor = createRequire(import.meta.url).resolve('../package.json')
  const profileDir = ensureDesktopProfile(home)
  healProfilesModuleFallback(installAnchor, home)
  const profile = loadProfile(NAME, 'desktop', installAnchor, home)
  const rootConfig = join(profileDir, ROOT_CONFIG)
  writeFileSync(rootConfig, EMPTY_ROOT)
  const bundles = profile.layers.flatMap(layer => layer.patches)
  const user = loadOptionalPatches(NAME, profile.patchPath) ?? []
  const homePatch = loadOptionalPatches(NAME, join(home, 'cordis.patch.yml')) ?? []
  // Compose once here solely to force structural patch diagnostics before any
  // services mount. Fresh clones avoid Loader mutating parsed insert rows.
  composeEntries([bundles, user, homePatch])
  const patches = structuredClone([...bundles, ...user, ...homePatch])
  const ctx = await boot(NAME, rootConfig, patches, undefined, installAnchor)
  return { ctx, profileDir }
}
