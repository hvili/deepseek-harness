/**
 * Capability assembly contract: the observable snapshot of what this client
 * is actually composed of — every live slot seam and the entries occupying
 * it — sourced from the SlotRegistry's JSON-safe declaration tree. This is
 * the "由什么组成" answer the diagnostic page and any future handshake share.
 *
 * The registry is the one truth: plugins register seams and occupants through
 * it, so snapping its tree yields the real assembly (no host-call mirror to
 * drift). The service recomputes on every `slots/changed` event and publishes
 * through a snapshot store; the UI reads it via the standard selector hook.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LiveSlotNode } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from './store.ts'

/** Who contributed a seam occupant: the framework/leger (builtin) or a named registrant (plugin). */
export type AssemblySource = 'builtin' | 'plugin'

/** One registered entry occupying a seam (the JSON-safe occupant view). */
export interface AssemblyOccupant {
  /** Plugin or package that registered the entry, when known; absent = builtin. */
  registrant?: string
  /** Keyed-slot cell. */
  key?: string
  /** List-slot cell. */
  id?: string
  /** List display order. */
  order?: number
  /** Shadowing or chain priority. */
  priority: number
  /** Whether the renderer currently selects this entry. */
  active: boolean
  /** Derived provenance: a named registrant counts as a plugin contribution. */
  source: AssemblySource
}

/** One live slot seam with the occupants mounted in it and a maturity ordinal. */
export interface CapabilitySeam {
  /** Exact SlotMap key. */
  name: string
  /** Slot cardinality. */
  kind: string
  /** Runtime data scope. */
  scope: string
  /** Diagnostic owner of this declaration; absent for the built-in root. */
  declaredBy?: string
  /** Current registrations sorted in ledger order. */
  occupants: AssemblyOccupant[]
  /**
   * Composition maturity, 0–5, a monotonic ladder over the seam's profile:
   * 0 = declared but empty; 1 = composed; +1 each for session scope,
   * additive (list) cardinality, a named declarer, and nested child seams.
   * Higher does not mean "better" — it means "more richly assembled".
   */
  maturity: number
}

/** The observable assembly snapshot: the flat seam list plus quick totals. */
export interface CapabilityAssemblySnapshot {
  /** Every live seam, tree-ordered (parents before their children). */
  seams: CapabilitySeam[]
  /** Total seam count. */
  seamCount: number
  /** Total occupant count across all seams. */
  occupantCount: number
}

/** The outward assembly service: an observable snapshot over the SlotRegistry tree. */
export interface AssemblyService {
  /** Read the current assembly snapshot. */
  getSnapshot(): CapabilityAssemblySnapshot
  /** Subscribe to assembly changes. */
  subscribe(listener: () => void): () => void
}

/** Derive an occupant's provenance from its registrant stamp. */
function sourceOf(registrant: string | undefined): AssemblySource {
  return registrant === undefined ? 'builtin' : 'plugin'
}

/** Compute a seam's maturity ordinal from its declaration profile (see {@link CapabilitySeam.maturity}). */
function maturityOf(seam: {
  occupants: readonly AssemblyOccupant[]
  kind: string
  scope: string
  declaredBy: string | undefined
  hasChildren: boolean
}): number {
  if (seam.occupants.length === 0) return 0
  let maturity = 1
  if (seam.scope === 'session') maturity = Math.max(maturity, 2)
  if (seam.kind === 'list') maturity = Math.max(maturity, 3)
  if (seam.declaredBy !== undefined) maturity = Math.max(maturity, 4)
  if (seam.hasChildren) maturity = Math.max(maturity, 5)
  return maturity
}

/** Project one live slot node into a seam (recursing through its children). */
function project(node: LiveSlotNode, out: CapabilitySeam[], totals: { occupants: number }): void {
  const occupants: AssemblyOccupant[] = node.occupants.map((o) => {
    totals.occupants += 1
    return {
      ...(o.registrant === undefined ? {} : { registrant: o.registrant }),
      ...(o.key === undefined ? {} : { key: o.key }),
      ...(o.id === undefined ? {} : { id: o.id }),
      ...(o.order === undefined ? {} : { order: o.order }),
      priority: o.priority,
      active: o.active,
      source: sourceOf(o.registrant),
    }
  })
  out.push({
    name: node.name,
    kind: node.kind,
    scope: node.scope,
    ...(node.declaredBy === undefined ? {} : { declaredBy: node.declaredBy }),
    occupants,
    maturity: maturityOf({
      occupants,
      kind: node.kind,
      scope: node.scope,
      declaredBy: node.declaredBy,
      hasChildren: node.children.length > 0,
    }),
  })
  for (const child of node.children) project(child, out, totals)
}

/** Initial (empty) snapshot. */
function initAssembly(): CapabilityAssemblySnapshot {
  return { seams: [], seamCount: 0, occupantCount: 0 }
}

/**
 * Create the assembly service over a context's SlotRegistry. Recomputes the
 * snapshot on every `slots/changed` event; the listener rides the apply fiber
 * and is disposed with it.
 * @param ctx - client root context (must mount the slots service).
 * @returns the observable assembly service.
 */
export function createAssemblyService(ctx: Context): AssemblyService {
  const store: SnapshotStore<CapabilityAssemblySnapshot> = createSnapshotStore(initAssembly())
  let slots: { snapshot(): LiveSlotNode[] } | undefined
  const refresh = (): void => {
    slots ??= ctx.get('slots') as { snapshot(): LiveSlotNode[] } | undefined
    if (slots === undefined) return
    const seams: CapabilitySeam[] = []
    const totals = { occupants: 0 }
    for (const node of slots.snapshot()) project(node, seams, totals)
    store.set({ seams, seamCount: seams.length, occupantCount: totals.occupants })
  }
  refresh()
  ctx.on('slots/changed', refresh)
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
  }
}