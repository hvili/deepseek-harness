/** Verify the app's packaged dependency roots and Windows x64 native payloads. */

import { spawnSync } from 'node:child_process'
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

const nodePtyX64 = join(app, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64')
verifyNativeX64(nodePtyX64, 'node-pty .node')
verifyNativeX64(nodePtyX64, 'node-pty .dll', '.dll')
verifyNativeX64(nodePtyX64, 'node-pty .exe', '.exe')
verifyPlatformPackage('@koromix/koffi-win32-x64', '@koromix/koffi-win32-x64', ['.node'])
verifyPlatformPackage('@img/sharp-win32-x64', '@img/sharp-win32-x64', ['.node', '.dll'])
verifyPlatformPackage('@openai/codex-win32-x64', '@openai/codex', ['.exe'])
verifyPlatformPackage('@vscode/ripgrep-win32-x64', '@vscode/ripgrep-win32-x64', ['.exe'])

const executable = resolve(app, '..', '..', 'DeepSeek Harness.exe')
const probe = join(import.meta.dirname, 'probe-packed-runtime.cjs')
const result = spawnSync(executable, [probe, app], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  timeout: 45_000,
  windowsHide: true,
})
if (result.error !== undefined || result.status !== 0) {
  throw new Error(`packaged Electron runtime probe failed: ${result.error?.message ?? result.stderr ?? `exit ${String(result.status)}`}`)
}
process.stdout.write(result.stdout)
console.log(`desktop packed dependencies: ${Object.keys(manifest.dependencies ?? {}).length} roots, enhanced plugins, Codex provider, and x64 runtime payloads are verified.`)

/** Verify one copied optional package's identity, target, and PE payload kinds. */
function verifyPlatformPackage(alias, expectedName, extensions) {
  const directory = join(app, 'node_modules', ...alias.split('/'))
  const packagePath = join(directory, 'package.json')
  if (!existsSync(packagePath)) throw new Error(`packaged optional dependency is missing: ${alias}`)
  const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (packageManifest.name !== expectedName || !packageManifest.os?.includes('win32') || !packageManifest.cpu?.includes('x64')) {
    throw new Error(`${alias} has the wrong package identity or platform`)
  }
  for (const extension of extensions) verifyNativeX64(directory, `${alias} ${extension}`, extension)
}

/** Find a Windows x64 native addon and reject a non-AMD64 PE payload. */
function verifyNativeX64(directory, name, extension = '.node') {
  const entries = walk(directory).filter(path => path.endsWith(extension))
  if (entries.length === 0) throw new Error(`${name} has no ${extension} payload`)
  const wrong = entries.filter(path => peMachine(path) !== 0x8664)
  if (wrong.length > 0) throw new Error(`${name} contains a non-x64 PE payload: ${wrong.join(', ')}`)
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
