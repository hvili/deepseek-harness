/**
 * Diagnostics section: the read-only "我是谁、由什么组成" surface. It renders
 * the connected host's build-manifest identity (version / commit / build hash
 * / schema version) and the client's capability assembly — every live slot
 * seam with its occupants, provenance, and maturity. No write surface; both
 * fact sets are published into the diagnostics store by the apply world.
 */
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitySeam } from '@deepseek-ai/dsh-client-runtime/client'
import type { createDiagnosticsStore } from './diagnostics-store.ts'
import css from './DiagnosticsSection.module.css'

/** Full component props: runtime share + store share + locale seat. */
export type DiagnosticsSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createDiagnosticsStore>>
  & PropsLocale<'settings'>

/** Render one seam row: name, provenance, maturity, and its occupants. */
function SeamRow({ seam, t }: { seam: CapabilitySeam; t: TranslateNS<'settings'> }) {
  const occupants = seam.occupants.length === 0
    ? t('diagnostics.empty')
    : seam.occupants
      .map(o => o.id ?? o.key ?? o.registrant ?? t('diagnostics.empty'))
      .join(', ')
  return (
    <tr>
      <td className={css.cell}>{seam.name}</td>
      <td className={css.cell}>{seam.kind}</td>
      <td className={css.cell}>{seam.scope}</td>
      <td className={css.cell}>{seam.maturity}</td>
      <td className={css.cell}>{occupants}</td>
    </tr>
  )
}

/**
 * Render the read-only Diagnostics section.
 * @param props - composed slot props.
 * @returns the section, or null until a connected description is available.
 */
export function DiagnosticsSection({ t, useStore }: DiagnosticsSectionComponentProps) {
  const status = useStore(s => s.status)
  const version = useStore(s => s.version)
  const commit = useStore(s => s.commit)
  const buildHash = useStore(s => s.buildHash)
  const schemaVersion = useStore(s => s.schemaVersion)
  const seams = useStore(s => s.seams)
  const seamCount = useStore(s => s.seamCount)
  const occupantCount = useStore(s => s.occupantCount)

  if (status === 'idle') return null

  const commitLine = commit === undefined ? '—' : commit
  const buildLine = buildHash === undefined ? '—' : buildHash
  const schemaLine = schemaVersion === undefined ? '—' : String(schemaVersion)

  return (
    <div className={css.section}>
      <h3 className={css.heading}>{t('diagnostics.identity')}</h3>
      <dl className={css.identity}>
        <div className={css.identityRow}><dt>{t('diagnostics.version')}</dt><dd>{version}</dd></div>
        <div className={css.identityRow}><dt>{t('diagnostics.commit')}</dt><dd className={css.mono}>{commitLine}</dd></div>
        <div className={css.identityRow}><dt>{t('diagnostics.build')}</dt><dd className={css.mono}>{buildLine}</dd></div>
        <div className={css.identityRow}><dt>{t('diagnostics.schema')}</dt><dd className={css.mono}>{schemaLine}</dd></div>
      </dl>

      <h3 className={css.heading}>{t('diagnostics.assembly')}</h3>
      <p className={css.summary}>
        {t('diagnostics.assembly.summary', { seams: seamCount, occupants: occupantCount })}
      </p>
      {seams.length === 0
        ? <p className={css.empty}>{t('diagnostics.empty')}</p>
        : (
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.cell}>{t('diagnostics.seam')}</th>
                <th className={css.cell}>{t('diagnostics.kind')}</th>
                <th className={css.cell}>{t('diagnostics.scope')}</th>
                <th className={css.cell}>{t('diagnostics.maturity')}</th>
                <th className={css.cell}>{t('diagnostics.occupants')}</th>
              </tr>
            </thead>
            <tbody>
              {seams.map(seam => <SeamRow key={seam.name} seam={seam} t={t} />)}
            </tbody>
          </table>
        )}
    </div>
  )
}
