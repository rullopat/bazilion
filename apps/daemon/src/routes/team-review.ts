// /api/teams/:id/review: read-only Git change review of the Team workspace, and review feedback
// (comments on changed files or lines) queued for a Team member. Inspection never mutates the
// repository.

import type { ReviewFeedbackComment, ReviewFeedbackRequest } from '@bazilion/api-types'
import { getCtx } from '../lib/ctx.ts'
import {
  FEEDBACK_COMMENTS,
  FEEDBACK_NOTE_CHARS,
  queueReviewFeedback,
} from '../lib/git-review/feedback.ts'
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
    authors: c.req.query('authors') === '1',
  })
  return c.json(review)
})

const validNote = (note: unknown): note is string | undefined =>
  note === undefined || (typeof note === 'string' && note.length <= FEEDBACK_NOTE_CHARS)

function validComment(value: unknown): value is ReviewFeedbackComment {
  const comment = (value ?? {}) as Partial<ReviewFeedbackComment>
  return (
    typeof comment.path === 'string' &&
    comment.path.length > 0 &&
    comment.path.length <= 4096 &&
    (comment.line === undefined || (Number.isSafeInteger(comment.line) && comment.line > 0)) &&
    validNote(comment.note)
  )
}

// Composes each comment's file, change, diff excerpt and note into one message and queues it for
// a Team member through the ordinary follow-up queue, so a busy Agent receives it as its next turn.
teamReviewRouter.post('/:id/review/feedback', async (c) => {
  const body = await jsonBody<ReviewFeedbackRequest>(c)
  if (!body || typeof body.agentId !== 'string' || body.agentId.length === 0) {
    return c.json({ error: 'agentId is required' }, 400)
  }
  if (
    !Array.isArray(body.comments) ||
    body.comments.length === 0 ||
    body.comments.length > FEEDBACK_COMMENTS ||
    !body.comments.every(validComment)
  ) {
    return c.json(
      { error: `comments must be 1 to ${FEEDBACK_COMMENTS} entries of { path, line?, note? }` },
      400,
    )
  }
  if (!validNote(body.note)) return c.json({ error: 'Invalid feedback note' }, 400)
  if (body.base !== undefined && typeof body.base !== 'string') {
    return c.json({ error: 'Invalid comparison base' }, 400)
  }
  const { db, paths } = getCtx()
  const queued = await queueReviewFeedback(db, paths, c.req.param('id'), {
    agentId: body.agentId,
    comments: body.comments.map((comment) => ({
      path: comment.path,
      ...(comment.line === undefined ? {} : { line: comment.line }),
      ...(comment.note === undefined ? {} : { note: comment.note }),
    })),
    ...(body.note === undefined ? {} : { note: body.note }),
    ...(body.base === undefined ? {} : { base: body.base }),
  })
  return c.json(queued, 202)
})
