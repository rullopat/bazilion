// /api/agents/:id reviewed learning: the review cadence, review runs, and the lesson proposals
// the operator approves, rejects or revokes.

import { join } from 'node:path'
import {
  type Agent,
  type AgentLessonProposal,
  type AgentLessonProposalResponse,
  type AgentLessonScope,
  type AgentLessonStatus,
  type AgentReviewConfig,
  type DecideAgentLessonProposalRequest,
  type EnqueueAgentReviewResponse,
  type ListAgentLessonProposalsResponse,
  type ListAgentReviewsResponse,
  REASONING_LEVELS,
  type ResolvedAgent,
  type UpdateAgentLessonProposalRequest,
  type UpdateAgentReviewConfigRequest,
} from '@bazilion/api-types'
import {
  agentLessonProposalRepo,
  agentRepo,
  agentReviewRepo,
  type Paths,
  resolveAgent,
  teamRepo,
} from '../core/index.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { getCtx } from '../lib/ctx.ts'
import {
  approveLessonProposal,
  rejectLessonProposal,
  revokeLessonProposal,
} from '../lib/lesson-decisions.ts'
import { redactReviewText } from '../lib/review-digest.ts'
import { loadSessionMessages, piMessagesToProviderView, qmdBackend } from '../runtime/index.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const agentLearningRouter = newRouter()

function reviewConfig(agent: Agent): AgentReviewConfig {
  return {
    enabled: agent.reviewEnabled,
    everyNTurns: agent.reviewEveryNTurns,
    model: agent.reviewModel,
    reasoningLevel: agent.reviewReasoningLevel,
    turnsSinceLast: agent.reviewTurnsSinceLast,
  }
}

agentLearningRouter.get('/:id/review-config', (c) => c.json(reviewConfig(routeAgent(c))))

agentLearningRouter.patch('/:id/review-config', async (c) => {
  const body = await jsonBody<UpdateAgentReviewConfigRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const agent = routeAgent(c)
  const everyNTurns = body.everyNTurns ?? agent.reviewEveryNTurns
  const reasoningLevel = body.reasoningLevel ?? agent.reviewReasoningLevel
  if (!Number.isInteger(everyNTurns) || everyNTurns < 1 || everyNTurns > 100) {
    return c.json({ error: 'everyNTurns must be an integer from 1 to 100' }, 400)
  }
  if (!REASONING_LEVELS.includes(reasoningLevel)) {
    return c.json({ error: `invalid reasoningLevel: ${reasoningLevel}` }, 400)
  }
  if (body.model !== undefined && body.model !== null && !body.model.includes(':')) {
    return c.json({ error: 'model must use provider:model format' }, 400)
  }
  const { db } = getCtx()
  agentRepo.setReviewConfig(db, agent.id, {
    enabled: body.enabled ?? agent.reviewEnabled,
    everyNTurns,
    model: body.model === undefined ? agent.reviewModel : body.model,
    reasoningLevel,
  })
  return c.json(reviewConfig(routeAgent(c)))
})

agentLearningRouter.post('/:id/reviews', (c) =>
  c.json(
    {
      review: agentReviewRepo.enqueueManual(getCtx().db, routeAgent(c).id),
    } satisfies EnqueueAgentReviewResponse,
    202,
  ),
)

agentLearningRouter.get('/:id/reviews', (c) =>
  c.json({
    reviews: agentReviewRepo.listForAgent(getCtx().db, routeAgent(c).id),
  } satisfies ListAgentReviewsResponse),
)

const LESSON_STATUSES: AgentLessonStatus[] = ['pending', 'approved', 'rejected', 'revoked']

agentLearningRouter.get('/:id/lesson-proposals', (c) => {
  const { db, paths } = getCtx()
  const agent = routeAgent(c)
  const status = c.req.query('status') as AgentLessonStatus | undefined
  if (status && !LESSON_STATUSES.includes(status)) {
    return c.json({ error: `invalid status: ${status}` }, 400)
  }
  return c.json({
    proposals: withEvidenceExcerpts(
      agentLessonProposalRepo.listForAgent(db, agent.id, { status }),
      resolveAgent(db, paths, agent.id),
      paths,
    ),
  } satisfies ListAgentLessonProposalsResponse)
})

/** The agent's proposal named by `:proposalId`, or null. */
function routeProposal(agent: Agent, proposalId: string): AgentLessonProposal | null {
  const proposal = agentLessonProposalRepo.get(getCtx().db, proposalId)
  return proposal && proposal.agentId === agent.id ? proposal : null
}

agentLearningRouter.patch('/:id/lesson-proposals/:proposalId', async (c) => {
  const body = await jsonBody<UpdateAgentLessonProposalRequest>(c)
  if (!body || !Number.isInteger(body.version)) return c.json({ error: 'version is required' }, 400)
  const current = routeProposal(routeAgent(c), c.req.param('proposalId'))
  if (!current) return c.json({ error: 'proposal not found' }, 404)
  const text = body.text?.trim() ?? current.text
  const scope = body.scope ?? current.scope
  if (!text || text.length > 500) return c.json({ error: 'text must be 1-500 characters' }, 400)
  if (!(['private', 'shared'] satisfies AgentLessonScope[]).includes(scope)) {
    return c.json({ error: `invalid scope: ${scope}` }, 400)
  }
  const proposal = agentLessonProposalRepo.updatePending(
    getCtx().db,
    current.id,
    body.version as number,
    { text, scope },
  )
  return proposal
    ? c.json({ proposal } satisfies AgentLessonProposalResponse)
    : c.json({ error: 'proposal changed or is no longer pending' }, 409)
})

for (const decision of ['approve', 'reject', 'revoke'] as const) {
  agentLearningRouter.post(`/:id/lesson-proposals/:proposalId/${decision}`, async (c) => {
    const body = await jsonBody<DecideAgentLessonProposalRequest>(c)
    const version = body?.version
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return c.json({ error: 'version is required' }, 400)
    }
    const { db, paths } = getCtx()
    const agent = routeAgent(c)
    const current = routeProposal(agent, c.req.param('proposalId'))
    if (!current) return c.json({ error: 'proposal not found' }, 404)
    const team = teamRepo.get(db, agent.teamId, paths)
    if (!team) return c.json({ error: `team not found: ${agent.teamId}` }, 404)
    const proposal = await runAgentLifecycleMutation(agent.id, async () => {
      const memory = qmdBackend(join(team.path, 'memory'))
      if (decision === 'approve') return approveLessonProposal(db, memory, current.id, version)
      if (decision === 'reject') return rejectLessonProposal(db, current.id, version)
      return revokeLessonProposal(db, memory, current.id, version)
    })
    return c.json({ proposal } satisfies AgentLessonProposalResponse)
  })
}

/** Add a short redacted transcript excerpt to each piece of evidence (never stored). */
function withEvidenceExcerpts(
  proposals: AgentLessonProposal[],
  agent: ResolvedAgent,
  paths: Paths,
): AgentLessonProposal[] {
  const sessions = new Map<string, ReturnType<typeof piMessagesToProviderView>>()
  return proposals.map((proposal) => ({
    ...proposal,
    evidence: proposal.evidence.map((evidence) => {
      let messages = sessions.get(evidence.sessionId)
      if (!messages) {
        messages = piMessagesToProviderView(loadSessionMessages(agent, paths, evidence.sessionId))
        sessions.set(evidence.sessionId, messages)
      }
      const message = messages[evidence.entryOrdinal]
      const excerpt = message
        ? redactReviewText(
            message.role === 'tool'
              ? `[tool:${message.toolName ?? 'unknown'}] completed`
              : message.content,
          )
            .replace(/\s+/g, ' ')
            .slice(0, 240)
        : undefined
      return { ...evidence, ...(excerpt ? { excerpt } : {}) }
    }),
  }))
}
