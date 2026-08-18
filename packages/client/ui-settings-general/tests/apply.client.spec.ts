/** Ownerless-copy registrations: the five seats, dictionaries, thunked labels, and HMR recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from '../src/client/SettingsDocumentAction.tsx'
import { VersionRow } from '../src/client/VersionRow.tsx'
import { createVersionRowStore } from '../src/client/version-row-store.ts'
import { DiagnosticsSection } from '../src/client/DiagnosticsSection.tsx'
import { createDiagnosticsStore } from '../src/client/diagnostics-store.ts'
import type { AssemblyService } from '@deepseek-ai/dsh-client-runtime/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

/** The seats this plugin fills for a loopback browser (slot name → expected component). */
const SEATS = [
  ['settings.trigger', TriggerContent],
  ['settings.header', HeaderContent],
  ['settings.action', SettingsDocumentAction],
  ['settings.close', CloseLabel],
  ['settings.section', GeneralSection],
] as const

async function bench(isLoopback = true, assembly?: AssemblyService) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const settingsDescribe = vi.fn(() => Promise.resolve({
    rpcId: 'settings-general' as never,
    result: {
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [],
      },
    },
  }))
  const settingsOpenDocument = vi.fn(() => Promise.resolve({
    rpcId: 'settings-open' as never,
    result: { ok: true as const, value: { opened: true as const } },
  }))
  ctx.provide('connection', {
    api: { settings: { describe: settingsDescribe, openDocument: settingsOpenDocument } },
    isLoopback,
    hostDescription: {
      getSnapshot: () => currentDescription,
      subscribe: () => () => {},
    },
  } as never)
  if (assembly !== undefined) ctx.provide('assembly', assembly)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, settingsDescribe, settingsOpenDocument }
}

/** The host_description the bench connection reports; set by each test. */
let currentDescription: { version: string; commit?: string; buildHash?: string; schemaVersion?: number } | undefined

/** Declare the shell's six child slots the way ui-settings' entry does. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

function generalEntry(slots: SlotRegistry) {
  return slots.entries('settings.section').find(e => e.component === GeneralSection)
}

describe('ui-settings-general apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('fills all five seats for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    for (const [name, component] of SEATS) {
      expect(before.slots.entries(name)[0]!.component).toBe(component)
    }
    const entry = generalEntry(before.slots)!
    expect(entry.options).toMatchObject({ id: 'general', order: 0 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('通用设置')
    expect(before.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    // The shell's own read-only Version row is the sole item it sits.
    expect(before.slots.entries('settings.general.item').map(e => e.options.id)).toEqual(['about'])
    // The onboarding hole stays declared for feature-owned steps; this plugin
    // no longer seats one.
    expect(before.slots.entries('settings.onboarding')).toEqual([])
    const action = before.slots.entries('settings.action')[0]!
    const actionInjected = (action.inject as unknown as () => SettingsDocumentActionInjected)()
    expect(actionInjected.controller.store.getSnapshot().status).toBe('idle')
    expect(actionInjected.useSnapshot).toEqual(expect.any(Function))
    // Copy rides the standard locale seat: every seat declares the namespace.
    for (const [name] of SEATS) {
      expect(before.slots.entries(name)[0]!.locale).toBe('settings')
    }
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const [name] of SEATS) expect(after.slots.entries(name)).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    for (const [name, component] of SEATS) {
      expect(after.slots.entries(name)[0]!.component).toBe(component)
      // The self-inflicted ledger notifications hit the duplicate guard.
      // settings.section carries two ownerless sections (general + diagnostics).
      const expectedCount = name === 'settings.section' ? 2 : 1
      if (name === 'settings.section') {
        expect(after.slots.entries(name)[0]!.options.id).toBe('general')
      }
      expect(after.slots.entries(name)).toHaveLength(expectedCount)
    }
    await vi.waitFor(() => {
      expect(after.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    })
  })

  it('registers the zh/en settings dictionaries and frees the seats on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings')('title')).toBe('设置')
    b.locale.setLocale('en')
    expect(b.locale.bind('settings')('close')).toBe('Close')
    b.locale.setLocale('zh')
    await fiber.dispose()
    // The (ns, locale) seats are free again — the dictionary disposer ran.
    expect(() => b.locale.register('settings', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings', 'en', {})).not.toThrow()
  })

  it('the nav label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const zhVersions = SEATS.map(([name]) => b.slots.getVersion(name))
    b.locale.setLocale('en')
    // No ledger churn: freshness rides the thunk (and the renderer's locale
    // subscription), not re-registration.
    SEATS.forEach(([name], i) => {
      expect(b.slots.getVersion(name)).toBe(zhVersions[i]!)
      // settings.section carries two ownerless sections (general + diagnostics).
      expect(b.slots.entries(name)).toHaveLength(name === 'settings.section' ? 2 : 1)
    })
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('General')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('通用设置')
  })

  it('refreshes loaded document availability on reconnect without reading it eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.action')[0]!
    const { controller } = (entry.inject as unknown as () => SettingsDocumentActionInjected)()
    b.ctx.emit('connection/reset')
    expect(b.settingsDescribe).not.toHaveBeenCalled()
    await controller.load()
    expect(b.settingsDescribe).toHaveBeenCalledOnce()
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledTimes(2) })
  })

  it('withholds the loopback-only document action off-loopback', async () => {
    const b = await bench(false)
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.action')).toEqual([])
    expect(b.settingsDescribe).not.toHaveBeenCalled()
    await fiber.dispose()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toEqual([])
  })

  it('re-registers after an HMR collapse of the declaring chain (stale disposers must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Declarer unload: the cascade removes every seat entry and the item
    // declaration while our local disposers go stale.
    redeclare()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    expect(b.slots.spec('settings.general.item')).toBeUndefined()
    declare(b.slots)
    await Promise.resolve()
    for (const [name, component] of SEATS) {
      expect(b.slots.entries(name)[0]!.component).toBe(component)
    }
    expect(b.slots.entries('settings.general.item').map(e => e.options.id)).toEqual(['about'])
    expect(b.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    // The recovered registrations still ride the locale path.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(generalEntry(b.slots)!.options.label)).toBe('General')
    b.locale.setLocale('zh')
  })

  it('removes every seat and the item declaration on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.spec('settings.general.item')).toBeDefined()
    await fiber.dispose()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    expect(b.slots.spec('settings.general.item')).toBeUndefined()
  })

  it('registers the read-only Version row and mirrors host description facts', async () => {
    currentDescription = { version: '0.1.0-rc.5', commit: 'abc123', buildHash: 'sha', schemaVersion: 3 }
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.general.item').find(e => e.options.id === 'about')!
    expect(entry.component).toBe(VersionRow)
    expect(entry.options).toMatchObject({ id: 'about', order: 100 })
    expect(entry.locale).toBe('settings')
    const store = (entry.store as ReturnType<typeof createVersionRowStore>).create()
    ;(entry.inject as (actions: typeof store.actions) => object)(store.actions)
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      version: '0.1.0-rc.5',
      commit: 'abc123',
      buildHash: 'sha',
      schemaVersion: 3,
    })
  })

  it('withholds read-only Version facts until a host description is published', async () => {
    currentDescription = undefined
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.general.item').find(e => e.options.id === 'about')!
    const store = (entry.store as ReturnType<typeof createVersionRowStore>).create()
    ;(entry.inject as (actions: typeof store.actions) => object)(store.actions)
    expect(store.getSnapshot()).toEqual({
      status: 'idle',
      version: '',
      commit: undefined,
      buildHash: undefined,
      schemaVersion: undefined,
    })
  })

  it('registers the Diagnostics section and mirrors host identity + assembly', async () => {
    currentDescription = { version: '0.1.0-rc.5', commit: 'abc123', buildHash: 'sha', schemaVersion: 3 }
    const seams = [{ name: 'root', kind: 'single', scope: 'root', occupants: [], maturity: 0 }]
    const assembly: AssemblyService = {
      getSnapshot: () => ({ seams, seamCount: 1, occupantCount: 0 }),
      subscribe: () => () => {},
    }
    const b = await bench(true, assembly)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section').find(e => e.options.id === 'diagnostics')!
    expect(entry.component).toBe(DiagnosticsSection)
    expect(entry.options).toMatchObject({ id: 'diagnostics', order: 10 })
    expect(entry.locale).toBe('settings')
    const store = (entry.store as ReturnType<typeof createDiagnosticsStore>).create()
    ;(entry.inject as (actions: typeof store.actions) => object)(store.actions)
    expect(store.getSnapshot()).toEqual({
      status: 'ready',
      version: '0.1.0-rc.5',
      commit: 'abc123',
      buildHash: 'sha',
      schemaVersion: 3,
      seams,
      seamCount: 1,
      occupantCount: 0,
    })
  })

  it('registers the Diagnostics section with an empty assembly when no runtime service is composed', async () => {
    currentDescription = { version: '0.1.0-rc.5' }
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section').find(e => e.options.id === 'diagnostics')!
    expect(entry.component).toBe(DiagnosticsSection)
    const store = (entry.store as ReturnType<typeof createDiagnosticsStore>).create()
    ;(entry.inject as (actions: typeof store.actions) => object)(store.actions)
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      version: '0.1.0-rc.5',
      seams: [],
      seamCount: 0,
      occupantCount: 0,
    })
  })
})
