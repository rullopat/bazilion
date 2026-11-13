// Reviewed learning (BAZ-003). Each scheduler tick dispatches the claimable reviews: the
// dispatcher takes the Agent the way a turn does, builds a redacted digest of the turns since the
// last completed review and runs a restricted worker whose only tool is `propose_lesson`. The
// proposals wait for the owner to approve, edit or reject them.

import type { ProviderMessage } from '@bazilion/api-types'
import { agentLessonProposalRepo, agentReviewRepo, resolveAgent } from '../core/index.ts'
import {
  loadInitialMessages,
  loadSessionHead,
  piMessagesToProviderView,
  qmdBackend,
  spawnReviewWorker,
} from '../runtime/index.ts'
import {
  isActiveAgent,
  isAgentTurnActiveError,
  isShuttingDownError,
  registerAgent,
  unregisterAgent,
} from './agent-cancel.ts'
import { selectedConversationTarget } from './conversation-target.ts'
import { getCtx } from './ctx.ts'
import {
  buildReviewDigest,
  type ReviewDigest,
  type ReviewTranscriptEntry,
} from './review-digest.ts'
import { resolveReviewProvider } from './review-provider.ts'
import { turnFailureReason } from './turn-outcome.ts'

/** Budgets of the reviewer's prompt sections, in characters. */
const MAX_TRANSCRIPT_CHARACTERS = 42_000
const MAX_PRIVATE_LESSON_CHARACTERS = 8_000
const MAX_SHARED_KEY_CHARACTERS = 4_000

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
        text: message.role === 'tool' ? (message.toolName ?? 'unknown') : message.content,
        ...(message.role === 'tool' ? { toolName: message.toolName } : {}),
      },
    ]
  })
}

/**
 * The reviewer's prompt: the newest digest entries that fit the budget, each tagged with the id a
 * proposal cites, then the lessons the Agent and its Team already have.
 */
export function renderReviewInput(
  digest: ReviewDigest,
  privateLessons: readonly string[],
  sharedLessonKeys: readonly string[],
): { message: string; evidence: Array<{ sessionId: string; entryOrdinal: number }> } {
  const blocks: string[] = []
  const evidence: Array<{ sessionId: string; entryOrdinal: number }> = []
  let remaining = MAX_TRANSCRIPT_CHARACTERS
  for (const entry of [...digest.entries].reverse()) {
    const block = `[${entry.sessionId}:${entry.ordinal}] ${entry.role.toUpperCase()}: ${entry.text}`
    if (block.length > remaining) break
    blocks.unshift(block)
    evidence.unshift({ sessionId: entry.sessionId, entryOrdinal: entry.ordinal })
    remaining -= block.length + 2
  }
  const list = (values: readonly string[], maxCharacters: number): string =>
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => `- ${value}`)
      .join('\n')
      .slice(0, maxCharacters)
  return {
    message: [
      '# Transcript digest',
      '',
      blocks.join('\n\n') || '(none)',
      '',
      '# Existing private lessons',
      list(privateLessons, MAX_PRIVATE_LESSON_CHARACTERS) || '(none)',
      '',
      '# Existing shared lesson keys',
      list(sharedLessonKeys, MAX_SHARED_KEY_CHARACTERS) || '(none)',
    ].join('\n'),
    evidence,
  }
}

export async function dispatchAgentReview(reviewId: string): Promise<void> {
  const { db, paths, authToken } = getCtx()
  const review = agentReviewRepo.get(db, reviewId)
  // A busy Agent, or a daemon that is shutting down, leaves the review pending for a later tick.
  if (review?.status !== 'pending' || isActiveAgent(review.agentId)) return
  const controller = new AbortController()
  try {
    registerAgent(review.agentId, controller)
  } catch (error) {
    if (isAgentTurnActiveError(error, review.agentId) || isShuttingDownError(error)) return
    throw error
  }

  const claimed = agentReviewRepo.claim(db, review.id)
  if (!claimed) {
    unregisterAgent(review.agentId)
    return
  }

  try {
    const resolved = resolveAgent(db, paths, claimed.agentId)
    const conversation = selectedConversationTarget(db, resolved.agent.id)
    const sessionHead = loadSessionHead(resolved, paths, conversation)
    const sessionId = sessionHead.file?.replace(/\.jsonl$/, '') ?? ''
    const previous = agentReviewRepo.getLatestCompleted(db, claimed.agentId)
    const messages = piMessagesToProviderView(loadInitialMessages(resolved, paths, conversation))
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
    const { message, evidence } = renderReviewInput(digest, privateLessons, sharedLessonKeys)

    // The review runs on its own model and reasoning level.
    const provider = await resolveReviewProvider(db, authToken, {
      ...resolved,
      model: resolved.agent.reviewModel ?? resolved.model,
      reasoningLevel: resolved.agent.reviewReasoningLevel,
    })
    const proposals = await spawnReviewWorker(
      { kind: 'restricted_review', message, runtime: provider.runtime, evidence },
      {
        signal: controller.signal,
        apiKeyRefreshHost: provider.refreshApiKey ? { refresh: provider.refreshApiKey } : undefined,
      },
    )
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
      agentReviewRepo.fail(db, claimed.id, turnFailureReason(error))
    }
  } finally {
    unregisterAgent(claimed.agentId)
  }
}

export async function dispatchPendingReviews(): Promise<void> {
  const { db } = getCtx()
  await Promise.allSettled(
    agentReviewRepo.listPending(db).map((review) => dispatchAgentReview(review.id)),
  )
}
