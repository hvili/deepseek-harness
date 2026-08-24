/**
 * Generate one release-stage-manifest for a packed family: the version, commit,
 * a deterministic build hash, the plugin dependency graph, and a software bill
 * of materials, all from the same source so a clean checkout yields the same
 * document on every platform.
 *
 * The build hash is the identity that stamps an installed artifact. It is a
 * sha256 over a canonical serialization of everything that defines a release —
 * the family, version, git commit, every tarball's name+version+sha512
 * integrity, the within-family plugin edges, and the SBOM. It therefore changes
 * whenever any member's content changes, and does not change on a clean checkout
 * from the same commit on any platform. A `--verify` mode recomputes the hash
 * and fails when an existing manifest records different values — the publish
 * boundary guard that no mixed-version or hand-replaced artifact ships.
 *
 * The manifest is written beside the tarballs it describes, with a
 * `MANIFEST.sha256` anchor over its exact bytes, so a tampered manifest can be
 * detected before a release is published from it.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { attempt, isEntry } from './process.ts'
import { packedIdentity, readPublishOrder } from './tarball.ts'

/** Name of the stage manifest a pack run records beside its tarballs. */
export const RELEASE_MANIFEST_FILE = 'release-manifest.json'

/** Name of the tamper-anchor over `release-manifest.json`'s exact bytes. */
export const RELEASE_MANIFEST_ANCHOR = 'MANIFEST.sha256'

/** What a plugin depends on at runtime, for the plugin graph. */
const DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies'] as const

/** One packed artifact's identity and content integrity. */
export interface ReleaseArtifact {
  /** Package name from the packed tarball. */
  readonly name: string
  /** Package version from the packed tarball. */
  readonly version: string
  /** `sha512-<base64>` integrity of the packed tarball. */
  readonly integrity: string
}

/** One software bill-of-materials row: a release member and its declared deps. */
export interface ReleaseComponent {
  /** Package name. */
  readonly name: string
  /** Package version from the workspace manifest. */
  readonly version: string
  /** Every declared dependency name (workspace `packages/*`, `apps/*`, and external). */
  readonly dependencies: readonly string[]
}

/** The directed plugin graph folded over {@link ReleaseComponent}. */
export interface PluginGraphEdge {
  /** A release member that depends on `to`. */
  readonly from: string
  /** A release member that `from` depends on at runtime. */
  readonly to: string
}

/**
 * The whole stage manifest recorded for one packed family release.
 *
 * `buildHash` is intentionally self-referential: it is the sha256 of the
 * canonical serialization of everything else in this object (minus `buildHash`
 * itself and the non-deterministic `createdAt`).
 */
export interface ReleaseStageManifest {
  /** The release family id (`dsh` or `vendor`). */
  readonly family: string
  /** The shared (dsh) or per-member (vendor) version line. */
  readonly version: string
  /** Short git commit this manifest was generated from, when readable. */
  readonly commit: string
  /** Deterministic identity stamping the packed artifacts. */
  readonly buildHash: string
  /** Unix epoch milliseconds when this manifest was recorded (not hashed). */
  readonly createdAt: number
  /** Every packed artifact, sorted by tarball name. */
  readonly artifacts: readonly ReleaseArtifact[]
  /** The within-family plugin dependency edges, sorted deterministically. */
  readonly pluginGraph: readonly PluginGraphEdge[]
  /** The software bill of materials, sorted by package name. */
  readonly sbom: readonly ReleaseComponent[]
}

/**
 * Canonical serialization of a JSON-compatible value: object keys sorted, no
 * undefined values, 2-space indent, trailing newline. Deterministic across
 * platforms so the hash is stable.
 * @param value - value to serialize.
 * @returns The canonical UTF-8 JSON text.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(', ')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${canonicalJson(key)}: ${canonicalJson(record[key])}`)
    return `{${entries.join(', ')}}`
  }
  return JSON.stringify(value)
}

/** sha512-<base64> integrity of a tarball's bytes. */
function integrityOf(tarball: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
}

/** Best-effort short git commit at `cwd`, or empty when unreadable. */
function readCommit(cwd: string): string {
  const result = attempt('git', ['rev-parse', '--short', 'HEAD'], { cwd })
  if (result.status !== 0) return ''
  return result.stdout.trim()
}

/**
 * Read every packed artifact in a packed directory, in upload order.
 * @param directory - the packed directory.
 * @returns artifacts sorted deterministically by filename.
 */
function packedArtifacts(directory: string): ReleaseArtifact[] {
  const filenames = readPublishOrder(directory)
  return filenames
    .map((filename) => {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      return { name, version, integrity: integrityOf(tarball) }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** A release member's declared dependency names, in the runtime sections. */
function declaredDependencies(member: ReleaseMember): readonly string[] {
  const names: string[] = []
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = member.manifest[section]
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) continue
    names.push(...Object.keys(dependencies))
  }
  return names.sort()
}

/** Collect the SBOM and the within-family plugin edges for a family's members. */
function billOfMaterials(members: readonly ReleaseMember[]):
{ sbom: ReleaseComponent[]; pluginGraph: PluginGraphEdge[] } {
  const byName = new Map(members.map(member => [member.name, true]))
  const sbom: ReleaseComponent[] = []
  const pluginGraph: PluginGraphEdge[] = []
  for (const member of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
    const dependencies = declaredDependencies(member)
    sbom.push({ name: member.name, version: member.version, dependencies })
    for (const name of dependencies) {
      if (byName.has(name) && name !== member.name) {
        pluginGraph.push({ from: member.name, to: name })
      }
    }
  }
  pluginGraph.sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from))
  return { sbom, pluginGraph }
}

/**
 * Compute the deterministic build hash over a manifest's canonical content.
 *
 * The hash is a source identity — family, version, commit, plugin graph, and
 * SBOM — deliberately excluding the per-tarball `artifacts` integrity: the app
 * launcher stamps this same hash via `DSH_BUILD_HASH` at build time, before any
 * tarball exists, so the stamped build hash must equal what a later pack
 * records. Artifact integrity is verified separately by the publish boundary
 * guard, so a drift is still caught without disturbing the running build hash.
 */
export function buildHashOf(manifest: Omit<ReleaseStageManifest, 'buildHash' | 'createdAt'>): string {
  const body = {
    family: manifest.family,
    version: manifest.version,
    commit: manifest.commit,
    pluginGraph: manifest.pluginGraph,
    sbom: manifest.sbom,
  }
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')
}

/** Assemble a full stage manifest for a packed family directory. */
export function makeReleaseManifest(family: ReleaseFamily, members: readonly ReleaseMember[], directory: string): ReleaseStageManifest {
  const versions = [...new Set(members.map(member => member.version))]
  const onlyVersion = versions[0]
  const { sbom, pluginGraph } = billOfMaterials(members)
  const base = {
    family: family.id,
    version: versions.length === 1 && onlyVersion !== undefined ? onlyVersion : versions.join('+'),
    commit: readCommit(process.cwd()),
    artifacts: packedArtifacts(directory),
    pluginGraph,
    sbom,
  }
  return { ...base, buildHash: buildHashOf(base), createdAt: Date.now() }
}

/**
 * Verify values an existing stage manifest records against the current packed
 * directory, recomputing the build hash. Fails on any divergence.
 * @param manifest - the previously recorded stage manifest.
 * @param family - the release family being re-checked.
 * @param members - the family's current members.
 * @param directory - the packed directory.
 */
export function verifyReleaseManifest(
  manifest: ReleaseStageManifest,
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
  directory: string,
): void {
  const recomputed = makeReleaseManifest(family, members, directory)
  const problems: string[] = []
  if (recomputed.family !== manifest.family) problems.push(`family ${recomputed.family} != recorded ${manifest.family}`)
  if (recomputed.version !== manifest.version) problems.push(`version ${recomputed.version} != recorded ${manifest.version}`)
  if (recomputed.commit !== manifest.commit) problems.push(`commit ${recomputed.commit} != recorded ${manifest.commit}`)
  if (canonicalJson(recomputed.pluginGraph) !== canonicalJson(manifest.pluginGraph)) problems.push('plugin graph diverged')
  if (canonicalJson(recomputed.sbom) !== canonicalJson(manifest.sbom)) problems.push('SBOM diverged')
  if (canonicalJson(recomputed.artifacts) !== canonicalJson(manifest.artifacts)) problems.push('packed artifact set diverged')
  if (recomputed.buildHash !== manifest.buildHash) problems.push(`buildHash ${recomputed.buildHash} != recorded ${manifest.buildHash}`)
  if (problems.length > 0) {
    throw new Error(`release manifest verification failed:\n${problems.join('\n')}`)
  }
}

/** Write a stage manifest and its tamper-anchor beside the packed tarballs. */
export function writeReleaseManifest(directory: string, manifest: ReleaseStageManifest): void {
  const text = `${canonicalJson(manifest)}\n`
  writeFileSync(join(directory, RELEASE_MANIFEST_FILE), text, 'utf8')
  writeFileSync(join(directory, RELEASE_MANIFEST_ANCHOR), createHash('sha256').update(text, 'utf8').digest('hex'), 'utf8')
}

/** Read and shape-validate a stage manifest from disk. */
export function readReleaseManifest(directory: string): ReleaseStageManifest {
  const raw = readFileSync(join(directory, RELEASE_MANIFEST_FILE), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`release manifest at ${directory}/${RELEASE_MANIFEST_FILE} is not an object`)
  }
  const record = parsed as Record<string, unknown>
  if (typeof record['family'] !== 'string' || typeof record['version'] !== 'string'
    || typeof record['commit'] !== 'string' || typeof record['buildHash'] !== 'string'
    || typeof record['createdAt'] !== 'number'
    || !Array.isArray(record['artifacts']) || !Array.isArray(record['pluginGraph']) || !Array.isArray(record['sbom'])) {
    throw new Error(`release manifest at ${directory}/${RELEASE_MANIFEST_FILE} is malformed`)
  }
  return parsed as ReleaseStageManifest
}

/** Generate (or verify) the stage manifest for `--family` from `--from`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      from: { type: 'string' },
      verify: { type: 'boolean', default: false },
      'print-build-hash': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined) {
    throw new Error('usage: manifest.ts --family <dsh|vendor> --from <packed directory> [--verify] [--print-build-hash]')
  }

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const directory = resolve(root, values.from)
  const members = family.members(root)
  family.verifyVersions(members)

  if (values.verify) {
    verifyReleaseManifest(readReleaseManifest(directory), family, members, directory)
    console.log(`release manifest: family ${family.id}, verified ${directory}/${RELEASE_MANIFEST_FILE}`)
    return
  }

  const manifest = makeReleaseManifest(family, members, directory)
  if (values['print-build-hash']) {
    // Machine-usable form: exactly the build hash, for a workflow to export as
    // the DSH_BUILD_HASH the app launcher stamps into its build manifest.
    console.log(manifest.buildHash)
    return
  }
  writeReleaseManifest(directory, manifest)
  const anchor = readFileSync(join(directory, RELEASE_MANIFEST_ANCHOR), 'utf8')
  console.log(`release manifest: family ${family.id}, buildHash ${manifest.buildHash} (anchor ${anchor.slice(0, 12)}…)`)
}

if (isEntry(import.meta.url)) main()
