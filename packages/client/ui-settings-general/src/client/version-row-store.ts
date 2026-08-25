/**
 * Version row slot store: a mirror of the connected generation's host
 * description facts (version / commit / schema version). The plugin's
 * apply-world host-description subscription is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Read-only host identity facts surfaced in the General section. */
export interface VersionRowState {
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
}

/** Declared action shape giving the exported factory a stable return type. */
type VersionRowActions = {
  sync: (draft: VersionRowState, next: VersionRowState) => void
}

/**
 * Declares the Version row state and write surface.
 * @returns the store handle.
 */
export function createVersionRowStore(): EngineStoreHandle<VersionRowState, VersionRowActions> {
  return defineStore({
    init: (): VersionRowState => ({ status: 'idle', version: '', commit: undefined, buildHash: undefined, schemaVersion: undefined }),
    actions: {
      sync: (d, next) => {
        d.status = next.status
        d.version = next.version
        d.commit = next.commit
        d.buildHash = next.buildHash
        d.schemaVersion = next.schemaVersion
      },
    },
  })
}
