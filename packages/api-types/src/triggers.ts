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
}

export interface ListTriggerDispatchesResponse {
  dispatches: TriggerDispatch[]
}
