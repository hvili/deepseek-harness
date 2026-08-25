import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildManifestOf, DSH_BUILD_MANIFEST_KEY } from '../src/index.ts'

describe('buildManifestOf', () => {
  it('returns the manifest the launcher provided', () => {
    const ctx = new Context()
    ctx.provide(DSH_BUILD_MANIFEST_KEY, { version: '0.1.0-rc.5', commit: 'abc123', buildHash: 'deadbeef' })
    expect(buildManifestOf(ctx)).toEqual({ version: '0.1.0-rc.5', commit: 'abc123', buildHash: 'deadbeef' })
  })
  it('returns undefined when no manifest was provided', () => {
    expect(buildManifestOf(new Context())).toBeUndefined()
  })
})
