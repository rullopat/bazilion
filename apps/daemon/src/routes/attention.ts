import type { AttentionKind, AttentionState } from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  ATTENTION_KINDS,
  acknowledgeAllAttention,
  acknowledgeAttention,
  attentionSummary,
  projectAttention,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

export const attentionRouter = new Hono()

attentionRouter.get('/', (c) => {
  const state = (c.req.query('state') ?? 'open') as AttentionState
  if (!['open', 'acknowledged', 'all'].includes(state))
    return c.json({ error: 'invalid attention state', code: 'invalid_attention_state' }, 400)
  const kind = c.req.query('kind') as AttentionKind | undefined
  if (kind && !ATTENTION_KINDS.includes(kind))
    return c.json({ error: 'invalid attention kind', code: 'invalid_attention_kind' }, 400)
  const rawLimit = c.req.query('limit')
  const limit = rawLimit === undefined ? 100 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    return c.json(
      { error: 'attention limit must be between 1 and 200', code: 'invalid_attention_limit' },
      400,
    )
  return c.json(projectAttention(getCtx().db, { state, kind, limit }))
})

attentionRouter.get('/summary', (c) => c.json(attentionSummary(getCtx().db)))

attentionRouter.post('/acknowledge-all', (c) =>
  c.json({ acknowledged: acknowledgeAllAttention(getCtx().db) }),
)

attentionRouter.post('/:key/acknowledge', (c) => mutate(c, true))
attentionRouter.delete('/:key/acknowledgement', (c) => mutate(c, false))

function mutate(c: Context, acknowledged: boolean) {
  try {
    return c.json({
      item: acknowledgeAttention(getCtx().db, c.req.param('key') ?? '', acknowledged),
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'attention_error'
    if (code === 'invalid_attention_key')
      return c.json({ error: 'invalid attention key', code }, 400)
    if (code === 'attention_action_required')
      return c.json({ error: 'action-required items must be resolved at their source', code }, 409)
    if (code === 'attention_source_not_found')
      return c.json({ error: 'attention source not found or no longer eligible', code }, 404)
    throw error
  }
}
