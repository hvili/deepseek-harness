/** Main-owned validated IPC adapter; renderers never receive raw Electron APIs. */

import { BrowserWindow, ipcMain, Notification } from 'electron'
import type { DesktopBridgeHost } from '@deepseek-ai/dsh-client-connection/desktop'
import { IPC } from './channels.ts'

interface DesktopBridgeRequest { id: string; url: string; method: string; headers: Record<string, string>; body?: string }
interface DesktopNotificationIntent { kind: string; title: string; body: string; sessionId?: string }

const active = new Map<string, AbortController>()
const allowedMethods = new Set(['GET', 'POST'])
const notificationKinds = new Set(['task-complete', 'approval-required', 'startup-failure'])

/** Wire the bridge with sender-local cancellation and bounded plain-object input. */
export function registerIpc(bridge: DesktopBridgeHost, version: string): void {
  ipcMain.handle(IPC.rpc, async (_event, raw: unknown) => {
    const request = validateRequest(raw)
    const controller = new AbortController()
    active.set(request.id, controller)
    try {
      const logical = new URL(request.url)
      const url = new URL(`http://127.0.0.1${logical.pathname}${logical.search}`)
      const headers = new Headers(request.headers)
      headers.set('host', '127.0.0.1')
      const response = await bridge.fetch(new Request(url, {
        method: request.method, headers, signal: controller.signal,
        ...(request.body === undefined ? {} : { body: request.body }),
      }))
      return { status: response.status, headers: [...response.headers], body: await response.text() }
    } finally { active.delete(request.id) }
  })
  ipcMain.on(IPC.cancel, (_event, id: unknown) => { if (typeof id === 'string') active.get(id)?.abort() })
  ipcMain.handle(IPC.subscribe, (event, raw: unknown) => {
    const payload = validateSubscription(raw)
    const controller = new AbortController()
    active.set(payload.subId, controller)
    const source = payload.stream === 'mux' ? bridge.openMux(controller.signal) : bridge.openHost(controller.signal)
    const sender = event.sender
    void pump(sender, payload.subId, source, controller)
    return { ok: true }
  })
  ipcMain.on(IPC.unsubscribe, (_event, id: unknown) => { if (typeof id === 'string') active.get(id)?.abort() })
  ipcMain.on(IPC.windowAction, (event, action: unknown) => {
    applyWindowAction(BrowserWindow.fromWebContents(event.sender), action)
  })
  ipcMain.handle(IPC.windowState, event => ({
    maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  }))
  ipcMain.on(IPC.notify, (event, intent: unknown) => {
    showNotification(BrowserWindow.fromWebContents(event.sender), intent)
  })
  // Version is returned from a non-privileged value, not an Electron object.
  ipcMain.handle('dsh:version', () => version)
}

async function pump(
  sender: Electron.WebContents, subId: string, source: AsyncIterable<unknown>, controller: AbortController,
): Promise<void> {
  try { for await (const frame of source) { if (sender.isDestroyed()) break; sender.send(IPC.frame, { subId, frame }) } }
  catch (error) { if (!controller.signal.aborted) console.error('dsh-desktop IPC stream failed', error) }
  finally { active.delete(subId); if (!sender.isDestroyed()) sender.send(IPC.streamEnd, { subId }) }
}

function validateRequest(value: unknown): DesktopBridgeRequest {
  if (value === null || typeof value !== 'object') throw new Error('desktop IPC request must be an object')
  const input = value as { id?: unknown; url?: unknown; method?: unknown; headers?: unknown; body?: unknown }
  if (typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 160
    || typeof input.url !== 'string' || typeof input.method !== 'string' || !allowedMethods.has(input.method)
    || !isStringRecord(input.headers)
    || input.body !== undefined && typeof input.body !== 'string') throw new Error('desktop IPC request is invalid')
  const url = new URL(input.url)
  if (url.protocol !== 'http:' || url.hostname !== 'dsh.internal') throw new Error('desktop IPC request has an invalid logical origin')
  return {
    id: input.id,
    url: input.url,
    method: input.method,
    headers: input.headers,
    ...(input.body === undefined ? {} : { body: input.body }),
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(item => typeof item === 'string')
}

function validateSubscription(value: unknown): { stream: 'mux' | 'host'; subId: string } {
  if (value === null || typeof value !== 'object') throw new Error('desktop subscription must be an object')
  const input = value as { stream?: unknown; subId?: unknown }
  if ((input.stream !== 'mux' && input.stream !== 'host') || typeof input.subId !== 'string'
    || input.subId.length === 0 || input.subId.length > 160) throw new Error('desktop subscription is invalid')
  return { stream: input.stream, subId: input.subId }
}

function applyWindowAction(window: BrowserWindow | null, action: unknown): void {
  if (window === null) return
  if (action === 'minimize') window.minimize()
  else if (action === 'toggle-maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize() }
  else if (action === 'close') window.close()
}

function showNotification(window: BrowserWindow | null, value: unknown): void {
  if (window === null || value === null || typeof value !== 'object') return
  const intent = value as Partial<DesktopNotificationIntent>
  if (typeof intent.kind !== 'string' || !notificationKinds.has(intent.kind) || typeof intent.title !== 'string' || typeof intent.body !== 'string') return
  const notification = new Notification({ title: intent.title.slice(0, 120), body: intent.body.slice(0, 280) })
  notification.on('click', () => { window.show(); window.focus(); if (typeof intent.sessionId === 'string') window.webContents.send(IPC.openSession, { sessionId: intent.sessionId }) })
  notification.show()
}
