// /api/teams/:id/review: read-only Git change review of the Team workspace, and feedback about one
// changed file queued for a Team member. Inspection never mutates the repository.

import type { ReviewFeedbackRequest } from '@bazilion/api-types'
import { getCtx } from '../lib/ctx.ts'
import { FEEDBACK_NOTE_CHARS, queueReviewFeedback } from '../lib/git-review/feedback.ts'
import { readTeamReview } from '../lib/git-review/service.ts'
import { jsonBody, newRouter } from './http.ts'

export const teamReviewRouter = newRouter()

teamReviewRouter.get('/:id/review', async (c) => {
  const { db, paths } = getCtx()
  const base = c.req.query('base')
  const patchPath = c.req.query('path')
  if (patchPath !== undefined && (patchPath.length === 0 || patchPath.length > 4096)) {
    return c.json({ error: 'Invalid path' }, 400)
  }
  const review = await readTeamReview(db, paths, c.req.param('id'), {
    ...(base === undefined ? {} : { base }),
    patches: c.req.query('patches') === '1',
    ...(patchPath === undefined ? {} : { patchPath }),
  })
  return c.json(review)
})

// Composes "file, change, diff excerpt, note" and queues it for a Team member through the
// ordinary follow-up queue, so a busy Agent receives it as its next turn.
teamReviewRouter.post('/:id/review/feedback', async (c) => {
  const body = await jsonBody<ReviewFeedbackRequest>(c)
  if (
    !body ||
    typeof body.path !== 'string' ||
    body.path.length === 0 ||
    body.path.length > 4096 ||
    typeof body.agentId !== 'string' ||
    body.agentId.length === 0
  ) {
    return c.json({ error: 'path and agentId are required' }, 400)
  }
  if (
    body.note !== undefined &&
    (typeof body.note !== 'string' || body.note.length > FEEDBACK_NOTE_CHARS)
  ) {
    return c.json({ error: 'Invalid feedback note' }, 400)
  }
  if (body.base !== undefined && typeof body.base !== 'string') {
    return c.json({ error: 'Invalid comparison base' }, 400)
  }
  const { db, paths } = getCtx()
  const queued = await queueReviewFeedback(db, paths, c.req.param('id'), {
    path: body.path,
    agentId: body.agentId,
    ...(body.note === undefined ? {} : { note: body.note }),
    ...(body.base === undefined ? {} : { base: body.base }),
  })
  return c.json(queued, 202)
})
