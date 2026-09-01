/** Stage Windows x64 optional payloads that pnpm keeps below their parents. */

import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Arch } from 'electron-builder'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAYLOADS = [
  {
    owner: 'packages/fs/fs-local',
    parent: 'koffi',
    optional: '@koromix/koffi-win32-x64',
  },
  {
    owner: 'packages/attachment/attachment-local',
    parent: 'sharp',
    optional: '@img/sharp-win32-x64',
  },
  {
    owner: 'packages/subagent/codex-app-server',
    parent: '@openai/codex',
    optional: '@openai/codex-win32-x64',
  },
  {
    owner: 'packages/fs/tool-fs-search',
    parent: '@vscode/ripgrep',
    optional: '@vscode/ripgrep-win32-x64',
  },
]

const CORDIS_PACKAGE = '@deepseek-ai/cordis'
const CORDIS_ALIAS = 'cordis'

/** Convert an npm package name to path segments below node_modules. */
function packageSegments(name) {
  return name.split('/')
}

/** Read one package manifest. */
async function manifest(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Stage an ESM alias without creating a second Cordis runtime identity. */
async function stageCordisAlias(nodeModules) {
  const sourceManifest = await manifest(join(nodeModules, ...packageSegments(CORDIS_PACKAGE), 'package.json'))
  if (sourceManifest.name !== CORDIS_PACKAGE || typeof sourceManifest.version !== 'string') {
    throw new Error(`packaged ${CORDIS_PACKAGE} manifest is invalid`)
  }

  const destination = join(nodeModules, CORDIS_ALIAS)
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'index.js'), `export * from '${CORDIS_PACKAGE}'\n`, 'utf8')
  await writeFile(
    join(destination, 'package.json'),
    `${JSON.stringify({
      name: CORDIS_ALIAS,
      version: sourceManifest.version,
      private: true,
      type: 'module',
      main: './index.js',
      exports: {
        '.': './index.js',
        './package.json': './package.json',
      },
      license: sourceManifest.license,
    }, null, 2)}\n`,
    'utf8',
  )
}

/** Locate the node_modules directory that owns one real package path. */
function owningNodeModules(packagePath) {
  let directory = dirname(packagePath)
  while (basename(directory) !== 'node_modules') {
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`cannot locate node_modules above ${packagePath}`)
    directory = parent
  }
  return directory
}

/** Resolve the real package identity and version named by an optional spec. */
function optionalIdentity(alias, spec) {
  if (!spec.startsWith('npm:')) return { name: alias, version: spec }
  const separator = spec.lastIndexOf('@')
  if (separator <= 4 || separator === spec.length - 1) {
    throw new Error(`desktop optional payload has an unsupported alias spec: ${alias} -> ${spec}`)
  }
  return { name: spec.slice(4, separator), version: spec.slice(separator + 1) }
}

/** Copy each reviewed Windows x64 optional package into packaged node_modules. */
export async function stageWindowsRuntime(appDirectory) {
  const nodeModules = join(appDirectory, 'node_modules')
  for (const payload of PAYLOADS) {
    const parentManifestPath = join(
      ROOT,
      payload.owner,
      'node_modules',
      ...packageSegments(payload.parent),
      'package.json',
    )
    const parentManifest = await manifest(parentManifestPath)
    const spec = parentManifest.optionalDependencies?.[payload.optional]
    if (typeof spec !== 'string') {
      throw new Error(`${payload.parent} does not declare ${payload.optional} as an optional dependency`)
    }

    const realParentManifestPath = await realpath(parentManifestPath)
    const sourceManifestPath = join(
      owningNodeModules(realParentManifestPath),
      ...packageSegments(payload.optional),
      'package.json',
    )
    const realSourceManifestPath = await realpath(sourceManifestPath)
    const sourceManifest = await manifest(realSourceManifestPath)
    const expected = optionalIdentity(payload.optional, spec)
    if (sourceManifest.name !== expected.name || sourceManifest.version !== expected.version) {
      throw new Error(
        `${payload.optional} resolved to ${String(sourceManifest.name)}@${String(sourceManifest.version)}; expected ${expected.name}@${expected.version}`,
      )
    }
    if (!sourceManifest.os?.includes('win32') || !sourceManifest.cpu?.includes('x64')) {
      throw new Error(`${payload.optional} is not a Windows x64 payload`)
    }

    const destination = join(nodeModules, ...packageSegments(payload.optional))
    await mkdir(dirname(destination), { recursive: true })
    await cp(dirname(realSourceManifestPath), destination, { recursive: true, force: true })
  }
  await stageCordisAlias(nodeModules)
  console.log(`desktop Windows runtime: staged ${PAYLOADS.length} optional x64 packages and the shared Cordis alias.`)
}

/** electron-builder hook for the Windows x64 unpacked application. */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  if (context.arch !== Arch.x64) throw new Error(`desktop Windows runtime requires electron-builder x64 arch, got ${String(context.arch)}`)
  await stageWindowsRuntime(join(context.appOutDir, 'resources', 'app'))
}
