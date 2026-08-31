/** Minimal synchronous Electron bootstrap: establish paths before Host imports. */

import { app } from 'electron'
import { join } from 'node:path'
import { registerAppScheme } from './scheme.ts'

const WORKSPACE = 'D:\\DeepSeek'
const HOME = join(WORKSPACE, 'Home')
const DATA = join(WORKSPACE, 'DesktopData')
const MAIN_ENTRY = './main.mjs'

registerAppScheme()
process.chdir(WORKSPACE)
process.env.DSH_HOME = HOME
app.setPath('userData', join(DATA, 'userData'))
app.setPath('cache', join(DATA, 'cache'))
app.setPath('logs', join(DATA, 'logs'))
app.setPath('crashDumps', join(DATA, 'crashDumps'))

import(MAIN_ENTRY).catch((error: unknown) => {
  console.error('dsh-desktop Main import failed', error)
  app.exit(1)
})
