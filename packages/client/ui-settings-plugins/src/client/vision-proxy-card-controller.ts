/** Staged settings bridge for the optional image-to-text vision proxy. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, booleanField, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Host settings namespace owned by the vision-proxy plugin. */
export const VISION_PROXY_NS = 'vision-proxy'

/** Fields mirrored by the card. */
export interface VisionProxySettings {
  enabled?: boolean
  visionProvider?: string
  visionModel?: string
  maxTokens?: number
}

/** Snapshot rendered by the vision-proxy card. */
export interface VisionProxyCardState extends CardShell {
  enabled: CardFieldState
  visionProvider: CardFieldState
  visionModel: CardFieldState
  maxTokens: CardFieldState
}

/** Slot face consumed by the card component. */
export interface VisionProxyCardFace extends CardActions {
  hooks: {
    visionProxyCard: import('@deepseek-ai/dsh-client-runtime/client').SnapshotStore<VisionProxyCardState>
  }
}

/** Form/controller for the vision-proxy namespace. */
export class VisionProxyCardController {
  private readonly form: CardForm<VisionProxySettings>
  private readonly store: import('@deepseek-ai/dsh-client-runtime/client').SnapshotStore<VisionProxyCardState>

  constructor(scope: SettingsScope<VisionProxySettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      textField('visionProvider'),
      textField('visionModel'),
      numberField('maxTokens'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): VisionProxyCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visionProvider: this.form.field('visionProvider'),
      visionModel: this.form.field('visionModel'),
      maxTokens: this.form.field('maxTokens'),
    }
  }

  inject(): VisionProxyCardFace {
    return { hooks: { visionProxyCard: this.store }, ...this.form.actions() }
  }
}
