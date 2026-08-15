/** Management tab for registry-archived sessions. */

import { useMemo, useState } from 'react'
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

/** Render durable archived sessions, including their restore and deletion actions. */
export function ArchivedSessionsTab({ t, useSessions, useWorkspaces, restore, remove }: ArchivedSessionsTabProps) {
  const archivedIds = useWorkspaces(snapshot => snapshot.archivedSessionIds)
  const sessions = useSessions(snapshot => snapshot.byId)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(new Set())
  const [failed, setFailed] = useState<ReadonlyMap<SessionId, string>>(new Map())
  const removableIds = useMemo(
    () => archivedIds.filter(sessionId => sessions[sessionId]?.running !== true),
    [archivedIds, sessions],
  )

  const deleteSessions = async (sessionIds: readonly SessionId[]): Promise<void> => {
    if (sessionIds.length === 0 || !window.confirm(t(
      sessionIds.length === 1 ? 'deleteSessionConfirm' : 'deleteSessionsConfirm',
      { count: sessionIds.length },
    ))) return
    setBusy(true)
    setFailed(new Map())
    const failures = new Map<SessionId, string>()
    try {
      for (const sessionId of sessionIds) {
        try {
          await remove(sessionId)
        } catch (error: unknown) {
          failures.set(sessionId, error instanceof Error ? error.message : t('deleteSessionFailed'))
        }
      }
    } finally {
      setFailed(failures)
      setSelected(new Set())
      setBusy(false)
    }
  }

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
            <label><input type="checkbox" checked={selected.size === removableIds.length && removableIds.length > 0} onChange={toggleAll} disabled={busy || removableIds.length === 0} /> {t('selectAllSessions')}</label>
            <button type="button" className={css.danger} disabled={busy || selected.size === 0} onClick={() => { void deleteSessions([...selected]) }}>{t('deleteSelectedSessions', { count: selected.size })}</button>
          </div>
          <ul className={css.list}>
            {archivedIds.map((sessionId) => {
              const session = sessions[sessionId]
              const active = session?.running === true
              return (
                <li className={css.row} key={sessionId}>
                  <input aria-label={t('selectSession', { title: session?.displayTitle ?? sessionId })} type="checkbox" checked={selected.has(sessionId)} disabled={busy || active} onChange={() => { toggle(sessionId) }} />
                  <div className={css.text}>
                    <strong>{session?.displayTitle ?? sessionId}</strong>
                    <span>{sessionId}</span>
                    {active ? <small>{t('deleteSessionHint')}</small> : null}
                    {failed.has(sessionId) ? <small className={css.error}>{failed.get(sessionId)}</small> : null}
                  </div>
                  <div className={css.actions}>
                    <button type="button" disabled={busy} onClick={() => { void restore(sessionId) }}>{t('restoreSession')}</button>
                    <button type="button" className={css.danger} disabled={busy || active} onClick={() => { void deleteSessions([sessionId]) }}>{t('deleteSession')}</button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
