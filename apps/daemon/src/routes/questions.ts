import type { AnswerAgentQuestionRequest } from '@bazilion/api-types'
import { bodyLimit } from 'hono/body-limit'
import { questionRegistry } from '../lib/questions.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const questionsRouter = newRouter<{ Variables: { agentId: string } }>()
questionsRouter.use('/:agentId/questions/*', bodyLimit({ maxSize: 32 * 1024 }))
questionsRouter.use('/:agentId/questions/*', async (c, next) => {
  // Accepts an Agent id, unique name or id prefix; the registry is keyed by the full id.
  c.set('agentId', routeAgent(c, 'agentId').id)
  await next()
})

/** Questions this Agent is waiting on. */
questionsRouter.get('/:agentId/questions', (c) =>
  c.json({ questions: questionRegistry.list(c.get('agentId')) }),
)

questionsRouter.post('/:agentId/questions/:id/answer', async (c) => {
  const body = await jsonBody<AnswerAgentQuestionRequest>(c)
  try {
    if (!questionRegistry.answer(c.get('agentId'), c.req.param('id'), body?.answer))
      return c.json({ error: 'That question is no longer open' }, 404)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid answer' }, 400)
  }
  return c.json({ ok: true })
})
