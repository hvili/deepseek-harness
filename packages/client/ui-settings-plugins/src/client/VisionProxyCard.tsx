/** Configuration card for the optional image-to-text vision proxy. */

import { useCallback, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SelectField, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { VISION_PROXY_ERROR_MODES, type VisionProxyCardFace } from './vision-proxy-card-controller.ts'
import type {} from './slot-contract.ts'
import fieldsCss from './fields.module.css'

/** Props injected by the plugin settings slot. */
export type VisionProxyCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<VisionProxyCardFace>

/** LocalStorage key recording that the user accepted the privacy notice once. */
const PRIVACY_CONFIRM_KEY = 'dsh.vision-proxy.privacy-confirmed'

/** Read the one-time privacy confirmation flag defensively (private mode can throw). */
function hasPrivacyConfirmation(): boolean {
  try {
    return window.localStorage.getItem(PRIVACY_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the one-time privacy confirmation defensively. */
function markPrivacyConfirmed(): void {
  try {
    window.localStorage.setItem(PRIVACY_CONFIRM_KEY, '1')
  } catch {
    // Private browsing / storage denial: ask again next time.
  }
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; detail?: string }
  | { kind: 'error'; detail: string }

/** Render the vision-proxy settings card. */
export function VisionProxyCard(props: VisionProxyCardProps) {
  const { t } = props
  const state = props.useVisionProxyCard(snapshot => snapshot)
  const disabled = !state.writable
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' })

  const handleEnabledEdit = useCallback((text: string): void => {
    if (text === 'true' && !hasPrivacyConfirmation()) {
      if (!window.confirm(t('visionProxyPrivacyConfirm'))) return
      markPrivacyConfirmed()
    }
    props.edit('enabled', text)
  }, [props, t])

  const runTest = useCallback(async (): Promise<void> => {
    const provider = state.visionProvider.text.trim()
    const model = state.visionModel.text.trim()
    if (provider === '' || model === '') {
      setTestStatus({ kind: 'error', detail: t('visionProxyTestEmpty') })
      return
    }
    setTestStatus({ kind: 'testing' })
    try {
      const parsedTimeout = Number(state.timeoutMs.text)
        const timeoutMs = Number.isSafeInteger(parsedTimeout) && parsedTimeout > 0
          ? parsedTimeout
          : undefined
        const result = await props.testModel(provider, model, {
          probeVision: true,
          ...timeoutMs === undefined ? {} : { timeoutMs },
        })
      if (!result.ok) {
        setTestStatus({ kind: 'error', detail: result.error ?? t('visionProxyTestFailed') })
        return
      }
      if (result.inputModalities !== undefined && !result.inputModalities.includes('image')) {
        setTestStatus({ kind: 'error', detail: t('visionProxyTestNoImage', { provider, model }) })
        return
      }
      setTestStatus({ kind: 'success', detail: t('visionProxyTestSuccess', { provider, model }) })
    } catch (error: unknown) {
      setTestStatus({
        kind: 'error',
        detail: error instanceof Error ? error.message : t('visionProxyTestFailed'),
      })
    }
  }, [props, state.visionProvider.text, state.visionModel.text, state.timeoutMs.text, t])

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
        onEdit={handleEnabledEdit}
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
      <SelectField
        id="plugin-config-vision-proxy-error-mode"
        label={t('visionProxyErrorMode')}
        hint={t('visionProxyErrorModeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        options={VISION_PROXY_ERROR_MODES}
        optionLabels={VISION_PROXY_ERROR_MODES.map(mode => t(mode === 'fail' ? 'visionProxyErrorFail' : 'visionProxyErrorPass'))}
        disabled={disabled}
        {...state.errorMode}
        onEdit={(text) => { props.edit('errorMode', text) }}
        onReset={() => { props.resetField('errorMode') }}
      />
      <ValueField
        id="plugin-config-vision-proxy-timeout-ms"
        label={t('visionProxyTimeoutMs')}
        hint={t('visionProxyTimeoutMsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <ValueField
        id="plugin-config-vision-proxy-description-prefix"
        label={t('visionProxyDescriptionPrefix')}
        hint={t('visionProxyDescriptionPrefixHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.descriptionPrefix}
        onEdit={(text) => { props.edit('descriptionPrefix', text) }}
        onReset={() => { props.resetField('descriptionPrefix') }}
      />
      <div className={fieldsCss.testRow}>
        <button
          type="button"
          className={fieldsCss.testButton}
          disabled={disabled || testStatus.kind === 'testing'}
          onClick={() => { void runTest() }}
        >
          {testStatus.kind === 'testing' ? t('visionProxyTesting') : t('visionProxyTest')}
        </button>
        {testStatus.kind === 'success' && (
          <span className={`${fieldsCss.testStatus} ${fieldsCss.testStatusSuccess}`} role="status">
            {testStatus.detail}
          </span>
        )}
        {testStatus.kind === 'error' && (
          <span className={`${fieldsCss.testStatus} ${fieldsCss.testStatusError}`} role="alert">
            {testStatus.detail}
          </span>
        )}
      </div>
    </PluginCard>
  )
}