// The daemon side of `schedule_add`, `schedule_list` and `schedule_remove`: the turn's Agent's
// schedules, bound to that Agent and the conversation the turn continues.

import type { AgentTrigger, TriggerTiming } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import { DomainError } from '../core/errors.ts'
import * as triggerRepo from '../core/repos/triggers.ts'
import type {
  ScheduleAddArgs,
  ScheduleEntry,
  ScheduleHost,
} from '../runtime/worker/ipc-protocol.ts'
import { signalLiveChange } from './live-signal.ts'
import { nextRunAt, triggerTiming } from './trigger-timing.ts'

const MINUTE_MS = 60_000

/**
 * A time the Agent wrote: "2026-11-28 09:00" (seconds optional, a T instead of the space) on the
 * daemon's clock, or an ISO time with an offset. A local time the clock skips (a daylight-saving
 * change) is refused rather than moved.
 */
export function parseScheduleTime(text: string): number {
  const trimmed = text.trim()
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (local) {
    const [year, month, day, hour, minute, second] = local.slice(1).map((part) => Number(part ?? 0))
    const date = new Date(
      year as number,
      (month as number) - 1,
      day as number,
      hour as number,
      minute as number,
      second ?? 0,
    )
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== (month as number) - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute
    ) {
      throw new DomainError(400, `${trimmed} is not a time on this computer's clock`)
    }
    return date.getTime()
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const ms = Date.parse(trimmed)
    if (Number.isFinite(ms)) return ms
  }
  throw new DomainError(
    400,
    `write the time as YYYY-MM-DD HH:MM on this computer's clock, not "${trimmed}"`,
  )
}

/** The timing the Agent asked for; exactly one of at, in_minutes, every_minutes and cron. */
export function agentTiming(args: ScheduleAddArgs, now = Date.now()): TriggerTiming {
  const given = [
    args.at !== undefined,
    args.inMinutes !== undefined,
    args.everyMinutes !== undefined,
    args.cron !== undefined,
  ].filter(Boolean).length
  if (given !== 1) {
    throw new DomainError(400, 'give exactly one of at, in_minutes, every_minutes and cron')
  }
  if (args.at !== undefined) {
    return triggerTiming({ kind: 'once', runAt: parseScheduleTime(String(args.at)) }, now)
  }
  if (args.inMinutes !== undefined) {
    const minutes = Number(args.inMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new DomainError(400, 'in_minutes must be more than 0')
    }
    return { kind: 'once', runAt: Math.round(now + minutes * MINUTE_MS) }
  }
  if (args.everyMinutes !== undefined) {
    const minutes = Number(args.everyMinutes)
    if (!Number.isInteger(minutes) || minutes < 1) {
      throw new DomainError(400, 'every_minutes must be a whole number, at least 1')
    }
    return { kind: 'interval', intervalSec: minutes * 60 }
  }
  return triggerTiming({ kind: 'cron', cronExpr: args.cron }, now)
}

export function createScheduleHost(opts: {
  db: BazilionDb
  agentId: string
  conversationId: string
}): ScheduleHost {
  const { db, agentId, conversationId } = opts
  const schedulerOff = () => process.env.BAZILION_SCHEDULER === 'off'
  const entry = (trigger: AgentTrigger): ScheduleEntry => ({
    trigger,
    nextRunAt: schedulerOff() ? null : nextRunAt(trigger),
    here: trigger.conversationId === conversationId,
  })
  const own = (id: string) => {
    const trigger = triggerRepo.get(db, id)
    if (!trigger || trigger.agentId !== agentId) {
      throw new DomainError(404, `you have no schedule ${id}; schedule_list shows yours`)
    }
    return trigger
  }
  return {
    async add(args) {
      const message = typeof args.message === 'string' ? args.message.trim() : ''
      if (!message) throw new DomainError(400, 'message is required: what you get when it runs')
      const trigger = triggerRepo.insert(db, {
        agentId,
        ...agentTiming(args),
        message,
        conversationId,
        setBy: 'agent',
      })
      signalLiveChange()
      return entry(trigger)
    },
    async list() {
      return triggerRepo.listForAgent(db, agentId).map(entry)
    },
    async remove(id) {
      const trigger = own(id)
      if (trigger.setBy !== 'agent') {
        throw new DomainError(
          403,
          'the user set this schedule, so only they can change or remove it (in Schedules)',
        )
      }
      triggerRepo.remove(db, id)
      signalLiveChange()
      return entry(trigger)
    },
  }
}
