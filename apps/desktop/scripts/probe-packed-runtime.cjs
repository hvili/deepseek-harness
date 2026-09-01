/** Load and exercise packaged native dependencies under Electron's Node runtime. */

const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { dirname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const app = resolve(process.argv[2] ?? '')
const appRequire = createRequire(join(app, 'package.json'))

function run(executable, args, name) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${name} failed: ${result.error?.message ?? result.stderr ?? `exit ${String(result.status)}`}`)
  }
  return result.stdout.trim()
}

function importPackage(name) {
  return import(pathToFileURL(appRequire.resolve(name)).href)
}

async function probePty(pty) {
  await new Promise((resolveProbe, reject) => {
    const child = pty.spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'echo dsh-pty-probe'], {
      cols: 80,
      rows: 24,
      cwd: app,
      env: { ComSpec: process.env.ComSpec ?? 'cmd.exe', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' },
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch (error) {
        reject(new Error(`node-pty probe timed out and cleanup failed: ${String(error)}`))
        return
      }
      reject(new Error('node-pty probe timed out'))
    }, 10_000)
    let output = ''
    child.onData(value => { output += value })
    child.onExit(({ exitCode }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (exitCode === 0 && output.includes('dsh-pty-probe')) resolveProbe()
      else reject(new Error(`node-pty probe failed with exit ${String(exitCode)}: ${output}`))
    })
  })
}

async function main() {
  const [legacyCordis, scopedCordis] = await Promise.all([
    importPackage('cordis'),
    importPackage('@deepseek-ai/cordis'),
  ])
  if (legacyCordis.Context !== scopedCordis.Context || legacyCordis.Service !== scopedCordis.Service) {
    throw new Error('packaged Cordis aliases do not share one runtime identity')
  }

  await Promise.all([
    importPackage('@dsh-local/appearance-studio'),
    importPackage('@dsh-local/deepseek-balance'),
    importPackage('@dsh-local/operations-center'),
    importPackage('@deepseek-ai/dsh-app-boot'),
    importPackage('@deepseek-ai/dsh-client-connection/desktop'),
    importPackage('@deepseek-ai/dsh-host-desktop-carrier'),
  ])

  const koffi = appRequire('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const getCurrentProcessId = kernel32.func('uint32 GetCurrentProcessId(void)')
  if (getCurrentProcessId() !== process.pid) throw new Error('koffi returned the wrong process id')

  const sharp = appRequire('sharp')
  const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000000' } }).png().toBuffer()
  if (image.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('sharp did not produce a PNG')

  await probePty(appRequire('node-pty'))

  const ripgrepEntry = appRequire.resolve('@vscode/ripgrep')
  const { rgPath } = await import(pathToFileURL(ripgrepEntry).href)
  const ripgrepVersion = run(rgPath, ['--version'], 'ripgrep')

  const codexManifest = appRequire.resolve('@openai/codex/package.json')
  const codexRequire = createRequire(codexManifest)
  const codexPlatformManifest = codexRequire.resolve('@openai/codex-win32-x64/package.json')
  const codexExecutable = join(dirname(codexPlatformManifest), 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
  const codexVersion = run(codexExecutable, ['--version'], 'Codex')

  console.log(`desktop packaged runtime: shared Cordis, enhanced plugins, desktop entries, koffi, sharp, node-pty, ${ripgrepVersion.split(/\r?\n/, 1)[0]}, and ${codexVersion} loaded.`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
