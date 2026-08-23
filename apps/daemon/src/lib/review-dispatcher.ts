import type { ProviderMessage, ResolvedAgent } from '@bazilion/api-types'
import { agentLessonProposalRepo, agentReviewRepo, resolveAgent } from '../core/index.ts'
import {
  loadInitialMessages,
  loadSessionHead,
  piMessagesToProviderView,
  qmdBackend,
} from '../runtime/index.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from './agent-cancel.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import { getCtx } from './ctx.ts'
import { protectedFailureMessage } from './protected-failure.ts'
import { buildReviewDigest, type ReviewTranscriptEntry } from './review-digest.ts'
import { prepareReviewInput } from './review-input.ts'
import { executePreparedReview, prepareRestrictedReview } from './review-preparation.ts'

function messageText(message: ProviderMessage): string {
  if (message.role === 'tool') return message.toolName ?? 'unknown'
  return message.content
}

function transcriptEntries(
  messages: ProviderMessage[],
  sessionId: string,
): ReviewTranscriptEntry[] {
  return messages.flatMap((message, ordinal) => {
    if (message.role === 'system') return []
    return [
      {
        sessionId,
        ordinal,
        role: message.role,
        text: messageText(message),
        ...(message.role === 'tool' ? { toolName: message.toolName } : {}),
      },
    ]
  })
}

export async function dispatchAgentReview(reviewId: string): Promise<void> {
  const { db, paths } = getCtx()
  const claimed = agentReviewRepo.claim(db, reviewId)
  if (!claimed) return
  if (isActiveAgent(claimed.agentId)) {
    agentReviewRepo.defer(db, claimed.id)
    return
  }

  const releaseLease = await acquireAgentLifecycleLease(claimed.agentId)
  const controller = new AbortController()
  let registered = false
  try {
    if (isActiveAgent(claimed.agentId)) {
      agentReviewRepo.defer(db, claimed.id)
      return
    }
    registerAgent(claimed.agentId, controller)
    registered = true
  } finally {
    releaseLease()
  }

  try {
    const resolved = resolveAgent(db, paths, claimed.agentId)
    const sessionHead = loadSessionHead(resolved, paths)
    const sessionId = sessionHead.file?.replace(/\.jsonl$/, '') ?? ''
    const previous = agentReviewRepo.getLatestCompleted(db, claimed.agentId)
    const messages = piMessagesToProviderView(loadInitialMessages(resolved, paths))
    const entries = transcriptEntries(messages, sessionId).filter(
      (entry) =>
        previous?.sourceSessionId !== sessionId ||
        previous.sourceEndOrdinal === null ||
        entry.ordinal > previous.sourceEndOrdinal,
    )
    const digest = buildReviewDigest(entries)
    if (!digest) {
      agentReviewRepo.complete(db, claimed.id, 0)
      return
    }
    agentReviewRepo.setSource(db, claimed.id, digest)

    const privateLessons = agentLessonProposalRepo
      .listForAgent(db, claimed.agentId, { status: 'approved' })
      .filter((proposal) => proposal.scope === 'private')
      .map((proposal) => proposal.text)
    const memory = qmdBackend(`${resolved.team.path}/memory`)
    await memory.init()
    const sharedLessonKeys = (await memory.list())
      .map((entry) => entry.key)
      .filter((key) => key.startsWith('lessons/'))
    const reviewInput = prepareReviewInput(digest, privateLessons, sharedLessonKeys)

    const reviewAgent: ResolvedAgent = {
      ...resolved,
      agent: {
        ...resolved.agent,
        modelOverride: resolved.agent.reviewModel,
        reasoningLevel: resolved.agent.reviewReasoningLevel,
      },
      model: resolved.agent.reviewModel ?? resolved.model,
      reasoningLevel: resolved.agent.reviewReasoningLevel,
    }
    const preparedReview = await prepareRestrictedReview({
      review: claimed,
      agent: reviewAgent,
      message: reviewInput.message,
      evidence: reviewInput.evidence,
    })
    const proposals = await executePreparedReview(preparedReview, controller.signal)
    db.raw.transaction(() => {
      for (const proposal of proposals) {
        agentLessonProposalRepo.insert(db, {
          reviewId: claimed.id,
          agentId: claimed.agentId,
          scope: proposal.scope,
          text: proposal.text,
          evidence: proposal.evidenceEntryIds,
        })
      }
      agentReviewRepo.complete(db, claimed.id, proposals.length)
    })()
  } catch (error) {
    if (controller.signal.aborted) {
      agentReviewRepo.cancel(db, claimed.id, 'cancelled')
    } else {
      agentReviewRepo.fail(db, claimed.id, protectedFailureMessage(error, 'Restricted review'))
    }
  } finally {
    if (registered) unregisterAgent(claimed.agentId)
  }
}

export async function dispatchClaimableReviews(now = Date.now()): Promise<void> {
  const { db } = getCtx()
  await Promise.allSettled(
    agentReviewRepo.listClaimable(db, now).map((review) => dispatchAgentReview(review.id)),
  )
}
