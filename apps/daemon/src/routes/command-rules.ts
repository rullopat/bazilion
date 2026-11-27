// Rules that let an Agent run a dangerous command without asking: GET /api/command-rules (all,
// or ?agentId=), DELETE /api/command-rules/:id. A rule is added by answering an approval with
// Always for this Agent (POST /api/shell-approvals/:id with `remember`).

import type { ListCommandRulesResponse } from '@bazilion/api-types'
import { commandRuleRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter } from './http.ts'

export const commandRulesRouter = newRouter()

commandRulesRouter.get('/', (c) => {
  const agentId = c.req.query('agentId')?.trim() || undefined
  return c.json({
    rules: commandRuleRepo.list(getCtx().db, agentId),
  } satisfies ListCommandRulesResponse)
})

commandRulesRouter.delete('/:id', (c) => {
  if (!commandRuleRepo.remove(getCtx().db, c.req.param('id'))) {
    return c.json({ error: `rule not found: ${c.req.param('id')}` }, 404)
  }
  return c.body(null, 204)
})
