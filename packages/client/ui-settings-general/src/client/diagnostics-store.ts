/**
 * Diagnostics section slot store: mirrors the connected generation's host
 * description facts (the build-manifest identity) plus the observable
 * capability assembly snapshot. The apply-world host-description and assembly
 * subscriptions are the only writers; the section component reads via
 * props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { CapabilitySeam } from '@deepseek-ai/dsh-client-runtime/client'

/** Read-only diagnostic facts surfaced in the Diagnostics section. */
export interface DiagnosticsState {
  /** 'idle' until the first connected handshake publishes a description. */
  status: 'idle' | 'ready'
  /** The host app's real CLI version (e.g. 0.1.0-rc.5). */
  version: string
  /** Short git commit this build came from; absent on unstamped artifacts. */
  commit: string | undefined
  /** Release-pipeline build hash; absent when the build is unstamped. */
  buildHash: string | undefined
  /** Session-log on-disk format version; absent when the build is unstamped. */
  schemaVersion: number | undefined
  /** Every live slot seam of the client assembly, tree-ordered. */
  seams: readonly CapabilitySeam[]
  /** Total seam count. */
  seamCount: number
  /** Total occupant count across all seams. */
  occupantCount: number
}

/** Declared action shape giving the exported factory a stable return type. */
type DiagnosticsActions = {
  sync: (draft: DiagnosticsState, next: DiagnosticsState) => void
}

/**
 * Declares the Diagnostics state and write surface.
 * @returns the store handle.
 */
export function createDiagnosticsStore(): EngineStoreHandle<DiagnosticsState, DiagnosticsActions> {
  return defineStore({
    init: (): DiagnosticsState => ({
      status: 'idle',
      version: '',
      commit: undefined,
      buildHash: undefined,
      schemaVersion: undefined,
      seams: [],
      seamCount: 0,
      occupantCount: 0,
    }),
    actions: {
      sync: (d, next) => {
        d.status = next.status
        d.version = next.version
        d.commit = next.commit
        d.buildHash = next.buildHash
        d.schemaVersion = next.schemaVersion
        d.seams = next.seams
        d.seamCount = next.seamCount
        d.occupantCount = next.occupantCount
      },
    },
  })
}
