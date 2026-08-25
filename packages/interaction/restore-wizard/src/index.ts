/**
 * Host-layer restore wizard that closes the restore loop for real: previews a
 * session-snapshot restore under the sandbox's `read-only` confinement (the
 * standalone `preview-reader` entry mounted as an executable), then before any
 * mutation asks the real `ctx.approval` user-approval seam, and finally runs the
 * transactional restore via the restore-coordinator.
 *
 * The wizard is split into pure, seam-injected functions ({@link previewRestore},
 * {@link restoreWithApproval}) and a Cordis service that wires the REAL
 * `ctx.sandbox` + `ctx.approval` seams into them. Tests inject fake seams to
 * exercise the full select→verify→preview→approve→restore→verify loop without
 * a live sandbox backend or a composed answerer.
 * @module @deepseek-ai/dsh-restore-wizard
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import '@deepseek-ai/dsh-sandbox'
import '@deepseek-ai/dsh-user-approval'
import {
  runRestore,
  RestoreNotVerifiableError,
  type RestoreDecision,
  type RestoreImpact,
} from '@deepseek-ai/dsh-restore-coordinator'
import { listBackups, type BackupSummary } from '@deepseek-ai/dsh-session-backup'
import type { RestorePlanPreview } from './preview-reader.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    restoreWizard: RestoreWizardService
  }
}

/** The executable the wizard mounts: node running the preview-reader entry. */
export interface PreviewCommandSpec {
  /** The node binary, e.g. `node`. */
  readonly nodeCommand: string
  /** Absolute path to the built preview-reader entry (`lib/preview-reader.js`). */
  readonly previewCommand: string
}

/** Options shared by the wizard's preview and restore steps. */
export interface RestoreWizardRunOptions {
  /** The snapshot directory to restore from (contains `manifest.json`). */
  readonly backupDir: string
  /** The live store to restore into (created if absent). */
  readonly restoreRoot: string
  /** Backups root where the pre-restore rollback snapshot is recorded. */
  readonly rollbackRoot: string
  /** Session-log format version stamped on the rollback snapshot. */
  readonly sessionFormatVersion: number
  /** Harness version stamped on the rollback snapshot. */
  readonly harnessVersion?: string
  /** Prune current-target files not in the snapshot (exact restore). */
  readonly pruneOrphans?: boolean
  /**
   * The agent on whose behalf the real approval is requested (routes the
   * question and receives the audit events on its session log).
   */
  readonly agent: Agent
  /** Why the restore is being requested — shown to the approving user. */
  readonly reason?: string
  /** Aborting withdraws the pending approval (`cancelled`). */
  readonly signal?: AbortSignal
}

/** The sandbox boundary the preview runs inside. */
export interface PreviewSeam {
  /** Wrap argv so it executes confined; the caller spawns the returned argv. */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
  /** Spawn argv and resolve its stdout (the preview JSON document). */
  spawn(argv: readonly string[]): Promise<string>
}

/** Asks the operator whether to restore, given the verified impact. */
export type RestoreApproval = (
  impact: RestoreImpact,
  reason: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<boolean>

/**
 * Build the argv that asks the preview-reader CLI for the read-only impact.
 * The wizard confines this exact argv before spawning it.
 * @param cmd - the confined preview command specification.
 * @param options - wizard run options (backup/restore/rollback roots and session format version).
 * @returns the argv handed to the preview-reader CLI.
 */
export function previewArgv(
  cmd: PreviewCommandSpec,
  options: RestoreWizardRunOptions,
): string[] {
  return [
    cmd.nodeCommand,
    cmd.previewCommand,
    '--backup-dir', options.backupDir,
    '--restore-root', options.restoreRoot,
    '--rollback-root', options.rollbackRoot,
    '--session-format-version', String(options.sessionFormatVersion),
  ]
}

/**
 * Preview a restore's impact under the sandbox's `read-only` confinement: run
 * the standalone preview-reader as a confined subprocess and return its JSON
 * verdict. The preview never mutates the live store; the sandbox enforces that
 * even if the subprocess misbehaved.
 * @param seam - the sandbox seam that confines and spawns the preview subprocess.
 * @param cmd - the confined preview command specification.
 * @param options - wizard run options.
 * @returns the parsed read-only restore plan preview.
 */
export async function previewRestore(
  seam: PreviewSeam,
  cmd: PreviewCommandSpec,
  options: RestoreWizardRunOptions,
): Promise<RestorePlanPreview> {
  const confined = seam.confine(previewArgv(cmd, options), {
    mode: 'read-only',
    workspaceRoot: options.restoreRoot,
  })
  const stdout = await seam.spawn(confined.argv)
  return JSON.parse(stdout) as RestorePlanPreview
}

/**
 * Full wizard decision: preview under the read-only sandbox, then (when the
 * snapshot verifies) ask the real approval seam with the impact as evidence,
 * then run the transactional restore. A declined approval — or an approval
 * that fails closed — yields `{ outcome: 'declined' }` with nothing touched.
 * @throws {@link RestoreNotVerifiableError} when the snapshot refused preview
 *   verification (an integrity failure is NOT a user decision).
 * @param seam - the sandbox seam that confines and spawns the preview subprocess.
 * @param cmd - the confined preview command specification.
 * @param approve - the operator approval callback asked with the verified impact.
 * @param options - wizard run options.
 * @returns the final restore decision.
 */
export async function restoreWithApproval(
  seam: PreviewSeam,
  cmd: PreviewCommandSpec,
  approve: RestoreApproval,
  options: RestoreWizardRunOptions,
): Promise<RestoreDecision> {
  const preview = await previewRestore(seam, cmd, options)
  if (!preview.verified || preview.impact === null) {
    throw new RestoreNotVerifiableError(preview.mismatch ? [preview.mismatch] : ['snapshot not verifiable'])
  }
  const allowed = await approve(preview.impact, options.reason, options.signal)
  if (!allowed) return { outcome: 'declined' }
  return runRestore({
    backupDir: options.backupDir,
    restoreRoot: options.restoreRoot,
    rollbackRoot: options.rollbackRoot,
    sessionFormatVersion: options.sessionFormatVersion,
    ...(options.harnessVersion !== undefined ? { harnessVersion: options.harnessVersion } : {}),
    ...(options.pruneOrphans !== undefined ? { pruneOrphans: options.pruneOrphans } : {}),
    // The user already approved this exact impact above; do not ask again.
    approve: () => Promise.resolve(true),
  })
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface RestoreWizardConfig {
  /** Absolute path to the built preview-reader entry the sandbox mounts. */
  readonly previewCommand: string
  /** Node binary used to spawn the preview-reader; defaults to `node`. */
  readonly nodeCommand?: string
}

/**
 * Cordis service exposing the real wizard over `ctx.sandbox` (read-only preview)
 * and `ctx.approval` (operator confirmation before mutation).
 */
export class RestoreWizardService extends Service {
  static Config: z<RestoreWizardConfig> = z.object({
    previewCommand: z.string(),
    nodeCommand: z.string().default('node'),
  })

  /**
   * The wired preview seam: `confine` delegates to the real `ctx.sandbox`, and
   * `spawn` executes the confined argv. A data property (not a getter) so tests
   * can substitute a fake seam while exercising the approval wiring above it.
   */
  readonly seam: PreviewSeam

  constructor(ctx: Context, public config: RestoreWizardConfig) {
    super(ctx, 'restoreWizard')
    this.seam = {
      confine: (argv, policy) => ctx.sandbox.confine(argv, policy),
      spawn: async (argv) => {
        const executable = argv[0]
        if (executable === undefined) throw new Error('restore preview command is empty')
        const result = await promisify(execFile)(executable, argv.slice(1))
        /* v8 ignore next -- promisified execFile without an encoding override
         * returns a string; Buffer remains for older Node typings/runtimes. */
        return Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : result.stdout
      },
    }
  }

  /** The executable the sandbox mounts to preview the restore. */
  private get command(): PreviewCommandSpec {
    return {
      nodeCommand: this.config.nodeCommand ?? 'node',
      previewCommand: this.config.previewCommand,
    }
  }

  /**
   * List stored backups newest-first, for the wizard's select step.
   * @param backupRoot - directory holding the backup set.
   * @returns the backup summaries, newest first.
   */
  list(backupRoot: string): Promise<BackupSummary[]> {
    return listBackups(backupRoot)
  }

  /**
   * Preview under read-only sandbox confinement (no mutation, no approval).
   * @param options - wizard run options.
   * @returns the read-only restore plan preview.
   */
  preview(options: RestoreWizardRunOptions): Promise<RestorePlanPreview> {
    return previewRestore(this.seam, this.command, options)
  }

  /**
   * Preview → ask `ctx.approval` → transactionally restore (full loop).
   * @param options - wizard run options.
   * @returns the final restore decision.
   */
  restore(options: RestoreWizardRunOptions): Promise<RestoreDecision> {
    const ctx = this.ctx
    return restoreWithApproval(
      this.seam,
      this.command,
      async (_impact, reason, signal) => {
        const outcome = await ctx.approval.request({
          agent: options.agent,
          toolName: 'restore_wizard',
          ...(reason !== undefined ? { reason } : {}),
          ...(signal !== undefined ? { signal } : {}),
        })
        return outcome === 'allowed-once'
      },
      options,
    )
  }
}

export default RestoreWizardService
