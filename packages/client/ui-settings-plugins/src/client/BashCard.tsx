/** The shell plugin's card: the limits every command the agent runs is bound by. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NumericValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { BashCardFace } from './bash-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the shell card. */
export type BashCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<BashCardFace>

/**
 * Render the shell card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function BashCard(props: BashCardProps) {
  const { t } = props
  const state = props.useBashCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="bashTitle"
      descriptionKey="bashDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {([
        { field: 'timeoutMs', id: 'plugin-config-bash-timeout', label: 'bashTimeoutMs', hint: 'bashTimeoutMsHint' },
        { field: 'maxOutputBytes', id: 'plugin-config-bash-output', label: 'bashMaxOutputBytes', hint: 'bashMaxOutputBytesHint' },
      ] as const).map(item => (
        <NumericValueField
          key={item.field}
          id={item.id}
          label={t(item.label)}
          hint={t(item.hint)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          disabled={disabled}
          {...state[item.field]}
          onEdit={(text) => { props.edit(item.field, text) }}
          onReset={() => { props.resetField(item.field) }}
        />
      ))}
    </PluginCard>
  )
}
