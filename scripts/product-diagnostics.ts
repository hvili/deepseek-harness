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
  auditRange: string
  runtimeBaseline: string
  initialRangeCommitCount: number
  nonMergeCommitCount: number
  entries: PatchEntry[]
}

interface ProductPatchCoverage {
  initialCommits: string[]
  postBaselineCommits: string[]
  runtimeBuildCommits: string[]
  governanceOnlyCommits: string[]
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

const REQUIRED_RUNTIME_BASELINE = 'cf14720d2eb7e5e0d3b330806cece532331c1404'
const REQUIRED_AUDIT_RANGE = 'origin/master..dsh-enhanced-baseline-2026-08-25'
const REQUIRED_INITIAL_RANGE_COMMIT_COUNT = 77
const PRODUCT_DIAGNOSTICS_PATH = /^scripts\/product-diagnostics(?:\.spec)?\.ts$/u
const DOCUMENTATION_PATH = /(?:^|\/)README(?:\.zh)?\.md$|(?:^|\/)README\.i18n\.yaml$|(?:^|\/)docs(?:\/|$)|(?:^|\/)\.i18n\.yaml$/u
const ROOT_BUILD_PATH = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|knip\.json|\.gitmodules)$/u
const TYPESCRIPT_CONFIG_PATH = /^tsconfig(?:\.[^/]+)?\.json$/u
const VITEST_CONFIG_PATH = /^vitest(?:\.[^/]+)?\.ts$/u

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
  requireString(audit.auditRange, 'patch audit auditRange')
  requireString(audit.runtimeBaseline, 'patch audit runtimeBaseline')
  if (typeof audit.initialRangeCommitCount !== 'number'
    || !Number.isInteger(audit.initialRangeCommitCount)
    || audit.initialRangeCommitCount < 0) {
    throw new Error('patch audit initialRangeCommitCount must be a non-negative integer')
  }
  if (typeof audit.nonMergeCommitCount !== 'number'
    || !Number.isInteger(audit.nonMergeCommitCount)
    || audit.nonMergeCommitCount < 0) {
    throw new Error('patch audit nonMergeCommitCount must be a non-negative integer')
  }
  if (!Array.isArray(audit.entries)) throw new Error('patch audit entries must be an array')
  const entries = audit.entries as unknown[]
  const seen = new Set<string>()
  for (const [index, value] of entries.entries()) {
    if (typeof value !== 'object' || value === null) throw new Error(`patch entry ${index + 1} must be an object`)
    const entry = value as Partial<PatchEntry>
    const commit = requireString(entry.commit, 'patch entry commit')
    requireString(entry.classification, `patch entry ${commit} classification`)
    if (seen.has(commit)) throw new Error(`duplicate patch entry ${commit}`)
    seen.add(commit)
  }
  if (entries.length !== audit.nonMergeCommitCount) {
    throw new Error(`patch audit count ${audit.nonMergeCommitCount} does not match ${entries.length} entries`)
  }
  return audit as PatchAudit
}

function changedPathsByCommit(repositoryRoot: string, range: string): Map<string, string[]> {
  const output = git(repositoryRoot, [
    'log',
    '--no-merges',
    '--root',
    '--format=commit:%H',
    '--name-only',
    '--reverse',
    range,
  ])
  const commits = new Map<string, string[]>()
  let currentCommit: string | undefined
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('commit:')) {
      currentCommit = line.slice('commit:'.length)
      commits.set(currentCommit, [])
    } else if (line !== '' && currentCommit !== undefined) {
      commits.get(currentCommit)?.push(line)
    }
  }
  return commits
}

function isGovernancePath(path: string): boolean {
  return path.startsWith('product/')
    || PRODUCT_DIAGNOSTICS_PATH.test(path)
    || path.startsWith('.agents/notes/')
    || DOCUMENTATION_PATH.test(path)
}

function isGovernanceOnlyCommit(paths: readonly string[]): boolean {
  const hasGovernanceMetadata = paths.some(path => path.startsWith('product/') || PRODUCT_DIAGNOSTICS_PATH.test(path))
  return hasGovernanceMetadata && paths.every(path => isGovernancePath(path) || path === 'package.json')
}

function isRuntimeOrBuildPath(path: string): boolean {
  if (isGovernancePath(path)) return false
  if (/^(?:apps|examples|native|packages|plugins|python|vendor)\//u.test(path)) return true
  if (ROOT_BUILD_PATH.test(path) || TYPESCRIPT_CONFIG_PATH.test(path) || VITEST_CONFIG_PATH.test(path)) return true
  if (/^\.github\/(?:workflows|actions)\//u.test(path)) return true
  return path.startsWith('scripts/')
}

/**
 * Resolve the initial range and post-baseline commits that contain runtime or build files.
 * @param repositoryRoot - repository whose commit graph is being audited.
 * @param audit - patch inventory metadata that names the audit ranges.
 * @param headRef - reachable commit at which to stop the post-baseline scan.
 * @returns the actual commit sets used by the product verification gate.
 */
export function collectPatchCoverage(repositoryRoot: string, audit: PatchAudit, headRef = 'HEAD'): ProductPatchCoverage {
  const initial = changedPathsByCommit(repositoryRoot, audit.auditRange)
  const postBaseline = changedPathsByCommit(repositoryRoot, `${audit.productBaseline}..${headRef}`)
  const runtimeBuildCommits: string[] = []
  const governanceOnlyCommits: string[] = []
  for (const [commit, paths] of postBaseline) {
    const governanceOnly = isGovernanceOnlyCommit(paths)
    if (governanceOnly) governanceOnlyCommits.push(commit)
    if (!governanceOnly && paths.some(isRuntimeOrBuildPath)) runtimeBuildCommits.push(commit)
  }
  return {
    initialCommits: [...initial.keys()],
    postBaselineCommits: [...postBaseline.keys()],
    runtimeBuildCommits,
    governanceOnlyCommits,
  }
}

/**
 * Reject an inventory that omits expected commits or retains commits outside the live patch set.
 * @param audit - validated patch inventory.
 * @param initialCommits - non-merge commits resolved from the initial downstream range.
 * @param runtimeBuildCommits - post-baseline commits that change runtime or build files.
 * @param governanceOnlyCommits - metadata-only commits excluded from the patch set.
 */
export function validatePatchCoverage(
  audit: PatchAudit,
  initialCommits: readonly string[],
  runtimeBuildCommits: readonly string[],
  governanceOnlyCommits: readonly string[] = [],
): void {
  if (initialCommits.length !== audit.initialRangeCommitCount) {
    throw new Error(`initial downstream range count ${audit.initialRangeCommitCount} does not match ${initialCommits.length}`)
  }
  const audited = new Set(audit.entries.map(entry => entry.commit))
  const missingInitial = initialCommits.filter(commit => !audited.has(commit))
  if (missingInitial.length > 0) throw new Error(`patch audit is missing initial commits: ${missingInitial.join(', ')}`)
  const missingRuntime = runtimeBuildCommits.filter(commit => !audited.has(commit))
  if (missingRuntime.length > 0) throw new Error(`patch audit has unaudited runtime/build commits: ${missingRuntime.join(', ')}`)
  const governanceEntries = audit.entries
    .map(entry => entry.commit)
    .filter(commit => governanceOnlyCommits.includes(commit))
  if (governanceEntries.length > 0) {
    throw new Error(`patch audit must not record governance-only commits: ${governanceEntries.join(', ')}`)
  }
  const expected = new Set([...initialCommits, ...runtimeBuildCommits])
  const deleted = audit.entries.map(entry => entry.commit).filter(commit => !expected.has(commit))
  if (deleted.length > 0) throw new Error(`patch audit contains deleted or out-of-range entries: ${deleted.join(', ')}`)
}

export function collectDiagnostics(repositoryRoot: string, enhancementRoot: string): ProductDiagnostics {
  const rootManifest = readJson(resolve(repositoryRoot, 'package.json'))
  const runtimeManifest = readJson(resolve(repositoryRoot, 'packages', 'subagent', 'codex-app-server', 'package.json'))
  const dependencies = runtimeManifest.dependencies as Record<string, unknown> | undefined
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
  if (audit.auditRange !== REQUIRED_AUDIT_RANGE) throw new Error(`patch audit auditRange must be ${REQUIRED_AUDIT_RANGE}`)
  if (audit.initialRangeCommitCount !== REQUIRED_INITIAL_RANGE_COMMIT_COUNT) {
    throw new Error(`patch audit initialRangeCommitCount must be ${REQUIRED_INITIAL_RANGE_COMMIT_COUNT}`)
  }
  const runtimeBaseline = audit.runtimeBaseline
  if (runtimeBaseline !== REQUIRED_RUNTIME_BASELINE) {
    throw new Error(`patch audit runtimeBaseline must be ${REQUIRED_RUNTIME_BASELINE}`)
  }
  const coverage = collectPatchCoverage(repositoryRoot, audit)
  if (!coverage.postBaselineCommits.includes(runtimeBaseline)) {
    throw new Error(`runtime baseline ${runtimeBaseline} is not reachable from the product baseline`)
  }
  if (!coverage.runtimeBuildCommits.includes(runtimeBaseline)) {
    throw new Error(`runtime baseline ${runtimeBaseline} must have an independent runtime/build patch entry`)
  }
  validatePatchCoverage(audit, coverage.initialCommits, coverage.runtimeBuildCommits, coverage.governanceOnlyCommits)
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
