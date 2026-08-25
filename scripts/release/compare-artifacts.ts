/**
 * Cross-platform artifact comparison: the reproducible-build E2E guard.
 *
 * P0 stage C says a clean checkout on Windows, Linux, and macOS must produce a
 * release with the SAME composition. A tarball cannot be byte-compared across
 * hosts lazily, and a git commit hashes source — not the packed artifact set —
 * so the comparison runs over each host's stage manifest and asserts every
 * dimension that defines a release agrees:
 *
 *   - the deterministic buildHash (the release identity stamp),
 *   - the family, version line, and commit the pack ran from,
 *   - the within-family plugin graph and the SBOM,
 *   - the packed artifact set (name + version, in upload order).
 *
 * A host whose checkout packed different content diverges here long before a
 * user observes it — the release half of the "no mixed versions" exit gate.
 * `artifacts` integrity bytes are deliberately not compared: build output is
 * reproducible in composition, not necessarily byte-for-byte across hosts, and
 * byte-level drift is caught locally by `verifyReleaseManifest` against the
 * recording host's own pack.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry } from './process.ts'
import { RELEASE_MANIFEST_FILE, type PluginGraphEdge, type ReleaseComponent } from './manifest.ts'

/** The composition-relevant view of one host's stage manifest. */
export interface ReleaseFingerprint {
  /** The deterministic release identity stamp. */
  readonly buildHash: string
  /** The release family id. */
  readonly family: string
  /** The version line (a joined string for a multi-version family). */
  readonly version: string
  /** The short commit the pack ran from. */
  readonly commit: string
  /** Within-family plugin dependency edges, in release order. */
  readonly pluginGraph: readonly PluginGraphEdge[]
  /** The software bill of materials, in release order. */
  readonly sbom: readonly ReleaseComponent[]
  /** Packed artifact names, in upload order. */
  readonly artifacts: readonly string[]
}

/** Read a host's stage manifest and reduce it to its composition fingerprint. */
export function extractFingerprint(directory: string): ReleaseFingerprint {
  const raw = JSON.parse(readFileSync(join(resolve(directory), RELEASE_MANIFEST_FILE), 'utf8')) as {
    buildHash: string
    family: string
    version: string
    commit: string
    pluginGraph: readonly PluginGraphEdge[]
    sbom: readonly ReleaseComponent[]
    artifacts: readonly { name: string }[]
  }
  return {
    buildHash: raw.buildHash,
    family: raw.family,
    version: raw.version,
    commit: raw.commit,
    pluginGraph: raw.pluginGraph,
    sbom: raw.sbom,
    artifacts: raw.artifacts.map(artifact => artifact.name),
  }
}

/** A divergent dimension between two host fingerprints, for the error report. */
export interface FingerprintDivergence {
  /** The dimension that disagreed. */
  readonly dimension: string
  /** The host whose value differed (its `--from` argument). */
  readonly host: string
  /** The reference host's value. */
  readonly expected: string
  /** The diverging host's value. */
  readonly actual: string
}

function fingerprintRow(label: string, value: unknown): string {
  return `${label}: ${JSON.stringify(value)}`
}

/**
 * Compare one host's fingerprint against a reference. Returns a human-readable
 * divergence list; an empty list means the two releases have identical
 * composition.
 * @param reference - the first host's fingerprint.
 * @param other - the compared host's fingerprint, with its label for errors.
 * @param otherLabel - the compared host's `--from` label.
 * @returns The divergences, or an empty array when compositions match.
 */
export function compareToReference(reference: ReleaseFingerprint, other: ReleaseFingerprint, otherLabel: string): FingerprintDivergence[] {
  const divergences: FingerprintDivergence[] = []
  const check = (dimension: string, expected: unknown, actual: unknown): void => {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      divergences.push({ dimension, host: otherLabel, expected: JSON.stringify(expected), actual: JSON.stringify(actual) })
    }
  }
  check('buildHash', reference.buildHash, other.buildHash)
  check('family', reference.family, other.family)
  check('version', reference.version, other.version)
  check('commit', reference.commit, other.commit)
  check('pluginGraph', reference.pluginGraph, other.pluginGraph)
  check('sbom', reference.sbom, other.sbom)
  check('artifact set', reference.artifacts, other.artifacts)
  return divergences
}

/** A readable summary line for one fingerprint. */
export function describeFingerprint(fingerprint: ReleaseFingerprint): string {
  return [
    fingerprintRow('family', fingerprint.family),
    fingerprintRow('version', fingerprint.version),
    fingerprintRow('commit', fingerprint.commit),
    fingerprintRow('buildHash', fingerprint.buildHash),
    fingerprintRow('pluginGraph edges', fingerprint.pluginGraph.length),
    fingerprintRow('sbom components', fingerprint.sbom.length),
    fingerprintRow('artifacts', fingerprint.artifacts.length),
  ].join('\n')
}

/** Compare every host's manifest, failing on any composition divergence. */
function main(): void {
  const { values } = parseArgs({
    options: { from: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  const hosts = values.from
  if (hosts === undefined || hosts.length < 2) {
    throw new Error('usage: compare-artifacts.ts --from <packed directory> --from <packed directory> [--from ...]')
  }

  const firstHost = hosts[0]
  if (firstHost === undefined) throw new Error('compare-artifacts requires a reference host')
  const referenceDir = resolve(firstHost)
  const reference = extractFingerprint(referenceDir)
  console.log(`release compare-artifacts: reference ${referenceDir}\n${describeFingerprint(reference)}`)

  let compared = 0
  for (const directory of hosts.slice(1)) {
    const other = extractFingerprint(directory)
    const divergences = compareToReference(reference, other, directory)
    if (divergences.length > 0) {
      const detail = divergences.map(divergence =>
        `  ${divergence.host}\n${fingerprintRow('expected', divergence.expected)} (${divergence.dimension})\n${fingerprintRow('actual  ', divergence.actual)}`)
        .join('\n')
      throw new Error(`release artifacts diverged across hosts:\n${detail}`)
    }
    console.log(`release compare-artifacts: ${directory} matches reference (composition identical)`)
    compared += 1
  }
  console.log(`release compare-artifacts: ${String(compared)} host(s) match the reference`)
}

if (isEntry(import.meta.url)) main()
