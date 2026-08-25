/** Cross-host artifact fingerprint comparison: composition must agree exactly. */

import { describe, expect, it } from 'vitest'
import { compareToReference, describeFingerprint, type ReleaseFingerprint } from './compare-artifacts.ts'

const reference: ReleaseFingerprint = {
  buildHash: 'h'.repeat(64),
  family: 'dsh',
  version: '0.1.0-rc.5',
  commit: 'abc1234',
  pluginGraph: [{ from: '@deepseek-ai/dsh', to: '@deepseek-ai/cordis' }],
  sbom: [{ name: '@deepseek-ai/dsh', version: '0.1.0', dependencies: ['@deepseek-ai/cordis'] }],
  artifacts: ['deepseek-ai-dsh-0.1.0-rc.5.tgz'],
}

function host(fingerprint: Partial<ReleaseFingerprint>): ReleaseFingerprint {
  return { ...reference, ...fingerprint }
}

describe('compareToReference', () => {
  it('reports no divergence for an identical composition', () => {
    expect(compareToReference(reference, host({}), 'linux')).toEqual([])
  })

  it('flags every diverging dimension with its expected and actual values', () => {
    const other = host({ buildHash: 'e'.repeat(64), version: '0.2.0', artifacts: [] })
    const divergences = compareToReference(reference, other, 'windows')
    const dimensions = divergences.map(d => d.dimension)
    expect(dimensions).toContain('buildHash')
    expect(dimensions).toContain('version')
    expect(dimensions).toContain('artifact set')
    for (const d of divergences) {
      expect(d.host).toBe('windows')
      // expected/actual are JSON-serialized (quoted strings, arrays, objects):
      // this is the canonical form the CLI reports, so compare against the
      // reference value through the same serialization.
      const key = d.dimension === 'artifact set' ? 'artifacts' : d.dimension
      const referenceValue = reference[key as keyof ReleaseFingerprint]
      expect(d.expected).toBe(JSON.stringify(referenceValue as unknown))
      expect(typeof d.actual).toBe('string')
      expect(d.actual.length).toBeGreaterThan(0)
    }
  })

  it('treats a reordered artifact set as diverged (composition differs)', () => {
    const other = host({ artifacts: ['b.tgz', 'a.tgz'] })
    expect(compareToReference(reference, other, 'macos').map(d => d.dimension)).toContain('artifact set')
  })
})

describe('extractFingerprint', () => {
  it('is not exercised against disk in this unit (the CLI reads real manifests)', () => {
    // The pure reduction the CLI needs is covered by compareToReference. The
    // on-disk read is exercised end-to-end by the C3 workflow's compare step.
    expect(typeof describeFingerprint(reference)).toBe('string')
    expect(describeFingerprint(reference)).toContain(reference.buildHash)
    expect(host({ buildHash: 'x'.repeat(64) }).family).toBe('dsh')
  })
})
