import type {
  CommandApprovalDecisionRequest,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
} from '@bazilion/api-types'
import { checkRulePrefix } from '../core/command-rules.ts'
import { commandRuleRepo } from '../core/index.ts'
import { commandApprovalRegistry } from '../lib/bash-approval.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter } from './http.ts'

/** Ephemeral shell-command approvals. */
export const shellApprovalsRouter = newRouter()

shellApprovalsRouter.get('/', (c) => {
  const agentId = c.req.query('agentId')?.trim()
  if (!agentId) return c.json({ error: 'agentId query parameter is required' }, 400)
  const body: ListCommandApprovalsResponse = {
    approvals: commandApprovalRegistry.list(agentId),
  }
  return c.json(body)
})

shellApprovalsRouter.post('/:id', async (c) => {
  const body = await jsonBody<CommandApprovalDecisionRequest>(c)
  const decision = body?.decision
  if (decision !== 'allow' && decision !== 'deny') {
    return c.json({ error: 'body must be {"decision":"allow"|"deny"}' }, 400)
  }
  // Always for this Agent: the rule is kept first, so a refused prefix allows nothing.
  if (body?.remember) {
    const pending = commandApprovalRegistry.get(c.req.param('id'))
    if (!pending) return c.json({ error: 'no pending shell approval with this id' }, 404)
    if (decision !== 'allow' || pending.tool) {
      return c.json({ error: 'only an allowed shell command can be remembered' }, 400)
    }
    let prefix: string
    try {
      prefix = checkRulePrefix(String(body.remember.prefix ?? ''), pending.command)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
    commandRuleRepo.add(getCtx().db, pending.agentId, prefix)
  }
  const approval = commandApprovalRegistry.respond(c.req.param('id'), decision)
  if (!approval) return c.json({ error: 'no pending shell approval with this id' }, 404)
  const response: CommandApprovalDecisionResponse = { approval }
  return c.json(response)
})
