import type { AgentTrigger, TriggerDispatch } from './entities.ts'

export interface CreateTriggerRequest {
  kind: 'interval' | 'cron'
  /** required when kind='interval' */
  intervalSec?: number
  /** required when kind='cron' — 5-field expression ("m h dom mon dow") */
  cronExpr?: string
  /** injected as the user message when the trigger fires */
  message: string
  enabled?: boolean
}

export interface UpdateTriggerRequest {
  enabled?: boolean
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
