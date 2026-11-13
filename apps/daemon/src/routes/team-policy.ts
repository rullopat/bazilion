// /api/teams/:id/policy: who may message whom inside a Team (mode plus allow edges), and saving a
// live Team as a reusable template.

import type { SaveTeamAsTemplateRequest, UpdateTeamPolicyRequest } from '@bazilion/api-types'
import { saveTeamAsTemplate, teamPolicyRepo } from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter } from './http.ts'

export const teamPolicyRouter = newRouter()

teamPolicyRouter.get('/:id/policy', (c) => {
  const policy = teamPolicyRepo.get(getCtx().db, c.req.param('id'))
  if (!policy) return c.json({ error: `team not found: ${c.req.param('id')}` }, 404)
  return c.json(policy)
})

teamPolicyRouter.patch('/:id/policy', async (c) => {
  const body = await jsonBody<UpdateTeamPolicyRequest>(c)
  if (!body || (body.mode === undefined && body.edges === undefined)) {
    return c.json({ error: 'mode or edges is required' }, 400)
  }
  return c.json(
    teamPolicyRepo.update(getCtx().db, c.req.param('id'), {
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.edges !== undefined ? { edges: body.edges } : {}),
    }),
  )
})

teamPolicyRouter.post('/:id/policy/save-as-template', async (c) => {
  const body = await jsonBody<SaveTeamAsTemplateRequest>(c)
  const templateId = typeof body?.id === 'string' ? body.id.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!templateId || !name) return c.json({ error: 'id and name are required' }, 400)
  validateSlug(templateId)
  const { db, paths } = getCtx()
  return c.json(saveTeamAsTemplate(db, paths, c.req.param('id'), { id: templateId, name }), 201)
})
