// /api/team-templates: reusable Team rosters (slots plus allow edges) and spawning them.

import type { SpawnTeamTemplateRequest, TeamTemplateInput } from '@bazilion/api-types'
import { spawnTeamTemplate, teamTemplateRepo } from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter } from './http.ts'

export const teamTemplatesRouter = newRouter()

teamTemplatesRouter.get('/', (c) => c.json(teamTemplateRepo.list(getCtx().db)))

teamTemplatesRouter.get('/:id', (c) => {
  const template = teamTemplateRepo.get(getCtx().db, c.req.param('id'))
  if (!template) return c.json({ error: 'team template not found' }, 404)
  return c.json(template)
})

teamTemplatesRouter.post('/', async (c) => {
  const body = await jsonBody<TeamTemplateInput>(c)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) return c.json({ error: 'id is required' }, 400)
  validateSlug(id)
  // The rest of the body is validated by the repo.
  return c.json(teamTemplateRepo.create(getCtx().db, id, body), 201)
})

teamTemplatesRouter.put('/:id', async (c) =>
  c.json(teamTemplateRepo.replace(getCtx().db, c.req.param('id'), await jsonBody(c))),
)

teamTemplatesRouter.delete('/:id', (c) => {
  if (!teamTemplateRepo.remove(getCtx().db, c.req.param('id'))) {
    return c.json({ error: 'team template not found' }, 404)
  }
  return c.body(null, 204)
})

teamTemplatesRouter.post('/:id/spawn', async (c) => {
  const body = await jsonBody<SpawnTeamTemplateRequest>(c)
  const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : ''
  if (!teamId) return c.json({ error: 'teamId is required' }, 400)
  const { db, paths } = getCtx()
  return c.json(
    spawnTeamTemplate(db, paths, {
      templateId: c.req.param('id'),
      teamId,
      ...(typeof body?.userMd === 'string' ? { userMd: body.userMd } : {}),
    }),
    201,
  )
})
