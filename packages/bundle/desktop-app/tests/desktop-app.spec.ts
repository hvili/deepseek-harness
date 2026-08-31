import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop app bundle', () => {
  it('declares the zero-port desktop overlay and interactive lock', () => {
    const root = resolve(import.meta.dirname, '..')
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: '@deepseek-ai/dsh-host-desktop-carrier'")
    expect(patch).toContain('port: 0')
    expect(patch).toContain('id: client-hmr\n  disabled: true')
    expect(patch).toContain("name: '@deepseek-ai/dsh-client-connection/desktop'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-host-instance-lock'")
    expect(patch).toContain('mode: desktop')
  })
})
