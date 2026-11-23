// /api/usage: tokens and cost per day, Agent, Team and model, read from the saved conversations.

import { DomainError } from '../core/errors.ts'
import * as agentRepo from '../core/repos/agents.ts'
import * as teamRepo from '../core/repos/teams.ts'
import { getCtx } from '../lib/ctx.ts'
import { usageReport, validTimeZone } from '../lib/usage.ts'
import { newRouter } from './http.ts'

export const usageRouter = newRouter()

/** The longest period counted day by day; longer ones are `days=all`. */
export const MAX_USAGE_DAYS = 3660

usageRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  const rawDays = c.req.query('days') ?? '30'
  let days: number | null = null
  if (rawDays !== 'all') {
    days = Number(rawDays)
    if (!Number.isInteger(days) || days < 1 || days > MAX_USAGE_DAYS)
      throw new DomainError(400, `days must be a whole number from 1 to ${MAX_USAGE_DAYS}, or all`)
  }
  const rawZone = c.req.query('tz')
  const timeZone = rawZone
    ? validTimeZone(rawZone)
    : Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!timeZone) throw new DomainError(400, `unknown time zone: ${rawZone}`)
  const agentId = c.req.query('agent') || undefined
  const teamId = c.req.query('team') || undefined
  if (agentId && !agentRepo.get(db, agentId)) throw new DomainError(404, 'agent not found')
  if (teamId && !teamRepo.get(db, teamId, paths)) throw new DomainError(404, 'team not found')
  return c.json(usageReport(db, paths, { days, timeZone, agentId, teamId }))
})
