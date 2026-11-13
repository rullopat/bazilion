// /api/teams: the Team registry and each Team's USER.md. Every other /api/teams/:id/* feature has
// its own router (team-memory, team-policy, team-review, team-coding-environment, telegram).

import type { RegisterTeamRequest, SetTeamUserMdRequest } from '@bazilion/api-types'
import { deleteTeam, registerTeam, teamRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
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

teamsRouter.get('/:id', (c) => c.json(routeTeam(c)))

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
  const { id } = routeTeam(c)
  teamRepo.setUserMd(db, id, body.userMd)
  return c.json(teamRepo.get(db, id, paths))
})
