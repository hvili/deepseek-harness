/**
 * Coarse connection state contract for the browser UI. The runtime owns the
 * store (a snapshot store over `ConnectionState` plus the terminal
 * detail) and feeds it from the connection controller's state/version sinks;
 * the app shell reads it to gate the real UI on a terminal version mismatch.
 */

import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from './store.ts'

/** The connection-state snapshot the UI reads. */
export interface ConnectionStateSnapshot {
  /** Current coarse connection state; absent before the first report. */
  state: ConnectionState | undefined
  /** The host's reported session format version, when a mismatch was detected. */
  hostVersion: number | undefined
  /** This build's expected session format version, when a mismatch was detected. */
  expectedVersion: number | undefined
}

/** The outward connection-state service: an observable snapshot plus write face. */
export interface ConnectionStateService {
  /** Read the current connection-state snapshot. */
  getSnapshot(): ConnectionStateSnapshot
  /** Subscribe to connection-state changes. */
  subscribe(listener: () => void): () => void
  /** Record a coarse state transition. */
  setState(state: ConnectionState): void
  /** Record the terminal version-mismatch facts. */
  setVersionMismatch(hostVersion: number, expectedVersion: number): void
}

/** Initial connection-state snapshot. */
function initConnectionState(): ConnectionStateSnapshot {
  return { state: undefined, hostVersion: undefined, expectedVersion: undefined }
}

/**
 * Factory for the concrete service (store-backed, observable).
 * @returns the connection-state service handle.
 */
export function createConnectionStateService(): ConnectionStateService {
  const store: SnapshotStore<ConnectionStateSnapshot> = createSnapshotStore(initConnectionState())
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    setState: (state) => {
      store.update((draft) => { draft.state = state })
    },
    setVersionMismatch: (hostVersion, expectedVersion) => {
      store.set({ state: 'version-mismatch', hostVersion, expectedVersion })
    },
  }
}