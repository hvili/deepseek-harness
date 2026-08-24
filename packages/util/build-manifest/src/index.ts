/**
 * Immutable build-time identity of one DeepSeek Harness installation: the
 * version, and — when the release pipeline stamps them — the git commit and
 * build hash. The launcher provides it at boot, like the launch-environment
 * snapshot, so every surface reports the same artifact it actually runs.
 * @module @deepseek-ai/dsh-build-manifest
 */
import type { Context } from '@deepseek-ai/cordis'

/** Immutable artifact identity stamped at build time and reported to every surface. */
export interface BuildManifest {
  /** The host app's (apps/cli) package.json version. */
  version: string
  /** Short git commit this artifact was built from; absent when unstamped. */
  commit?: string
  /** Release-pipeline build hash; absent when unstamped. */
  buildHash?: string
  /** The session-log on-disk format version this build is stamped with. */
  schemaVersion?: number
}

/** The context key under which the launcher provides the build manifest. */
export const DSH_BUILD_MANIFEST_KEY = 'buildManifest'

/** The manifest the launcher provided for this launch, or `undefined` when a composition mounted without one. */
/**
 * The manifest the launcher provided for this launch, or `undefined` when a composition mounted without one.
 * @param ctx - the cordis context carrying the manifest value.
 * @returns the build manifest, or `undefined` when the composition mounted without one.
 */
export function buildManifestOf(ctx: Context): BuildManifest | undefined {
  const manifest: unknown = ctx.get(DSH_BUILD_MANIFEST_KEY)
  return manifest as BuildManifest | undefined
}
