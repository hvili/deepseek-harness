/** Release stage manifest: canonicalization, build hash, and write/read round-trip. */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseFamily } from './families.ts'
import type { ReleaseMember } from './families.ts'
import {
  RELEASE_MANIFEST_ANCHOR,
  RELEASE_MANIFEST_FILE,
  buildHashOf,
  canonicalJson,
  makeReleaseManifest,
  readReleaseManifest,
  writeReleaseManifest,
  type ReleaseStageManifest,
} from './manifest.ts'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('canonicalJson', () => {
  it('sorts object keys deterministically and drops undefined', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a": 1, "b": 2}')
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b": 1}')
    expect(canonicalJson([{ z: 1 }, { y: 2 }])).toBe('[{"z": 1}, {"y": 2}]')
  })

  it('is order-and-shape stable (same document serializes identically twice)', () => {
    const left = canonicalJson({ c: [3, { a: 1, b: 2 }], a: 'x' })
    const right = canonicalJson({ a: 'x', c: [3, { b: 2, a: 1 }] })
    expect(left).toBe(right)
  })
})

describe('buildHashOf', () => {
  it('is a deterministic sha256 over the canonical content', () => {
    const base = {
      family: 'dsh',
      version: '0.1.0',
      commit: 'abc1234',
      artifacts: [{ name: '@deepseek-ai/dsh', version: '0.1.0', integrity: 'sha512-a' }],
      pluginGraph: [{ from: '@deepseek-ai/dsh', to: '@deepseek-ai/cordis' }],
      sbom: [{ name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: ['@deepseek-ai/cordis'] }],
    }
    expect(buildHashOf(base)).toBe(buildHashOf(base))
    expect(buildHashOf(base)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('changes when any hashed content field changes', () => {
    const base = {
      family: 'dsh', version: '0.1.0', commit: 'abc1234',
      artifacts: [{ name: '@deepseek-ai/dsh', version: '0.1.0', integrity: 'sha512-a' }],
      pluginGraph: [], sbom: [],
    }
    // The hash covers family/version/commit/pluginGraph/sbom — the source
    // identity of a release. `artifacts` integrity is deliberately excluded,
    // so changing a tarball's bytes must not disturb the run-time build hash.
    expect(buildHashOf({ ...base, commit: 'def5678' })).not.toBe(buildHashOf(base))
    expect(buildHashOf({
      ...base,
      sbom: [{ name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: ['@deepseek-ai/cordis'] }],
    })).not.toBe(buildHashOf(base))
    expect(buildHashOf({
      ...base,
      pluginGraph: [{ from: '@deepseek-ai/dsh', to: '@deepseek-ai/cordis' }],
    })).not.toBe(buildHashOf(base))
    expect(buildHashOf({ ...base, family: 'vendor' })).not.toBe(buildHashOf(base))
    expect(buildHashOf({ ...base, version: '0.1.1' })).not.toBe(buildHashOf(base))
    // A tarball-integrity change leaves the hash unchanged (and is caught
    // separately by the publish-boundary guard on the artifact set).
    expect(buildHashOf({
      ...base,
      artifacts: [{ name: '@deepseek-ai/dsh', version: '0.1.1', integrity: 'sha512-a' }],
    })).toBe(buildHashOf(base))
  })
})

describe('write/read round-trip', () => {
  it('writes the manifest and a tamper-anchor over its exact bytes', () => {
    const dir = tempDir('rmf-rt-')
    const manifest: ReleaseStageManifest = {
      family: 'dsh', version: '0.1.0', commit: 'abc', buildHash: 'h'.repeat(64), createdAt: 1,
      artifacts: [], pluginGraph: [], sbom: [],
    }
    writeReleaseManifest(dir, manifest)

    const anchor = readFileSync(join(dir, RELEASE_MANIFEST_ANCHOR), 'utf8')
    const expected = createHash('sha256').update(`${canonicalJson(manifest)}\n`, 'utf8').digest('hex')
    expect(anchor).toBe(expected)

    expect(readReleaseManifest(dir)).toEqual(manifest)
    expect(readFileSync(join(dir, RELEASE_MANIFEST_FILE), 'utf8')).toBe(`${canonicalJson(manifest)}\n`)
  })
})

describe('makeReleaseManifest', () => {
  it('assembles a full stage manifest with a self-consistent buildHash', () => {
    const dir = tempDir('rmf-make-')
    writeFileSync(join(dir, 'publish-order.txt'), '\n') // empty packed set still yields an order file
    // A minimal member list exercises the SBOM/plugin-graph fold without git/tar.
    const memberProto: ReleaseMember = {
      name: '@deepseek-ai/dsh', version: '0.1.0', directory: 'apps/cli',
      manifest: { name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: { '@deepseek-ai/cordis': '^4' } },
    }
    const manifest = makeReleaseManifest(releaseFamily('dsh'), [memberProto], dir)
    expect(manifest.family).toBe('dsh')
    expect(manifest.version).toBe('0.1.0')
    expect(typeof manifest.commit).toBe('string')
    expect(Array.isArray(manifest.artifacts)).toBe(true)
    expect(manifest.sbom).toEqual([{ name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: ['@deepseek-ai/cordis'] }])
    expect(manifest.pluginGraph).toEqual([]) // cordis is not a family member
    expect(manifest.buildHash).toMatch(/^[0-9a-f]{64}$/u)
    // buildHash is self-consistent with the other recorded fields.
    expect(manifest.buildHash).toBe(buildHashOf({
      family: manifest.family, version: manifest.version, commit: manifest.commit,
      artifacts: manifest.artifacts, pluginGraph: manifest.pluginGraph, sbom: manifest.sbom,
    }))
  })

  it('folds within-family dependency edges into the plugin graph', () => {
    const dir = tempDir('rmf-graph-')
    writeFileSync(join(dir, 'publish-order.txt'), '\n')
    const members: ReleaseMember[] = [
      { name: '@deepseek-ai/dsh', version: '0.1.0', directory: 'a', manifest: { name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: { '@deepseek-ai/dsh-plugin': '^0.1' } } },
      { name: '@deepseek-ai/dsh-plugin', version: '0.1.0', directory: 'b', manifest: { name: '@deepseek-ai/dsh-plugin', version: '0.1.0', dependencies: {} } },
    ]
    const manifest = makeReleaseManifest(releaseFamily('dsh'), members, dir)
    expect(manifest.pluginGraph).toEqual([{ from: '@deepseek-ai/dsh', to: '@deepseek-ai/dsh-plugin' }])
  })
})
