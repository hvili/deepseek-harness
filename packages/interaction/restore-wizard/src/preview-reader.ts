/**
 * Standalone read-only preview of a session-snapshot restore. Computes the
 * impact diff (current live store vs snapshot) with the restore-coordinator's
 * `planRestore`, which only reads — it never mutates anything. The host restore
 * wizard mounts this file as an executable under the sandbox's `read-only`
 * confinement so any accidental write in the preview is blocked at the kernel.
 *
 * CLI contract (spawned by the wizard): prints exactly ONE JSON document to
 * stdout and exits:
 *   - verified snapshot  -> `{ "verified": true, "impact": { ... } }`, exit 0
 *   - unverifiable/tampered snapshot -> `{ "verified": false, "impact": null, "mismatch": "<reason>" }`, exit 0
 *   - unexpected failure -> nothing on stdout, message on stderr, non-zero exit
 *
 * The importable surface (`readPreview`, `parsePreviewArgs`) is shared by the
 * wizard tests so the JSON contract is exercised without spawning node.
 * @module @deepseek-ai/dsh-restore-wizard/preview-reader
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  planRestore,
  RestoreNotVerifiableError,
  type RestoreImpact,
} from '@deepseek-ai/dsh-restore-coordinator'

/** Resolved preview inputs, as the wizard passes them over argv. */
export interface PreviewArgs {
  /** The snapshot directory to restore from (contains `manifest.json`). */
  readonly backupDir: string
  /** The live store to diff against — read-only here, never written. */
  readonly restoreRoot: string
  /** Backups root recorded for the rollback that the later run step creates. */
  readonly rollbackRoot: string
  /** Session-log format version stamped on the (future) rollback snapshot. */
  readonly sessionFormatVersion: number
}

/** Preview result either verified (with impact) or refused on integrity failure. */
export interface RestorePlanPreview {
  /** Whether the snapshot verified AND the impact could be computed. */
  readonly verified: boolean
  /** The impact diff when `verified`; `null` when the snapshot was refused. */
  readonly impact: RestoreImpact | null
  /** Human-readable failure reason when `verified` is `false`. */
  readonly mismatch?: string
}

/**
 * Parse the preview CLI argv into {@link PreviewArgs}.
 * @param argv - the CLI argument vector (flags with values).
 * @returns the parsed preview arguments.
 */
export function parsePreviewArgs(argv: readonly string[]): PreviewArgs {
  const read = (flag: string): string => {
    const index = argv.indexOf(flag)
    if (index === -1) throw new Error(`missing required flag ${flag}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for required flag ${flag}`)
    }
    return value
  }
  return {
    backupDir: read('--backup-dir'),
    restoreRoot: read('--restore-root'),
    rollbackRoot: read('--rollback-root'),
    sessionFormatVersion: Number(read('--session-format-version')),
  }
}

/**
 * Compute the read-only preview for the given args. A snapshot that fails
 * integrity verification is a legitimate preview OUTCOME (`verified: false`),
 * not an exception; an unexpected error (bad path, I/O) propagates.
 * @param args - the parsed preview arguments.
 * @returns the read-only restore plan preview (verified or refused).
 */
export async function readPreview(args: PreviewArgs): Promise<RestorePlanPreview> {
  try {
    const { impact } = await planRestore({
      backupDir: args.backupDir,
      restoreRoot: args.restoreRoot,
      rollbackRoot: args.rollbackRoot,
      sessionFormatVersion: args.sessionFormatVersion,
    })
    return { verified: true, impact }
  } catch (error: unknown) {
    if (error instanceof RestoreNotVerifiableError) {
      return { verified: false, impact: null, mismatch: error.message }
    }
    throw error
  }
}

/** The real backing source when this file executes as the main script. */
function isMainRun(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainRun()) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

/**
 * CLI entry invoked by the host wizard (usually sandbox-confined read-only).
 * @param previewCliArgs - the raw CLI argument vector.
 * @returns resolves after the preview JSON is written to stdout.
 */
export async function main(previewCliArgs: readonly string[]): Promise<void> {
  const args = parsePreviewArgs(previewCliArgs)
  const preview = await readPreview(args)
  process.stdout.write(JSON.stringify(preview))
}
