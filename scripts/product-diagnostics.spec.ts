import { describe, expect, it } from 'vitest'
import { validatePatchAudit } from './product-diagnostics.ts'

describe('product diagnostics', () => {
  it('accepts a complete unique patch audit', () => {
    expect(validatePatchAudit({
      schemaVersion: 1,
      productBaseline: 'a',
      officialBase: 'b',
      nonMergeCommitCount: 1,
      entries: [{ commit: 'c', classification: 'minimal-core-patch' }],
    }).entries).toHaveLength(1)
  })

  it('rejects duplicate and count-drifted entries', () => {
    expect(() => validatePatchAudit({
      schemaVersion: 1,
      productBaseline: 'a',
      officialBase: 'b',
      nonMergeCommitCount: 2,
      entries: [
        { commit: 'c', classification: 'minimal-core-patch' },
        { commit: 'c', classification: 'upstream-candidate' },
      ],
    })).toThrow('duplicate patch entry c')
  })
})
