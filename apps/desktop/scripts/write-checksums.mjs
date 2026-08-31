/** Write SHA-256 checksums for the Windows desktop delivery artifacts. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const output = resolve(process.argv[2] ?? '')
const { version } = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
const artifacts = [
  join(output, `DeepSeek-Harness-${version}-win-x64.exe`),
  join(output, `DeepSeek-Harness-${version}-win-x64.zip`),
]

/** Calculate one file's lowercase SHA-256 digest. */
async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const lines = []
for (const artifact of artifacts) lines.push(`${await sha256(artifact)}  ${basename(artifact)}`)
const target = join(output, 'SHA256SUMS.txt')
const temporary = `${target}.${process.pid}.tmp`
await writeFile(temporary, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
await rename(temporary, target)
console.log(`desktop checksums: wrote ${target}`)
