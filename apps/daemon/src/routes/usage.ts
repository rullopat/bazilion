// /api/usage: tokens and cost per day, Agent, Team and model, read from the saved conversations.

import { DomainError } from '../core/errors.ts'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import * as teamRepo from '../core/repos/teams.ts'
import { getCtx } from '../lib/ctx.ts'
import { planProviders, usageReport, validTimeZone } from '../lib/usage.ts'
import { newRouter, routeAgentRef } from './http.ts'

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
  // An Agent by id, unique name or id prefix, as everywhere else; the report filters by its id.
  const agentRef = c.req.query('agent')
  const agentId = agentRef ? routeAgentRef(agentRef).id : undefined
  const teamRef = c.req.query('team')
  const teamId = teamRef ? teamRepo.get(db, teamRef, paths)?.id : undefined
  if (teamRef && !teamId) throw new DomainError(404, `team not found: ${teamRef}`)
  const plans = planProviders(mergeSecretsIntoEnv(db, getCtx().authToken))
  return c.json(usageReport(db, paths, { days, timeZone, agentId, teamId, plans }))
})
