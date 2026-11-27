// /api/teams: the Team registry and each Team's USER.md. Every other /api/teams/:id/* feature has
// its own router (team-memory, team-policy, team-review, team-coding-environment, telegram).

import type {
  Agent,
  RegisterTeamRequest,
  SetOrderRequest,
  SetTeamUserMdRequest,
  TeamDayResponse,
} from '@bazilion/api-types'
import { agentRepo, deleteTeam, registerTeam, teamRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { startOfToday, teamDay } from '../lib/team-day.ts'
import { USER_MD_MAX_BYTES } from '../lib/user-md-host.ts'
import { jsonBody, newRouter, routeTeam } from './http.ts'

export const teamsRouter = newRouter()

teamsRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  return c.json(teamRepo.list(db, paths))
})

teamsRouter.post('/', async (c) => {
  const body = await jsonBody<RegisterTeamRequest>(c)
  if (typeof body?.id !== 'string') return c.json({ error: 'id is required' }, 400)
  const { db, paths } = getCtx()
  const team = registerTeam(db, { id: body.id, name: body.name, link: body.link }, paths)
  return c.json(team, 201)
})

/** The ids of an order body; null when it is not a list of non-empty strings. */
function orderIds(body: Partial<SetOrderRequest> | null): string[] | null {
  const ids = body?.ids
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.trim())) return null
  return ids.map((id) => id.trim())
}

// The order of the Teams in every list: those named first, the others after them as they were.
teamsRouter.put('/order', async (c) => {
  const ids = orderIds(await jsonBody<SetOrderRequest>(c))
  if (!ids) return c.json({ error: 'ids (a list of Team slugs) is required' }, 400)
  const { db, paths } = getCtx()
  const known = new Set(teamRepo.list(db, paths).map((team) => team.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) return c.json({ error: `No such Team: ${unknown.join(', ')}` }, 404)
  teamRepo.setOrder(db, ids)
  return c.json(teamRepo.list(db, paths))
})

// The order of one Team's Agents, by id, id prefix or name in the Team.
teamsRouter.put('/:id/agents/order', async (c) => {
  const ids = orderIds(await jsonBody<SetOrderRequest>(c))
  if (!ids) return c.json({ error: 'ids (a list of Agents) is required' }, 400)
  const { db } = getCtx()
  const team = routeTeam(c)
  const resolved: string[] = []
  const unknown: string[] = []
  for (const given of ids) {
    const agent: Agent | null =
      agentRepo.findByNameInTeam(db, team.id, given) ?? agentRepo.get(db, given)
    if (agent && agent.teamId === team.id) resolved.push(agent.id)
    else unknown.push(given)
  }
  if (unknown.length > 0)
    return c.json({ error: `No such Agent in ${team.name}: ${unknown.join(', ')}` }, 404)
  agentRepo.setOrderInTeam(db, team.id, resolved)
  return c.json(agentRepo.list(db).filter((agent) => agent.teamId === team.id))
})

teamsRouter.get('/:id', (c) => c.json(routeTeam(c)))

// The Team's day: hand-offs, replies, files, conversations worked in and what waits, since the
// start of the caller's day (`since`, epoch ms; this machine's midnight when absent).
teamsRouter.get('/:id/today', (c) => {
  const raw = c.req.query('since')
  const since = raw === undefined ? startOfToday() : Number(raw)
  if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'Invalid since' }, 400)
  const { db, paths } = getCtx()
  return c.json(teamDay(db, paths, routeTeam(c).id, since) satisfies TeamDayResponse)
})

teamsRouter.delete('/:id', (c) => {
  const { db, paths } = getCtx()
  deleteTeam(db, paths, routeTeam(c).id)
  return c.body(null, 204)
})

teamsRouter.put('/:id/user-md', async (c) => {
  const body = await jsonBody<SetTeamUserMdRequest>(c)
  if (typeof body?.userMd !== 'string') return c.json({ error: 'userMd (string) is required' }, 400)
  // USER.md is inlined into every member's system prompt.
  if (Buffer.byteLength(body.userMd, 'utf8') > USER_MD_MAX_BYTES) {
    return c.json({ error: `userMd exceeds ${USER_MD_MAX_BYTES}-byte cap` }, 413)
  }
  const { db, paths } = getCtx()
  const team = routeTeam(c)
  // The web editor says what it started from, so an Agent's write meanwhile is not lost.
  if (typeof body.expected === 'string' && team.userMd !== body.expected) {
    return c.json({ error: 'USER.md changed since you opened it', code: 'user_md_changed' }, 409)
  }
  teamRepo.setUserMd(db, team.id, body.userMd)
  return c.json(teamRepo.get(db, team.id, paths))
})
