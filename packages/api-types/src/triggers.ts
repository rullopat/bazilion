import type { AgentTrigger, TriggerDispatch, TriggerKind } from './entities.ts'

/** When a schedule runs: one of the three kinds and the field it needs. */
export type TriggerTiming =
  | { kind: 'interval'; intervalSec: number }
  /** A 5-field expression ("m h dom mon dow") on the daemon's clock. */
  | { kind: 'cron'; cronExpr: string }
  /** Once, at this time (ms since the epoch); it must be in the future. */
  | { kind: 'once'; runAt: number }

export interface CreateTriggerRequest {
  kind: TriggerKind
  /** required when kind='interval' */
  intervalSec?: number
  /** required when kind='cron' — 5-field expression ("m h dom mon dow") */
  cronExpr?: string
  /** required when kind='once': ms since the epoch, in the future */
  runAt?: number
  /** injected as the user message when the trigger fires */
  message: string
  enabled?: boolean
}

/** Any of the fields; a new timing gives `kind` with the field it needs, as on create. */
export interface UpdateTriggerRequest {
  enabled?: boolean
  message?: string
  kind?: TriggerKind
  intervalSec?: number
  cronExpr?: string
  runAt?: number
}

export interface UpdateTriggerResponse {
  trigger: AgentTrigger
}

export interface CreateTriggerResponse {
  trigger: AgentTrigger
}

export interface ListTriggersResponse {
  triggers: AgentTrigger[]
  dispatches: TriggerDispatch[]
  /** When each trigger runs next, by id; null while it is paused or when it never matches. */
  nextRuns: Record<string, number | null>
  /** The daemon runs no schedules (`BAZILION_SCHEDULER=off`): none of them runs. */
  schedulerOff: boolean
}

export interface ListTriggerDispatchesResponse {
  dispatches: TriggerDispatch[]
}
