/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/**
 * One durable plan approval: the markdown plan the user approved and the
 * heading it was presented under. `seq` is the `plan/approved` event sequence,
 * so consumers can compare approval recency without reading the event stream.
 */
export interface ApprovedPlan {
  /** The plan's first markdown heading (any level), or `Plan` when it has none. */
  heading: string
  /** The complete plan markdown the user approved. */
  plan: string
  /** Session log sequence of the `plan/approved` event. */
  seq: number
}

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection targets a state other than `active`, has not
 * failed through its paired `command/done`, and no later `plan/mode` event has
 * recorded that state. `approved` is present after the first durable
 * `plan/approved` event and holds the latest approval. Capability absence
 * (plan-mode not composed) is the key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
  approved?: ApprovedPlan | undefined
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Plan collaboration state folded from the plan command lifecycle and `plan/mode` events. */
    plan: PlanProjection
  }
}
