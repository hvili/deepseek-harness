import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  CODEX_RUNTIME_VERSION,
  CodexAppServerClient,
  codexAppServerArgv,
  codexAppServerSchemaArgv,
} from '../src/index.ts'

async function turn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('Codex app-server client', () => {
  it('performs exactly one stable initialize handshake', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let sent = ''
    output.setEncoding('utf8')
    output.on('data', (chunk: string) => { sent += chunk })
    const client = new CodexAppServerClient(input, output)
    client.start()
    const initialized = client.initialize({
      name: 'deepseek-harness',
      title: 'DeepSeek Harness',
      version: '0.1.1-rc.2',
    }, { requestAttestation: false })
    await turn()
    const request = JSON.parse(sent.trim()) as { id: string; params: Record<string, unknown> }
    expect(request.params).toMatchObject({ capabilities: { experimentalApi: false, requestAttestation: false } })
    input.write(`${JSON.stringify({ id: request.id, result: { userAgent: 'fixture' } })}\n`)
    await expect(initialized).resolves.toEqual({ userAgent: 'fixture' })
    expect(sent.trim().split('\n').map(line => JSON.parse(line) as unknown)).toHaveLength(2)
    await expect(client.initialize({ name: 'x', title: 'x', version: 'x' }, {}))
      .rejects.toThrow('already initialized')
    client.close()
  })

  it('pins the package-local runtime and stable schema commands', () => {
    expect(CODEX_RUNTIME_VERSION).toBe('0.147.0')
    expect(codexAppServerArgv().slice(-2)).toEqual(['app-server', '--stdio'])
    expect(codexAppServerSchemaArgv('json-schema', 'schema')).toEqual([
      expect.any(String),
      expect.any(String),
      'app-server',
      'generate-json-schema',
      '--out',
      'schema',
    ])
    expect(codexAppServerSchemaArgv('typescript', 'schema', true).at(-1)).toBe('--experimental')
  })
})
