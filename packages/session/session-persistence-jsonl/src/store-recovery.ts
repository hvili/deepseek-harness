/**
 * JSONL store-level recovery integration: read the persisted session-log format
 * version of a REAL mounted persistence backend by reusing its own read path
 * (so compressed Zstandard artifacts parse correctly). This is the
 * stored-format slice the upgrade/restore coordinators need to preflight,
 * snapshot, and restore a real store root.
 *
 * Kept dependency-free by deriving the store version from the backend's
 * `listSnapshots` (the same source backup preflight and startup fail-closed
 * already use) rather than reaching into per-artifact files.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/store-recovery
 */

/** The slice of a mounted persistence a store-format read needs. */
export interface StoreFormatVersionSource {
  listSnapshots(signal?: AbortSignal): Promise<ReadonlyArray<{ readonly header: { readonly version: number } }>>
}

/**
 * Resolve a real store's persisted session-log format version as the maximum
 * header version across every stored session, or `undefined` for an empty
 * store. Backs the upgrade coordinator's `readFormatVersion` for a JSONL store.
 * @param source - the mounted persistence backend to enumerate.
 * @param signal - optional cancellation for the backend list work.
 * @returns the max stored header version, `undefined` when the store is empty.
 */
export async function readStoredFormatVersion(source: StoreFormatVersionSource, signal?: AbortSignal): Promise<number | undefined> {
  const snapshots = await source.listSnapshots(signal)
  if (snapshots.length === 0) return undefined
  return Math.max(...snapshots.map(snapshot => snapshot.header.version))
}