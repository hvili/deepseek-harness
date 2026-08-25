import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../schema/stable-json-schema.manifest.json' with { type: 'json' }
import { CODEX_RUNTIME_VERSION, codexAppServerSchemaArgv } from '../src/index.ts'

function filesUnder(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name)
    return entry.isDirectory() ? filesUnder(root, path) : [path]
  })
}

describe('Codex stable schema gate', () => {
  it('matches the pinned runtime fingerprint', () => {
    const output = mkdtempSync(join(tmpdir(), 'dsh-codex-schema-'))
    try {
      const [executable, ...args] = codexAppServerSchemaArgv('json-schema', output)
      if (executable === undefined) throw new Error('schema command is empty')
      execFileSync(executable, args, { stdio: 'pipe' })
      const files = filesUnder(output).sort((left, right) => left.localeCompare(right))
      const aggregate = createHash('sha256')
      for (const file of files) {
        const name = relative(output, file).replaceAll('\\', '/')
        const fileHash = createHash('sha256').update(readFileSync(file)).digest('hex')
        aggregate.update(`${name}\n${fileHash}\n`)
      }
      expect(CODEX_RUNTIME_VERSION).toBe(manifest.codexRuntimeVersion)
      expect(files).toHaveLength(manifest.fileCount)
      expect(aggregate.digest('hex')).toBe(manifest.aggregateSha256)
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  }, 30_000)
})
