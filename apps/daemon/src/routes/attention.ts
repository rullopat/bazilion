// /api/attention: what needs the operator's attention (failed reviews and triggers, lesson
// proposals, stopped message chains, interrupted follow-ups), and acknowledging it.

import type { AttentionKind, AttentionState } from '@bazilion/api-types'
import {
  ATTENTION_KINDS,
  acknowledgeAllAttention,
  acknowledgeAttention,
  attentionSummary,
  projectAttention,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter } from './http.ts'

export const attentionRouter = newRouter()

attentionRouter.get('/', (c) => {
  const state = (c.req.query('state') ?? 'open') as AttentionState
  if (!['open', 'acknowledged', 'all'].includes(state))
    return c.json({ error: 'invalid attention state' }, 400)
  const kind = c.req.query('kind') as AttentionKind | undefined
  if (kind && !ATTENTION_KINDS.includes(kind))
    return c.json({ error: 'invalid attention kind' }, 400)
  const rawLimit = c.req.query('limit')
  const limit = rawLimit === undefined ? 100 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    return c.json({ error: 'attention limit must be between 1 and 200' }, 400)
  return c.json(projectAttention(getCtx().db, { state, kind, limit }))
})

attentionRouter.get('/summary', (c) => c.json(attentionSummary(getCtx().db)))

attentionRouter.post('/acknowledge-all', (c) =>
  c.json({ acknowledged: acknowledgeAllAttention(getCtx().db) }),
)

attentionRouter.post('/:key/acknowledge', (c) =>
  c.json({ item: acknowledgeAttention(getCtx().db, c.req.param('key'), true) }),
)
attentionRouter.delete('/:key/acknowledgement', (c) =>
  c.json({ item: acknowledgeAttention(getCtx().db, c.req.param('key'), false) }),
)
