import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './channels.ts'

interface DesktopBridgeResponse { status: number; headers: [string, string][]; body: string }
interface DesktopNotificationIntent {
  kind: 'task-complete' | 'approval-required' | 'startup-failure'
  title: string
  body: string
  sessionId?: string
}
interface DesktopBridge {
  fetch(request: {
    id: string
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }): Promise<DesktopBridgeResponse>
  cancel(id: string): void
  subscribe(stream: 'mux' | 'host', listener: (frame: unknown) => void): {
    unsubscribe(): void
    onEnd(listener: () => void): void
  }
  onOpenSession(listener: (sessionId: string) => void): () => void
  notify(intent: DesktopNotificationIntent): void
  readonly version: string
  readonly windowControls: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void
  }
}

let counter = 0
const bridge: DesktopBridge = {
  fetch: request => ipcRenderer.invoke(IPC.rpc, request) as Promise<DesktopBridgeResponse>,
  cancel: (id) => { ipcRenderer.send(IPC.cancel, id) },
  subscribe: (stream, listener) => {
    const subId = `sub_${String(++counter)}`
    const ends = new Set<() => void>()
    const frame = (_event: unknown, value: { subId?: unknown; frame?: unknown }) => {
      if (value.subId === subId) listener(value.frame)
    }
    const end = (_event: unknown, value: { subId?: unknown }) => { if (value.subId === subId) for (const listener of ends) listener() }
    ipcRenderer.on(IPC.frame, frame); ipcRenderer.on(IPC.streamEnd, end)
    void ipcRenderer.invoke(IPC.subscribe, { stream, subId })
    return {
      unsubscribe: () => {
        ipcRenderer.removeListener(IPC.frame, frame)
        ipcRenderer.removeListener(IPC.streamEnd, end)
        ipcRenderer.send(IPC.unsubscribe, subId)
      },
      onEnd: (listener) => { ends.add(listener) },
    }
  },
  onOpenSession: (listener) => {
    const handler = (_event: unknown, value: { sessionId?: unknown }) => {
      if (typeof value.sessionId === 'string') listener(value.sessionId)
    }
    ipcRenderer.on(IPC.openSession, handler)
    return () => { ipcRenderer.removeListener(IPC.openSession, handler) }
  },
  notify: (intent: DesktopNotificationIntent) => { ipcRenderer.send(IPC.notify, intent) },
  version: 'desktop',
  windowControls: {
    minimize: () => { ipcRenderer.send(IPC.windowAction, 'minimize') },
    toggleMaximize: () => { ipcRenderer.send(IPC.windowAction, 'toggle-maximize') },
    close: () => { ipcRenderer.send(IPC.windowAction, 'close') },
    isMaximized: () => (ipcRenderer.invoke(IPC.windowState) as Promise<{ maximized: boolean }>).then(value => value.maximized),
    onMaximizedChanged: (listener) => {
      const handler = (_event: unknown, value: unknown) => { if (typeof value === 'boolean') listener(value) }
      ipcRenderer.on(IPC.windowMaximized, handler)
      return () => { ipcRenderer.removeListener(IPC.windowMaximized, handler) }
    },
  },
}
contextBridge.exposeInMainWorld('desktopBridge', bridge)
