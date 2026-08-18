/** Staged settings bridge for the optional image-to-text vision proxy. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, booleanField, numberField, selectField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Host settings namespace owned by the vision-proxy plugin. */
export const VISION_PROXY_NS = 'vision-proxy'

/** Allowed values for the vision-proxy errorMode setting. */
export const VISION_PROXY_ERROR_MODES = ['fail', 'pass'] as const

/** Result of a configuration-plane model test; `probeVision` spends a tiny token budget. */
export interface VisionProxyTestResult {
  ok: boolean
  inputModalities?: string[]
  error?: string
}

/** Fields mirrored by the card. */
export interface VisionProxySettings {
  enabled?: boolean
  visionProvider?: string
  visionModel?: string
  maxTokens?: number
  descriptionPrefix?: string
  errorMode?: 'fail' | 'pass'
  timeoutMs?: number
}

/** Snapshot rendered by the vision-proxy card. */
export interface VisionProxyCardState extends CardShell {
  enabled: CardFieldState
  visionProvider: CardFieldState
  visionModel: CardFieldState
  maxTokens: CardFieldState
  descriptionPrefix: CardFieldState
  errorMode: CardFieldState
  timeoutMs: CardFieldState
}

/** Slot face consumed by the card component. */
export interface VisionProxyCardFace extends CardActions {
  /** Test whether the drafted provider/model route resolves, optionally through a real 1px image probe. */
  testModel: (provider: string, model: string, options?: { probeVision?: boolean; timeoutMs?: number }) => Promise<VisionProxyTestResult>
  hooks: {
    visionProxyCard: import('@deepseek-ai/dsh-client-runtime/client').SnapshotStore<VisionProxyCardState>
  }
}

/** Form/controller for the vision-proxy namespace. */
export class VisionProxyCardController {
  private readonly form: CardForm<VisionProxySettings>
  private readonly store: import('@deepseek-ai/dsh-client-runtime/client').SnapshotStore<VisionProxyCardState>
  private readonly testModel: VisionProxyCardFace['testModel']

  constructor(
    scope: SettingsScope<VisionProxySettings>,
    testModel: VisionProxyCardFace['testModel'],
  ) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      textField('visionProvider'),
      textField('visionModel'),
      numberField('maxTokens'),
      textField('descriptionPrefix'),
      selectField('errorMode', VISION_PROXY_ERROR_MODES),
      numberField('timeoutMs'),
    ])
    this.testModel = testModel
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): VisionProxyCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visionProvider: this.form.field('visionProvider'),
      visionModel: this.form.field('visionModel'),
      maxTokens: this.form.field('maxTokens'),
      descriptionPrefix: this.form.field('descriptionPrefix'),
      errorMode: this.form.field('errorMode'),
      timeoutMs: this.form.field('timeoutMs'),
    }
  }

  inject(): VisionProxyCardFace {
    return {
      testModel: this.testModel,
      hooks: { visionProxyCard: this.store },
      ...this.form.actions(),
    }
  }
}