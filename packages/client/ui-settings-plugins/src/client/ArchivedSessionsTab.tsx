/** Management tab for registry-archived sessions. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import css from './ArchivedSessionsTab.module.css'

export interface ArchivedSessionsTabInjected {
  restore(sessionId: SessionId): Promise<void>
  remove(sessionId: SessionId): Promise<boolean>
}

export type ArchivedSessionsTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ArchivedSessionsTabInjected>

/** Progress state for a batch deletion operation. */
interface BatchProgress {
  /** Total sessions being deleted. */
  total: number
  /** Number of sessions deleted so far (success or failure). */
  done: number
  /** Number of sessions that failed. */
  failed: number
}

/** Render durable archived sessions, including their restore and deletion actions. */
export function ArchivedSessionsTab({ t, useSessions, useWorkspaces, restore, remove }: ArchivedSessionsTabProps) {
  const archivedIds = useWorkspaces(snapshot => snapshot.archivedSessionIds)
  const sessions = useSessions(snapshot => snapshot.byId)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(new Set())
  const [failed, setFailed] = useState<ReadonlyMap<SessionId, string>>(new Map())
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [search, setSearch] = useState('')
  // Track whether the component is still mounted to avoid setState after unmount.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  const removableIds = useMemo(
    () => archivedIds.filter(sessionId => sessions[sessionId]?.running !== true),
    [archivedIds, sessions],
  )
  const filteredIds = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (query === '') return archivedIds
    return archivedIds.filter(sessionId => {
      const title = sessions[sessionId]?.displayTitle ?? sessionId
      return title.toLocaleLowerCase().includes(query) || sessionId.toLocaleLowerCase().includes(query)
    })
  }, [archivedIds, search, sessions])

  const deleteSessions = useCallback(async (sessionIds: readonly SessionId[]): Promise<void> => {
    if (sessionIds.length === 0 || !window.confirm(t(
      sessionIds.length === 1 ? 'deleteSessionConfirm' : 'deleteSessionsConfirm',
      { count: sessionIds.length },
    ))) return
    setBusy(true)
    setFailed(new Map())
    const failures = new Map<SessionId, string>()
    const total = sessionIds.length
    let done = 0
    setBatchProgress({ total, done: 0, failed: 0 })
    try {
      // Parallel deletion with concurrency cap of 4 to avoid overwhelming
      // the host while still being faster than serial for large batches.
      const CONCURRENCY = 4
      const queue = [...sessionIds]
      const workers: Promise<void>[] = []
      for (let w = 0; w < CONCURRENCY && w < total; w += 1) {
        workers.push((async () => {
          while (true) {
            const sessionId = queue.shift()
            if (sessionId === undefined) return
            let failCount = 0
            try {
              await remove(sessionId)
            } catch (error: unknown) {
              failures.set(sessionId, error instanceof Error ? error.message : t('deleteSessionFailed'))
              failCount = 1
            }
            if (mountedRef.current) {
              done += 1
              setBatchProgress(prev => prev !== null
                ? { total, done, failed: (prev.failed + failCount) }
                : null)
            }
          }
        })())
      }
      await Promise.all(workers)
    } finally {
      setFailed(failures)
      setSelected(new Set())
      setBatchProgress(null)
      setBusy(false)
    }
  }, [remove, t])

  // Clean up mounted ref on unmount.

  const toggle = (sessionId: SessionId): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected(current => current.size === removableIds.length ? new Set() : new Set(removableIds))
  }

  return (
    <section className={css.section} aria-label={t('archivedTitle')}>
      <h3 className={css.heading}>{t('archivedTitle')}</h3>
      <p className={css.intro}>{t('archivedIntro')}</p>
      {archivedIds.length === 0 ? <p className={css.empty}>{t('archivedEmpty')}</p> : (
        <>
          <div className={css.bulkActions}>
            <label>
              <input
                type="checkbox"
                checked={selected.size === removableIds.length && removableIds.length > 0}
                onChange={toggleAll}
                disabled={busy || removableIds.length === 0}
              />
              {' '}{t('selectAllSessions')}
            </label>
            <input
              className={css.search}
              type="search"
              placeholder={t('searchArchivedPlaceholder')}
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              aria-label={t('searchArchivedPlaceholder')}
            />
            <button
              type="button"
              className={css.danger}
              disabled={busy || selected.size === 0}
              onClick={() => { void deleteSessions([...selected]) }}
            >
              {batchProgress !== null
                ? t('deleteProgress', { done: batchProgress.done, total: batchProgress.total })
                : t('deleteSelectedSessions', { count: selected.size })}
            </button>
            {failed.size > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { void deleteSessions([...failed.keys()]) }}
              >
                {t('retryFailedDeletes', { count: failed.size })}
              </button>
            )}
          </div>
          {batchProgress !== null && (
            <div className={css.progress} role="progressbar" aria-valuenow={batchProgress.done} aria-valuemin={0} aria-valuemax={batchProgress.total}>
              <div
                className={css.progressBar}
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
          )}
          {filteredIds.length === 0 ? <p className={css.empty}>{t('archivedEmpty')}</p> : (
          <ul className={css.list}>
            {filteredIds.map((sessionId) => {
              const session = sessions[sessionId]
              const active = session?.running === true
              return (
                <li className={css.row} key={sessionId}>
                  <input
                    aria-label={t('selectSession', { title: session?.displayTitle ?? sessionId })}
                    type="checkbox"
                    checked={selected.has(sessionId)}
                    disabled={busy || active}
                    onChange={() => { toggle(sessionId) }}
                  />
                  <div className={css.text}>
                    <strong>{session?.displayTitle ?? sessionId}</strong>
                    <span>{sessionId}</span>
                    {active ? <small>{t('deleteSessionHint')}</small> : null}
                    {failed.has(sessionId) ? <small className={css.error}>{failed.get(sessionId)}</small> : null}
                  </div>
                  <div className={css.actions}>
                    <button type="button" disabled={busy} onClick={() => { void restore(sessionId) }}>
                      {t('restoreSession')}
                    </button>
                    <button
                      type="button"
                      className={css.danger}
                      disabled={busy || active}
                      onClick={() => { void deleteSessions([sessionId]) }}
                    >
                      {t('deleteSession')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          )}
        </>
      )}
    </section>
  )
}