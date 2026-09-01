/** Windows desktop Main: owns paths, Host lifetime, protocol, and the one sandboxed window. */

import { app, BrowserWindow, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_BRIDGE_SERVICE, type DesktopBridgeHost } from '@deepseek-ai/dsh-client-connection/desktop'
import { DesktopWebServer } from '@deepseek-ai/dsh-host-desktop-carrier'
import { bootDesktopHost } from './host.ts'
import { registerIpc } from './ipc.ts'
import { registerDesktopProtocol } from './protocol.ts'
import { APP_INDEX_URL } from './scheme.ts'
import { IPC } from './channels.ts'

const WORKSPACE = 'D:\\DeepSeek'
const HOME = join(WORKSPACE, 'Home')
let host: Awaited<ReturnType<typeof bootDesktopHost>> | undefined
let quitting = false
const SHUTDOWN_TIMEOUT_MS = 5_000

// Renderer assets are exclusively app://dsh. The static frontend may still
// request module/image/font bytes from that origin, but it never needs a
// network connection, embedded frame, or executable plugin source elsewhere.
app.on('web-contents-created', (_event, contents) => {
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('app://dsh/')) {
      callback({})
      return
    }
    callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'"],
    } })
  })
})

function version(): string {
  const path = join(import.meta.dirname, '..', 'package.json')
  if (!existsSync(path)) return '0.0.0'
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 980, minHeight: 640, frame: false, show: false, webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  window.once('ready-to-show', () => { window.show() })
  window.webContents.once('did-finish-load', () => {
    const loadedUrl = window.webContents.getURL()
    if (loadedUrl !== APP_INDEX_URL) {
      console.error(`dsh-desktop loaded unexpected URL ${loadedUrl}`)
      app.exit(1)
      return
    }
    console.log(`dsh-desktop ready ${loadedUrl}`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return
    console.error(`dsh-desktop failed to load ${url}: ${String(code)} ${description}`)
    app.exit(1)
  })
  window.on('maximize', () => { window.webContents.send(IPC.windowMaximized, true) })
  window.on('unmaximize', () => { window.webContents.send(IPC.windowMaximized, false) })
  window.on('close', () => { if (!quitting) app.quit() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//u.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => { if (url !== APP_INDEX_URL) event.preventDefault() })
  void window.loadURL(APP_INDEX_URL)
  return window
}

void app.whenReady().then(async () => {
  try {
    host = await bootDesktopHost(HOME)
    const carrier = host.ctx.get('webServer')
    const bridge: unknown = host.ctx.get(DESKTOP_BRIDGE_SERVICE)
    if (!(carrier instanceof DesktopWebServer) || bridge === undefined) throw new Error('desktop Host did not provide zero-port carrier and IPC bridge')
    registerDesktopProtocol(carrier)
    registerIpc(bridge as DesktopBridgeHost, version())
    createWindow()
  } catch (error) {
    console.error('dsh-desktop startup failed', error)
    app.exit(1)
  }
})

app.on('window-all-closed', () => { app.quit() })
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  if (host === undefined) return
  event.preventDefault()
  // A Host disposer normally stops every owned process. If a provider wedges,
  // Windows receives a last-resort tree cleanup only for this Electron PID;
  // no shared Home or legacy installation path is ever a cleanup target.
  const fallback = setTimeout(() => {
    execFile('taskkill', ['/PID', String(process.pid), '/T', '/F'], () => {})
  }, SHUTDOWN_TIMEOUT_MS)
  void host.ctx.fiber.dispose().finally(() => {
    clearTimeout(fallback)
    app.exit(0)
  })
})
