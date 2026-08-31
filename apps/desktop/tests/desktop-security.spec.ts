/** Structural security contracts that remain checkable without Electron's binary. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(resolve(import.meta.dirname, '..', 'src', name), 'utf8')

describe('desktop shell security boundary', () => {
  it('uses a privileged app origin and one named host', () => {
    const scheme = source('scheme.ts')
    const protocol = source('protocol.ts')
    expect(scheme).toContain("APP_INDEX_URL = 'app://dsh/index.html'")
    expect(scheme).toContain('secure: true')
    expect(protocol).toContain('hostname !== APP_HOST')
  })

  it('keeps the renderer sandboxed and prevents navigation/new windows', () => {
    const main = source('main.ts')
    expect(main).toContain('sandbox: true')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('setWindowOpenHandler')
    expect(main).toContain('will-navigate')
    expect(main).toContain("connect-src 'self'")
  })

  it('pins all persistent Electron paths to DesktopData and fixes Home/CWD', () => {
    const bootstrap = source('bootstrap.ts')
    for (const key of ['userData', 'cache', 'logs', 'crashDumps']) expect(bootstrap).toContain(`app.setPath('${key}'`)
    expect(bootstrap).toContain("const WORKSPACE = 'D:\\\\DeepSeek'")
    expect(bootstrap).toContain('process.env.DSH_HOME = HOME')
    expect(bootstrap).toContain('process.chdir(WORKSPACE)')
    expect(bootstrap.indexOf("app.setPath('userData'")).toBeLessThan(bootstrap.indexOf('import(MAIN_ENTRY)'))
  })

  it('shuts down the Host before bounded current-process-tree cleanup', () => {
    const main = source('main.ts')
    expect(main).toContain('SHUTDOWN_TIMEOUT_MS = 5_000')
    expect(main).toContain("execFile('taskkill', ['/PID', String(process.pid), '/T', '/F']")
    expect(main).toContain('host.ctx.fiber.dispose()')
  })

  it('exposes only named contextBridge methods from the preload', () => {
    const preload = source('preload.ts')
    expect(preload).toContain("contextBridge.exposeInMainWorld('desktopBridge', bridge)")
    expect(preload).not.toContain('ipcRenderer:')
    expect(preload).not.toContain('require(')
  })
})
