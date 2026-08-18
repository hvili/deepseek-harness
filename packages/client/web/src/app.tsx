/**
 * Real-UI assembly closure, invoked by the app-shell plugin once its inject
 * set is active: the whole layout tree hangs off the built-in 'root' slot
 * (ui-layout registers AppFrame there and renders the child slots
 * internally) — the shell's render is the one ctx-level renderSlot call in
 * the program.
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { DocumentTitle } from './DocumentTitle.tsx'
import css from './AppRoot.module.css'
// Type-only: pulls the runtime's SlotMap declaration merge (the 'root' key) into this program.
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/** Assembly inputs: the active app-shell plugin ctx (slots/sessions/layout services provided). */
export interface AssemblyDeps {
  /** Client context with the assembly's inject set active. */
  ctx: Context
}

/**
 * Build the renderApp factory the app-shell plugin provides to AppRoot.
 * @param deps - assembly inputs.
 * @returns factory producing the real UI tree (called once per AppRoot render after settled).
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx } = deps
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('shell assembly: sessions service unavailable')
  const connectionState = ctx.get('connectionState')
  const useSessions = bindSnapshotSelector(sessions.list)
  const useConnectionState = connectionState === undefined
    ? undefined
    : bindSnapshotSelector(connectionState)
  const SessionDocumentTitle = (): ReactNode => {
    const title = useSessions((state) => {
      const id = state.current
      return id === undefined ? undefined : state.byId[id]?.title
    })
    return <DocumentTitle {...title === undefined ? {} : { title }} />
  }
  const VersionMismatchGate = (): ReactNode => {
    const snapshot = useConnectionState === undefined
      ? undefined
      : useConnectionState(state => state)
    if (snapshot === undefined || snapshot.state !== 'version-mismatch') return null
    return (
      <div className={css.versionMismatch}>
        <div className={css.card}>
          <div className={css.wordmark}>HARNESS</div>
          <div className={css.failed}>
            <div className={css.failedTitle}>Incompatible host version</div>
            <div className={css.failedItem}>
              The host reports session format v{snapshot.hostVersion ?? '?'}, but this build reads v{snapshot.expectedVersion ?? '?'}.
            </div>
            <div className={css.failedItem}>Update the app to match the host before continuing.</div>
          </div>
        </div>
      </div>
    )
  }
  return () => (
    <>
      <SessionDocumentTitle />
      <VersionMismatchGate />
      {ctx.slots.renderSlot('root', {})}
    </>
  )
}
