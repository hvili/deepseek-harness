/**
 * Capability assembly service account: it projects the SlotRegistry's live
 * slot tree into a seam/occupant snapshot, derives provenance and maturity,
 * and recomputes on every `slots/changed` event.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { FC } from 'react'
import { SlotRegistry } from '../src/client/slots.ts'
import { createAssemblyService } from '../src/client/contract/assembly.ts'

// Test-only slot keys (merged so registration accepts them).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    't.rows': { kind: 'list'; scope: 'root' }
    't.panel': { kind: 'single'; scope: 'session' }
  }
}

const C: FC<object> = () => null

interface ErasedService {
  register(options: object, component: unknown): () => void
}

interface Bench {
  ctx: Context
  erased: ErasedService
}

async function boot(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // Declare the test seams under the built-in root (single occupant = declarer).
  ;(ctx.slots as unknown as ErasedService).register({
    name: 'root',
    children: {
      't.rows': { kind: 'list', scope: 'root' },
      't.panel': { kind: 'single', scope: 'session' },
    },
  }, C)
  return { ctx, erased: ctx.slots as unknown as ErasedService }
}

describe('createAssemblyService', () => {
  it('seeds a snapshot from the live slot tree (root + declared seams, tree-ordered)', async () => {
    const b = await boot()
    const assembly = createAssemblyService(b.ctx)
    const snapshot = assembly.getSnapshot()
    // root first (parents before children), then the two child seams.
    expect(snapshot.seams.map(s => s.name)).toEqual(['root', 't.rows', 't.panel'])
    expect(snapshot.seamCount).toBe(3)
    expect(snapshot.occupantCount).toBe(1) // only the root occupant (the declarer)
    const root = snapshot.seams[0]!
    expect(root.kind).toBe('single')
    expect(root.scope).toBe('root')
    // root has nested child seams -> highest maturity.
    expect(root.maturity).toBe(5)
    // Empty child seams are not yet composed -> maturity 0 regardless of kind/scope.
    expect(snapshot.seams[1]!.maturity).toBe(0)
    expect(snapshot.seams[2]!.maturity).toBe(0)
  })

  it('recomputes on registration: occupants, provenance, and maturity follow the ledger', async () => {
    const b = await boot()
    const assembly = createAssemblyService(b.ctx)
    b.erased.register({ name: 't.rows', id: 'first', order: 1 }, C)
    b.erased.register({ name: 't.rows', id: 'second', order: 2 }, C)
    const rows = assembly.getSnapshot().seams.find(s => s.name === 't.rows')!
    expect(rows.occupants.map(o => o.id)).toEqual(['first', 'second'])
    // The root bench ctx fiber carries a name, so registrations stamp a
    // registrant -> plugin provenance.
    expect(rows.occupants.map(o => o.source)).toEqual(['plugin', 'plugin'])
    expect(assembly.getSnapshot().occupantCount).toBe(3) // root + two rows
    expect(rows.maturity).toBeGreaterThanOrEqual(3)
  })

  it('notifies subscribers on slot changes', async () => {
    const b = await boot()
    const assembly = createAssemblyService(b.ctx)
    let fired = 0
    const off = assembly.subscribe(() => { fired += 1 })
    b.erased.register({ name: 't.rows', id: 'x', order: 1 }, C)
    await Promise.resolve()
    expect(fired).toBe(1)
    off()
  })
})
