/**
 * Verify the Electron package's full workspace runtime closure.
 *
 * electron-builder copies declared application dependencies and their regular
 * dependencies. Cordis Service Definitions are often peers, so a reachable
 * peer must also be an app dependency or a packaged Host can fail only at
 * startup. `--write` adds the missing workspace package names in sorted order.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MANIFEST_PATH = join(ROOT, 'apps', 'desktop', 'package.json')
const LOCAL_RUNTIME_ROOTS = [
  '@dsh-local/appearance-studio',
  '@dsh-local/deepseek-balance',
  '@dsh-local/enhanced-distribution',
  '@dsh-local/operations-center',
]

/** Read a JSON manifest with the subset used for dependency traversal. */
function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Add a package directory to the workspace name-to-directory lookup. */
function addPackage(map, directory) {
  const path = join(directory, 'package.json')
  try {
    if (!statSync(path).isFile()) return
  } catch {
    return
  }
  const name = manifest(path).name
  if (typeof name === 'string') map.set(name, directory)
}

/** Locate every dependency-bearing package maintained by this workspace. */
function workspaceMap() {
  const byName = new Map()
  for (const entry of readdirSync(join(ROOT, 'vendor'))) {
    const directory = join(ROOT, 'vendor', entry)
    if (statSync(directory).isDirectory()) addPackage(byName, directory)
  }
  for (const group of readdirSync(join(ROOT, 'packages'))) {
    const groupDirectory = join(ROOT, 'packages', group)
    if (!statSync(groupDirectory).isDirectory()) continue
    for (const entry of readdirSync(groupDirectory)) {
      const directory = join(groupDirectory, entry)
      if (statSync(directory).isDirectory()) addPackage(byName, directory)
    }
  }
  return byName
}

/** Compute the reachable internal packages through ordinary and peer edges. */
function closure(manifestValue, byName) {
  const queue = Object.keys(manifestValue.dependencies ?? {}).filter(name => byName.has(name))
  const seen = new Set()
  const reachable = new Set()
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    const directory = byName.get(name)
    if (directory === undefined) continue
    const dependencyManifest = manifest(join(directory, 'package.json'))
    for (const dependency of [
      ...Object.keys(dependencyManifest.dependencies ?? {}),
      ...Object.keys(dependencyManifest.peerDependencies ?? {}),
    ]) {
      if (!dependency.startsWith('@deepseek-ai/') || !byName.has(dependency)) continue
      reachable.add(dependency)
      queue.push(dependency)
    }
  }
  return reachable
}

const desktopManifest = manifest(MANIFEST_PATH)
const dependencies = desktopManifest.dependencies ?? {}
const missingLocalRoots = LOCAL_RUNTIME_ROOTS.filter(name => dependencies[name] === undefined)
const reachable = closure(desktopManifest, workspaceMap())
const missingWorkspace = [...reachable].filter(name => dependencies[name] === undefined).sort()

if (process.argv.includes('--write')) {
  if (missingLocalRoots.length > 0) {
    throw new Error(`desktop local runtime roots must be declared explicitly: ${missingLocalRoots.join(', ')}`)
  }
  if (missingWorkspace.length > 0) {
    desktopManifest.dependencies = Object.fromEntries([
      ...Object.entries(dependencies),
      ...missingWorkspace.map(name => [name, 'workspace:^']),
    ].sort(([left], [right]) => left.localeCompare(right)))
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(desktopManifest, null, 2)}\n`)
  }
} else if (missingLocalRoots.length > 0 || missingWorkspace.length > 0) {
  if (missingLocalRoots.length > 0) console.error(`desktop pack dependencies lack local runtime roots: ${missingLocalRoots.join(', ')}`)
  if (missingWorkspace.length > 0) {
    console.error(`desktop pack dependencies lack ${missingWorkspace.length} workspace package(s):`)
    for (const name of missingWorkspace) console.error(`  ${name}`)
  }
  console.error('run pnpm --filter @deepseek-ai/dsh-desktop run sync-pack-deps to update the workspace closure.')
  process.exitCode = 1
} else {
  console.log(`desktop pack dependencies: ${reachable.size} workspace packages and ${LOCAL_RUNTIME_ROOTS.length} local runtime roots are closed.`)
}
