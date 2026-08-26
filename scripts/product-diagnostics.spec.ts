import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectPatchCoverage, validatePatchAudit, validatePatchCoverage } from './product-diagnostics.ts'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function commit(root: string, paths: string[], message: string): string {
  git(root, ['add', '--', ...paths])
  git(root, ['commit', '-m', message])
  return git(root, ['rev-parse', 'HEAD'])
}

function fixture(): { root: string; productBaseline: string; runtimeBaseline: string; buildCommit: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-diagnostics-'))
  fixtureRoots.push(root)
  git(root, ['init', '--initial-branch=product/main'])
  git(root, ['config', 'user.email', 'product-diagnostics@example.com'])
  git(root, ['config', 'user.name', 'Product Diagnostics Tests'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  write(root, 'seed.txt', 'seed\n')
  write(root, 'package.json', '{"name":"fixture"}\n')
  const productBaseline = commit(root, ['seed.txt', 'package.json'], 'seed product baseline')

  write(root, 'product/core-patches.json', '{}\n')
  write(root, 'scripts/product-diagnostics.ts', 'export {}\n')
  commit(root, ['product/core-patches.json', 'scripts/product-diagnostics.ts'], 'governance metadata')

  write(root, 'packages/example/src/index.ts', 'export const runtime = true\n')
  const runtimeBaseline = commit(root, ['packages/example/src/index.ts'], 'runtime patch')
  write(root, 'packages/example/README.md', '# docs\n')
  commit(root, ['packages/example/README.md'], 'documentation only')
  write(root, 'tsconfig.example.json', '{}\n')
  const buildCommit = commit(root, ['tsconfig.example.json'], 'build patch')
  write(root, 'product/core-patches.json', '{"governance":true}\n')
  commit(root, ['product/core-patches.json'], 'later governance metadata')
  return { root, productBaseline, runtimeBaseline, buildCommit }
}

function audit(entries: string[], initialRangeCommitCount = 1) {
  return validatePatchAudit({
    schemaVersion: 1,
    productBaseline: 'product-baseline',
    officialBase: 'official-base',
    auditRange: 'product-baseline..product-baseline',
    runtimeBaseline: 'runtime-baseline',
    initialRangeCommitCount,
    nonMergeCommitCount: entries.length,
    entries: entries.map(commit => ({ commit, classification: 'minimal-core-patch' })),
  })
}

describe('product diagnostics', () => {
  it('accepts a complete unique patch audit', () => {
    expect(validatePatchAudit({
      schemaVersion: 1,
      productBaseline: 'a',
      officialBase: 'b',
      auditRange: 'a..b',
      runtimeBaseline: 'd',
      initialRangeCommitCount: 1,
      nonMergeCommitCount: 1,
      entries: [{ commit: 'c', classification: 'minimal-core-patch' }],
    }).entries).toHaveLength(1)
  })

  it('rejects duplicate and count-drifted entries', () => {
    expect(() => validatePatchAudit({
      schemaVersion: 1,
      productBaseline: 'a',
      officialBase: 'b',
      auditRange: 'a..b',
      runtimeBaseline: 'd',
      initialRangeCommitCount: 2,
      nonMergeCommitCount: 2,
      entries: [
        { commit: 'c', classification: 'minimal-core-patch' },
        { commit: 'c', classification: 'upstream-candidate' },
      ],
    })).toThrow('duplicate patch entry c')
  })

  it('derives runtime/build commits while ignoring documentation and governance-only commits', { timeout: 20_000 }, () => {
    const { root, productBaseline, runtimeBaseline, buildCommit } = fixture()
    const coverage = collectPatchCoverage(root, {
      schemaVersion: 1,
      productBaseline,
      officialBase: 'official-base',
      auditRange: `${productBaseline}..${productBaseline}`,
      runtimeBaseline,
      initialRangeCommitCount: 0,
      nonMergeCommitCount: 0,
      entries: [],
    })

    expect(coverage.initialCommits).toEqual([])
    expect(coverage.runtimeBuildCommits).toEqual([runtimeBaseline, buildCommit])
    expect(coverage.governanceOnlyCommits).toHaveLength(2)
    expect(coverage.postBaselineCommits).toHaveLength(5)
  })

  it('does not let a manifest change hide behind governance metadata', { timeout: 20_000 }, () => {
    const { root, productBaseline, runtimeBaseline } = fixture()
    write(root, 'product/core-patches.json', '{"governance":"updated"}\n')
    write(root, 'package.json', '{"name":"fixture","dependencies":{"runtime":"1.0.0"}}\n')
    const manifestCommit = commit(root, ['product/core-patches.json', 'package.json'], 'mixed manifest and governance change')
    const coverage = collectPatchCoverage(root, {
      schemaVersion: 1,
      productBaseline,
      officialBase: 'official-base',
      auditRange: `${productBaseline}..${productBaseline}`,
      runtimeBaseline,
      initialRangeCommitCount: 0,
      nonMergeCommitCount: 0,
      entries: [],
    })

    expect(coverage.runtimeBuildCommits).toContain(manifestCommit)
    expect(coverage.governanceOnlyCommits).not.toContain(manifestCommit)
  })

  it('rejects a missing initial audit entry', () => {
    expect(() => {
      validatePatchCoverage(
        audit(['runtime'], 1),
        ['initial'],
        ['runtime'],
      )
    }).toThrow('missing initial commits: initial')
  })

  it('rejects an unaudited runtime/build commit', () => {
    expect(() => {
      validatePatchCoverage(
        audit(['initial'], 1),
        ['initial'],
        ['runtime'],
      )
    }).toThrow('unaudited runtime/build commits: runtime')
  })

  it('rejects deleted and governance-only entries', () => {
    expect(() => {
      validatePatchCoverage(
        audit(['initial', 'deleted'], 1),
        ['initial'],
        [],
      )
    }).toThrow('deleted or out-of-range entries: deleted')
    expect(() => {
      validatePatchCoverage(
        audit(['initial', 'governance'], 1),
        ['initial'],
        [],
        ['governance'],
      )
    }).toThrow('governance-only commits: governance')
  })
})
