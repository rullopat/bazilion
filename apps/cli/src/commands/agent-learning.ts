import type {
  Agent,
  AgentLessonProposal,
  AgentLessonProposalResponse,
  AgentLessonStatus,
  AgentReviewConfig,
  EnqueueAgentReviewResponse,
  ListAgentLessonProposalsResponse,
  ListAgentReviewsResponse,
  UpdateAgentReviewConfigRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows } from '../command-helpers.ts'

const proposalArg = positional('Proposal id or prefix')

const reviewConfigCmd = defineCommand({
  meta: { name: 'review-config', description: 'Inspect or configure reviewed learning' },
  args: {
    id: agentArg,
    enable: { type: 'boolean', description: 'Enable periodic reviews' },
    disable: { type: 'boolean', description: 'Disable periodic reviews' },
    every: { type: 'string', description: 'Successful user turns between reviews (1-100)' },
    model: { type: 'string', description: "Review model, or 'agent' to use the Agent model" },
    reasoning: { type: 'string', description: 'Review reasoning level' },
  },
  async run({ args }) {
    if (args.enable && args.disable) throw new Error('choose either --enable or --disable')
    const body: UpdateAgentReviewConfigRequest = {}
    if (args.enable || args.disable) body.enabled = Boolean(args.enable)
    if (args.every !== undefined) {
      const value = Number(args.every)
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('--every must be an integer from 1 to 100')
      }
      body.everyNTurns = value
    }
    if (args.model !== undefined) body.model = args.model === 'agent' ? null : args.model
    if (args.reasoning !== undefined) {
      body.reasoningLevel = args.reasoning as UpdateAgentReviewConfigRequest['reasoningLevel']
    }
    const client = createClient()
    const path = apiPath('agents', args.id, 'review-config')
    const config =
      Object.keys(body).length > 0
        ? await client.patch<AgentReviewConfig>(path, body)
        : await client.get<AgentReviewConfig>(path)
    console.log(`review: ${config.enabled ? 'enabled' : 'disabled'}`)
    console.log(`cadence: every ${config.everyNTurns} successful user turns`)
    console.log(`model: ${config.model ?? 'agent model'}`)
    console.log(`reasoning: ${config.reasoningLevel}`)
    console.log(`turns since last review: ${config.turnsSinceLast}`)
  },
})

const reviewCmd = defineCommand({
  meta: { name: 'review', description: 'Enqueue a reviewed-learning pass' },
  args: { id: agentArg },
  async run({ args }) {
    const response = await createClient().post<EnqueueAgentReviewResponse>(
      apiPath('agents', args.id, 'reviews'),
    )
    console.log(`review ${response.review.id} ${response.review.status}`)
  },
})

const reviewsCmd = defineCommand({
  meta: { name: 'reviews', description: 'List reviewed-learning history' },
  args: {
    id: agentArg,
    status: { type: 'string', description: 'pending|running|completed|failed|cancelled' },
  },
  async run({ args }) {
    const { reviews } = await createClient().get<ListAgentReviewsResponse>(
      apiPath('agents', args.id, 'reviews'),
    )
    printRows(
      reviews
        .filter((review) => !args.status || review.status === args.status)
        .map((review) => [
          review.id,
          review.status,
          review.trigger,
          `${review.proposalCount} proposal(s)`,
          new Date(review.createdAt).toISOString(),
        ]),
      '(no reviews)',
    )
  },
})

const lessonsCmd = defineCommand({
  meta: { name: 'lessons', description: 'List reviewed lesson proposals' },
  args: {
    id: agentArg,
    status: { type: 'string', description: 'pending|approved|rejected|revoked' },
  },
  async run({ args }) {
    const status = args.status as AgentLessonStatus | undefined
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    const { proposals } = await createClient().get<ListAgentLessonProposalsResponse>(
      `${apiPath('agents', args.id, 'lesson-proposals')}${query}`,
    )
    printRows(
      proposals.map((proposal) => [proposal.id, proposal.status, proposal.scope, proposal.text]),
      '(no lesson proposals)',
    )
  },
})

/** A proposal is addressed by its id alone, so find the Agent it belongs to. */
async function locateProposal(
  id: string,
): Promise<{ agent: Agent; proposal: AgentLessonProposal }> {
  const client = createClient()
  for (const agent of await client.get<Agent[]>('/api/agents?includeArchived=true')) {
    const { proposals } = await client.get<ListAgentLessonProposalsResponse>(
      apiPath('agents', agent.id, 'lesson-proposals'),
    )
    const proposal = proposals.find((item) => item.id === id || item.id.startsWith(id))
    if (proposal) return { agent, proposal }
  }
  throw new Error(`lesson proposal not found: ${id}`)
}

function lessonDecisionCmd(decision: 'approve' | 'reject' | 'revoke') {
  return defineCommand({
    meta: { name: decision, description: `${decision} a reviewed lesson proposal` },
    args: {
      id: proposalArg,
      yes: { type: 'boolean', description: `Confirm ${decision}` },
    },
    async run({ args }) {
      if (!args.yes) throw new Error(`${decision} requires --yes`)
      const { agent, proposal } = await locateProposal(args.id)
      const response = await createClient().post<AgentLessonProposalResponse>(
        apiPath('agents', agent.id, 'lesson-proposals', proposal.id, decision),
        { version: proposal.version },
      )
      console.log(`${response.proposal.status} ${response.proposal.id}`)
    },
  })
}

const lessonEditCmd = defineCommand({
  meta: { name: 'edit', description: 'Edit a pending reviewed lesson proposal' },
  args: {
    id: proposalArg,
    text: { type: 'string', description: 'Replacement lesson text' },
    scope: { type: 'string', description: 'private|shared' },
  },
  async run({ args }) {
    if (args.text === undefined && args.scope === undefined) {
      throw new Error('lesson edit requires --text or --scope')
    }
    const { agent, proposal } = await locateProposal(args.id)
    const response = await createClient().patch<AgentLessonProposalResponse>(
      apiPath('agents', agent.id, 'lesson-proposals', proposal.id),
      { version: proposal.version, text: args.text, scope: args.scope },
    )
    console.log(`updated ${response.proposal.id} v${response.proposal.version}`)
  },
})

const lessonCmd = defineCommand({
  meta: { name: 'lesson', description: 'Edit or decide a reviewed lesson proposal' },
  subCommands: {
    edit: lessonEditCmd,
    approve: lessonDecisionCmd('approve'),
    reject: lessonDecisionCmd('reject'),
    revoke: lessonDecisionCmd('revoke'),
  },
})

export const learningCommands = {
  'review-config': reviewConfigCmd,
  review: reviewCmd,
  reviews: reviewsCmd,
  lessons: lessonsCmd,
  lesson: lessonCmd,
}
