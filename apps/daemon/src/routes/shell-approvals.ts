import type {
  CommandApprovalDecisionRequest,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import { commandApprovalRegistry } from '../lib/bash-approval.ts'

/** Ephemeral shell-command approvals; intentionally separate from /api/approvals. */
export const shellApprovalsRouter = new Hono()

shellApprovalsRouter.get('/', (c) => {
  const agentId = c.req.query('agentId')?.trim()
  if (!agentId) return c.json({ error: 'agentId query parameter is required' }, 400)
  const body: ListCommandApprovalsResponse = {
    approvals: commandApprovalRegistry.list(agentId),
  }
  return c.json(body)
})

shellApprovalsRouter.post('/:id', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CommandApprovalDecisionRequest | null
  if (!body || (body.decision !== 'allow' && body.decision !== 'deny')) {
    return c.json({ error: 'body must be {"decision":"allow"|"deny"}' }, 400)
  }

  const result = commandApprovalRegistry.respond(c.req.param('id'), body.decision)
  if (result.kind === 'not_found') {
    return c.json({ error: 'shell approval not found', code: 'shell_approval_not_found' }, 404)
  }
  if (result.kind === 'conflict') {
    return c.json(
      {
        error: `shell approval already decided: ${result.approval.status}`,
        code: 'shell_approval_already_decided',
      },
      409,
    )
  }

  const response: CommandApprovalDecisionResponse = { approval: result.approval }
  return c.json(response)
})
