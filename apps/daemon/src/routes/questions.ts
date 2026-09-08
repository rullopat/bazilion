import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { resolveAgent } from '../core/agent/resolve.ts'
import * as questions from '../core/repos/questions.ts'
import { CommunicationDeniedError } from '../lib/communication.ts'
import { getCtx } from '../lib/ctx.ts'
import { parseQuestionResponse } from '../lib/question-input.ts'
import { questionServiceFor } from '../lib/question-service.ts'
import { questionVisible } from '../lib/question-visibility.ts'

export const questionsRouter = new Hono()
questionsRouter.use('/:agentId/questions/*', bodyLimit({ maxSize: 32 * 1024 }))
questionsRouter.use('/:agentId/questions/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  const { db, paths } = getCtx()
  try {
    resolveAgent(db, paths, c.req.param('agentId'))
  } catch {
    return c.json({ error: 'Agent not found' }, 404)
  }
  await next()
})
questionsRouter.onError((error, c) => {
  if (error instanceof CommunicationDeniedError)
    return c.json({ error: 'Team Policy denied this answer', code: 'communication_denied' }, 403)
  return c.json({ error: 'Invalid or unavailable question request' }, 400)
})
questionsRouter.get('/:agentId/questions', (c) => {
  const { db } = getCtx()
  const conversationId = c.req.query('conversationId')
  return c.json({
    questions: questions
      .list(db, c.req.param('agentId'), 100, conversationId)
      .filter((item) => questionVisible(db, item)),
  })
})
questionsRouter.get('/:agentId/questions/:id', (c) => {
  const { db } = getCtx()
  const item = questions.get(db, c.req.param('agentId'), c.req.param('id'))
  return item && questionVisible(db, item)
    ? c.json(item)
    : c.json({ error: 'Question not found' }, 404)
})
questionsRouter.post('/:agentId/questions/:id/answer', async (c) => {
  const { db, paths, authToken } = getCtx()
  const item = questions.get(db, c.req.param('agentId'), c.req.param('id'))
  if (!item || !questionVisible(db, item)) return c.json({ error: 'Question not found' }, 404)
  const input = parseQuestionResponse(await c.req.json(), item.question, item.conversationId)
  const result = questionServiceFor(db, paths, authToken).respond(item.agentId, item.id, input)
  return c.json(result, result.kind === 'conflict' ? 409 : result.kind === 'held' ? 202 : 200)
})
