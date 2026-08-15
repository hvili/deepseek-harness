/** Configuration card for the optional image-to-text vision proxy. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { VisionProxyCardFace } from './vision-proxy-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props injected by the plugin settings slot. */
export type VisionProxyCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VisionProxyCardFace>

/** Render the vision-proxy settings card. */
export function VisionProxyCard(props: VisionProxyCardProps) {
  const { t } = props
  const state = props.useVisionProxyCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="visionProxyTitle"
      descriptionKey="visionProxyDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ToggleField
        id="plugin-config-vision-proxy-enabled"
        label={t('visionProxyEnabled')}
        hint={t('visionProxyEnabledHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <ValueField
        id="plugin-config-vision-proxy-provider"
        label={t('visionProxyProvider')}
        hint={t('visionProxyProviderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.visionProvider}
        onEdit={(text) => { props.edit('visionProvider', text) }}
        onReset={() => { props.resetField('visionProvider') }}
      />
      <ValueField
        id="plugin-config-vision-proxy-model"
        label={t('visionProxyModel')}
        hint={t('visionProxyModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.visionModel}
        onEdit={(text) => { props.edit('visionModel', text) }}
        onReset={() => { props.resetField('visionModel') }}
      />
      <ValueField
        id="plugin-config-vision-proxy-max-tokens"
        label={t('visionProxyMaxTokens')}
        hint={t('visionProxyMaxTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxTokens}
        onEdit={(text) => { props.edit('maxTokens', text) }}
        onReset={() => { props.resetField('maxTokens') }}
      />
    </PluginCard>
  )
}
