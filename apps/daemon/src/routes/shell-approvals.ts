import type {
  CommandApprovalDecisionRequest,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
} from '@bazilion/api-types'
import { commandApprovalRegistry } from '../lib/bash-approval.ts'
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
  const approval = commandApprovalRegistry.respond(c.req.param('id'), decision)
  if (!approval) return c.json({ error: 'no pending shell approval with this id' }, 404)
  const response: CommandApprovalDecisionResponse = { approval }
  return c.json(response)
})
