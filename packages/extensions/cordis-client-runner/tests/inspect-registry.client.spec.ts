import { describe, expect, it, vi } from 'vitest'
import { ClientCordisInspectRegistry } from '../src/client/inspect-registry.ts'

describe('ClientCordisInspectRegistry', () => {
  it('does not publish a manifest after its page registry is disposed', async () => {
    const sync = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const registry = new ClientCordisInspectRegistry({ sync, resolve: async () => {} })

    registry.register({
      manifest: { id: 'fixture', description: 'fixture provider', methods: [] },
      query: async () => null,
    })
    registry.dispose()
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })

    expect(sync).not.toHaveBeenCalled()
  })

  it('does not report a sync that fails after the page registry is disposed', async () => {
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const sync = vi.fn(async () => {
      started.resolve(undefined)
      await release.promise
      throw new Error('carrier retired')
    })
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = new ClientCordisInspectRegistry({ sync, resolve: async () => {} })

    registry.register({
      manifest: { id: 'fixture', description: 'fixture provider', methods: [] },
      query: async () => null,
    })
    await started.promise
    registry.dispose()
    release.resolve(undefined)
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(reported).not.toHaveBeenCalled()
    reported.mockRestore()
  })
})
