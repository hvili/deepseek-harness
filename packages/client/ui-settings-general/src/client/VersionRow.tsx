/**
 * Read-only Version row: surfaces the connected host's real build identity
 * (version, git commit, schema version) in the General section. The row owns
 * no write surface — it renders the facts published by the host-description
 * handshake via the version-row store.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createVersionRowStore } from './version-row-store.ts'
import css from './VersionRow.module.css'

/** Full component props: runtime share + store share + locale seat. */
export type VersionRowComponentProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createVersionRowStore>>
  & PropsLocale<'settings'>

/**
 * Render the read-only Version row.
 * @param props - composed slot props.
 * @returns the row, or null until a connected description is available.
 */
export function VersionRow({ t, useStore }: VersionRowComponentProps) {
  const status = useStore(s => s.status)
  const version = useStore(s => s.version)
  const commit = useStore(s => s.commit)
  const buildHash = useStore(s => s.buildHash)
  const schemaVersion = useStore(s => s.schemaVersion)

  if (status === 'idle') return null

  const commitLine = commit === undefined ? undefined : t('about.commit', { commit })
  const buildLine = buildHash === undefined ? undefined : t('about.build', { build: buildHash })
  const schemaLine = schemaVersion === undefined
    ? undefined
    : t('about.schema', { schema: String(schemaVersion) })

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('about.version')}</div>
        <div className={css.value}>{version}</div>
        {(commitLine !== undefined || buildLine !== undefined || schemaLine !== undefined) && (
          <div className={css.detail}>
            {[commitLine, buildLine, schemaLine].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}