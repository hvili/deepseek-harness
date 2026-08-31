/** Verify the app's packaged dependency roots and Windows x64 native payloads. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const app = resolve(process.argv[2] ?? '')
if (!existsSync(join(app, 'package.json'))) throw new Error(`packaged app is missing: ${app}`)
if (existsSync(resolve(app, '..', 'app.asar'))) throw new Error('desktop package must not contain app.asar')

const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
for (const name of Object.keys(manifest.dependencies ?? {})) {
  const packagePath = join(app, 'node_modules', name, 'package.json')
  if (!existsSync(packagePath)) throw new Error(`packaged dependency is missing: ${name}`)
}
for (const name of ['@dsh-local/appearance-studio', '@dsh-local/deepseek-balance', '@dsh-local/operations-center']) {
  if (!existsSync(join(app, 'node_modules', name, 'lib', 'index.js'))) throw new Error(`enhanced plugin is missing its Host entry: ${name}`)
  if (!existsSync(join(app, 'node_modules', name, 'lib', 'client.js'))) throw new Error(`enhanced plugin is missing its client bundle: ${name}`)
}
if (!existsSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex', 'lib', 'index.js'))) throw new Error('Codex provider is missing')
for (const name of ['node-pty', 'koffi', 'sharp']) verifyNativeX64(join(app, 'node_modules', name), name)
verifyNativeX64(join(app, 'node_modules', '@koromix', 'koffi-win32-x64'), 'koffi Windows x64')
if (!existsSync(join(app, 'node_modules', '@openai', 'codex'))) throw new Error('Codex runtime package is missing')
if (!existsSync(join(app, 'node_modules', '@vscode', 'ripgrep-win32-x64'))) throw new Error('ripgrep Windows x64 runtime is missing')
console.log(`desktop packed dependencies: ${Object.keys(manifest.dependencies ?? {}).length} roots, enhanced plugins, Codex provider, and x64 native modules are present.`)

/** Find a Windows x64 native addon and reject a non-AMD64 PE payload. */
function verifyNativeX64(directory, name) {
  const entries = walk(directory).filter(path => path.endsWith('.node'))
  const x64 = entries.find(path => peMachine(path) === 0x8664)
  if (x64 === undefined) throw new Error(`${name} has no Windows x64 native addon`)
}

/** Recursively enumerate files below a known packaged dependency directory. */
function walk(directory) {
  const paths = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) paths.push(...walk(path))
    else paths.push(path)
  }
  return paths
}

/** Return a PE file's machine field, or undefined when it is not a PE file. */
function peMachine(path) {
  const bytes = readFileSync(path)
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') return undefined
  const offset = bytes.readUInt32LE(0x3c)
  if (offset + 6 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') return undefined
  return bytes.readUInt16LE(offset + 4)
}
