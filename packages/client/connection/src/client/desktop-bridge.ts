/**
 * Clone-safe wire contract exposed by the Electron preload. The bridge keeps
 * Electron objects out of the renderer and carries requests, event frames,
 * window commands, and notification intents as structured-clone values.
 * @module @deepseek-ai/dsh-client-connection/desktop-bridge
 */

import type { ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One unary/respond request crossing the context-isolated bridge. */
export interface DesktopBridgeRequest {
  /** Caller-owned cancellation id. */
  id: string
  /** Absolute logical URL; Main normalizes its authority to loopback. */
  url: string
  /** HTTP method. */
  method: string
  /** Plain request headers. */
  headers: Record<string, string>
  /** Optional text body. */
  body?: string
}
/** One unary/respond result crossing the context-isolated bridge. */
export interface DesktopBridgeResponse {
  /** HTTP-compatible status code. */
  status: number
  /** Plain response headers. */
  headers: [string, string][]
  /** Response body text. */
  body: string
}

/** Handle for a bridge-backed downlink stream. */
export interface DesktopBridgeSubscription {
  /** Stop the host pump and detach renderer listeners. */
  unsubscribe(): void
  /** Register a callback that runs once when the host pump ends. */
  onEnd(listener: () => void): void
}

/** Allowed commands for the frameless Windows caption controls. */
export interface DesktopWindowControls {
  /** Minimize the current window. */
  minimize(): void
  /** Toggle maximized/restored state. */
  toggleMaximize(): void
  /** Close the current window. */
  close(): void
  /** Read the current maximized state. */
  isMaximized(): Promise<boolean>
  /** Subscribe to maximized-state changes and return a disposer. */
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void
}

/** Notification classes allowed across the desktop bridge. */
export type DesktopNotificationKind = 'task-complete' | 'approval-required' | 'startup-failure'

/** Sanitized notification request; no session or request content is required. */
export interface DesktopNotificationIntent {
  /** Determines the notification policy and deduplication key. */
  kind: DesktopNotificationKind
  /** Short system-notification title. */
  title: string
  /** Short system-notification body. */
  body: string
  /** Session to open when the notification is clicked. */
  sessionId?: SessionId
}

/** Preload-owned desktop surface available only in the Electron renderer. */
export interface DesktopBridge {
  /** Dispatch one request to the in-process Host. */
  fetch(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>
  /** Cancel one request or subscription by id. */
  cancel(id: string): void
  /** Subscribe to the mux or host event stream. */
  subscribe(stream: 'mux' | 'host', listener: (frame: ServerRequest) => void): DesktopBridgeSubscription
  /** Subscribe to notification-driven session navigation. */
  onOpenSession(listener: (sessionId: SessionId) => void): () => void
  /** Ask Main to show one policy-checked Windows notification. */
  notify(intent: DesktopNotificationIntent): void
  /** Packaged application version. */
  readonly version: string
  /** Frameless window controls. */
  readonly windowControls: DesktopWindowControls
}
