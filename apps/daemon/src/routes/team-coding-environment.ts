// /api/teams/:id/coding-environment: the Team's Docker sandbox defaults (image and working
// directory), used when BAZILION_BASH_SANDBOX=docker.

import { mergeSecretsIntoEnv } from '../core/index.ts'
import { codingEnvironmentStatus, setTeamCodingEnvironment } from '../lib/coding-environment.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter, routeTeam } from './http.ts'

export const teamCodingEnvironmentRouter = newRouter()

teamCodingEnvironmentRouter.get('/:id/coding-environment', (c) => {
  const { db, authToken } = getCtx()
  return c.json(codingEnvironmentStatus(db, routeTeam(c).id, mergeSecretsIntoEnv(db, authToken)))
})

teamCodingEnvironmentRouter.put('/:id/coding-environment', async (c) => {
  const { db, authToken } = getCtx()
  const team = routeTeam(c)
  // The body is validated by setTeamCodingEnvironment.
  const body: unknown = await c.req.json().catch(() => null)
  return c.json(setTeamCodingEnvironment(db, team, body, mergeSecretsIntoEnv(db, authToken)))
})
