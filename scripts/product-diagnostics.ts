import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PatchEntry {
  commit: string
  classification: string
}

interface PatchAudit {
  schemaVersion: number
  productBaseline: string
  officialBase: string
  nonMergeCommitCount: number
  entries: PatchEntry[]
}

export interface ProductDiagnostics {
  dshVersion: string
  branch: string
  productCommit: string
  officialCommit: string
  enhancementCommit: string
  codexRuntimeVersion: string
  patchCounts: Record<string, number>
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

export function validatePatchAudit(value: unknown): PatchAudit {
  if (typeof value !== 'object' || value === null) throw new Error('patch audit must be an object')
  const audit = value as Partial<PatchAudit>
  if (audit.schemaVersion !== 1) throw new Error('patch audit schemaVersion must be 1')
  requireString(audit.productBaseline, 'patch audit productBaseline')
  requireString(audit.officialBase, 'patch audit officialBase')
  if (typeof audit.nonMergeCommitCount !== 'number'
    || !Number.isInteger(audit.nonMergeCommitCount)
    || audit.nonMergeCommitCount < 0) {
    throw new Error('patch audit nonMergeCommitCount must be a non-negative integer')
  }
  if (!Array.isArray(audit.entries)) throw new Error('patch audit entries must be an array')
  const seen = new Set<string>()
  for (const entry of audit.entries) {
    const commit = requireString(entry.commit, 'patch entry commit')
    requireString(entry.classification, `patch entry ${commit} classification`)
    if (seen.has(commit)) throw new Error(`duplicate patch entry ${commit}`)
    seen.add(commit)
  }
  if (audit.entries.length !== audit.nonMergeCommitCount) {
    throw new Error(`patch audit count ${audit.nonMergeCommitCount} does not match ${audit.entries.length} entries`)
  }
  return audit as PatchAudit
}

export function collectDiagnostics(repositoryRoot: string, enhancementRoot: string): ProductDiagnostics {
  const rootManifest = readJson(resolve(repositoryRoot, 'package.json'))
  const providerManifest = readJson(resolve(repositoryRoot, 'packages', 'subagent', 'subagent-codex', 'package.json'))
  const dependencies = providerManifest.dependencies as Record<string, unknown> | undefined
  if (dependencies === undefined) throw new Error('Codex provider dependencies are missing')
  const audit = validatePatchAudit(readJson(resolve(repositoryRoot, 'product', 'core-patches.json')))
  const patchCounts: Record<string, number> = {}
  for (const entry of audit.entries) patchCounts[entry.classification] = (patchCounts[entry.classification] ?? 0) + 1
  return {
    dshVersion: requireString(rootManifest.version, 'DSH version'),
    branch: git(repositoryRoot, ['branch', '--show-current']),
    productCommit: git(repositoryRoot, ['rev-parse', 'HEAD']),
    officialCommit: git(repositoryRoot, ['merge-base', 'refs/remotes/origin/master', 'HEAD']),
    enhancementCommit: git(enhancementRoot, ['rev-parse', 'HEAD']),
    codexRuntimeVersion: requireString(dependencies['@openai/codex'], 'Codex runtime version'),
    patchCounts,
  }
}

export function verifyProductState(repositoryRoot: string, enhancementRoot: string): ProductDiagnostics {
  const diagnostics = collectDiagnostics(repositoryRoot, enhancementRoot)
  const audit = validatePatchAudit(readJson(resolve(repositoryRoot, 'product', 'core-patches.json')))
  if (!/^(?:product\/main|sync\/[^/]+|feature\/[^/]+)$/u.test(diagnostics.branch)) {
    throw new Error(`branch ${diagnostics.branch} is outside the product branch policy`)
  }
  const baselineTarget = git(repositoryRoot, ['rev-list', '-n', '1', 'dsh-enhanced-baseline-2026-08-25'])
  if (baselineTarget !== audit.productBaseline) throw new Error('recoverable baseline tag does not match the patch audit')
  if (diagnostics.officialCommit !== audit.officialBase) throw new Error('official merge base changed without updating the patch audit')
  const audited = new Set(audit.entries.map(entry => entry.commit))
  const actual = git(repositoryRoot, ['rev-list', '--no-merges', 'origin/master..dsh-enhanced-baseline-2026-08-25'])
    .split(/\r?\n/u).filter(Boolean)
  if (actual.length !== audited.size || actual.some(commit => !audited.has(commit))) {
    throw new Error('patch audit does not cover the complete initial downstream range')
  }
  if (git(enhancementRoot, ['status', '--porcelain']) !== '') throw new Error('enhancement repository has uncommitted changes')
  const origin = git(repositoryRoot, ['remote', 'get-url', 'origin'])
  if (origin !== 'https://github.com/deepseek-ai/deepseek-harness.git') throw new Error('origin must remain the official DSH repository')
  return diagnostics
}

function main(): void {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const enhancementRoot = resolve(repositoryRoot, '..', 'plugins')
  const diagnostics = process.argv.includes('--verify')
    ? verifyProductState(repositoryRoot, enhancementRoot)
    : collectDiagnostics(repositoryRoot, enhancementRoot)
  console.log(JSON.stringify(diagnostics, null, 2))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
