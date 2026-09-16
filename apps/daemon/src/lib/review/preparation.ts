import type { ChatFrame } from '@bazilion/api-types'
import { resolveAgent } from '../../core/index.ts'
import type { ReviewPacketRecord } from '../../core/repos/review-packets.ts'
import type { StaticReviewWorkerSpec } from '../../runtime/index.ts'
import { spawnStaticReviewWorker } from '../../runtime/index.ts'
import type { ReviewCapabilityHost } from '../../runtime/tools/review.ts'
import type { ChangeReviewHost } from '../../runtime/worker/ipc-protocol.ts'
import { getCtx } from '../ctx.ts'
import { resolveProtectedProviderRuntime } from '../protected-provider.ts'
import {
  assertTrustedChangeReviewInvocation,
  createTrustedChangeReviewInvocation,
  type TrustedChangeReviewInvocation,
} from '../turn-invocation.ts'

// BAZ-043 slice 6: prepare and run one restricted static-review turn.
//
// Mirrors the restricted verification path deliberately: a review turn is dispatched directly, not through
// turn preparation, so it carries no lifecycle claim and can never be confused with an ordinary writable
// coding turn. The only difference between this and verification is the injected tool list.

export interface PreparedChangeReviewTurn {
  invocation: TrustedChangeReviewInvocation
  spec: StaticReviewWorkerSpec
  refreshApiKey: (providerName: string) => Promise<string>
}

export async function prepareChangeReviewTurn(input: {
  packet: ReviewPacketRecord
  attemptId: string
}): Promise<PreparedChangeReviewTurn> {
  const { db, authToken } = getCtx()
  const reviewerAgentId = input.packet.reviewerAgentId
  if (!reviewerAgentId) {
    // An operator-only packet delegates nothing, so it is never dispatched. Refusing here means a caller
    // cannot create a review turn out of a packet that never asked for one.
    throw new Error('a packet with no reviewer has nothing to dispatch')
  }
  const resolved = resolveAgent(db, paths(), reviewerAgentId)
  if (resolved.agent.id !== reviewerAgentId) {
    throw new Error('review packet does not match the resolved reviewer')
  }
  const invocation = createTrustedChangeReviewInvocation({
    kind: 'restricted_change_review',
    authorization: { kind: 'packet', packetId: input.packet.id, attemptId: input.attemptId },
    bashApprovalMode: 'auto_deny',
  })
  assertTrustedChangeReviewInvocation(invocation)
  const provider = await resolveProtectedProviderRuntime(
    db,
    authToken,
    resolved,
    resolved.agent.reasoningLevel,
  )
  return {
    invocation,
    spec: {
      kind: 'packet_review',
      agentId: reviewerAgentId,
      message: reviewPrompt(input.packet),
      turnId: input.attemptId,
      runtime: provider.runtime,
      review: { packetId: input.packet.id, attemptId: input.attemptId },
    },
    refreshApiKey: provider.refreshApiKey,
  }
}

function paths() {
  return getCtx().paths
}

/** The turn's instruction. Short by design: the boundaries live in the system prompt. */
function reviewPrompt(packet: ReviewPacketRecord): string {
  const requester =
    packet.requesterKind === 'agent' ? `agent ${packet.requesterAgentId}` : 'the operator'
  return (
    `Review the captured revision for packet ${packet.id}, requested by ${requester}.\n\n` +
    'Call review_packet to read the revision and its changed paths, review_path to read a patch where one ' +
    'can be reproduced, record what you find with review_finding, and finish with review_conclusion. ' +
    'You cannot run anything or change anything; if something would need running to be sure, say so.'
  )
}

/**
 * Bind the capability to this turn's identity.
 *
 * The worker sends the packet and attempt it believes it is acting for, and the daemon refuses anything
 * but its own binding — so a tool call cannot reach another packet's attempt even if the worker is
 * compromised.
 */
export function bindChangeReviewCapability(
  host: ReviewCapabilityHost,
  identity: { packetId: string; attemptId: string },
): ChangeReviewHost {
  const assertBound = (packetId: string, attemptId: string): void => {
    if (packetId !== identity.packetId || attemptId !== identity.attemptId) {
      throw new Error('review capability is bound to a different packet attempt')
    }
  }
  return {
    read: async (packetId, attemptId) => {
      assertBound(packetId, attemptId)
      return host.read()
    },
    path: async (packetId, attemptId, path) => {
      assertBound(packetId, attemptId)
      return host.path(path)
    },
    addFinding: async (packetId, attemptId, finding) => {
      assertBound(packetId, attemptId)
      return host.addFinding(finding)
    },
    conclude: async (packetId, attemptId, conclusion) => {
      assertBound(packetId, attemptId)
      return host.conclude(conclusion)
    },
  }
}

export function executePreparedChangeReview(
  prepared: PreparedChangeReviewTurn,
  opts: {
    changeReviewHost: ChangeReviewHost
    signal: AbortSignal
    /** Internal integration-test override, forwarded to the worker spawner. */
    workerEntryPath?: string
  },
): AsyncGenerator<ChatFrame, void, void> {
  // The invocation is consumed by rendering it once: a prepared turn cannot be run twice, so a retry must
  // go through a fresh attempt rather than reusing this one.
  assertTrustedChangeReviewInvocation(prepared.invocation)
  return spawnStaticReviewWorker(prepared.spec, {
    signal: opts.signal,
    apiKeyRefreshHost: { refresh: prepared.refreshApiKey },
    changeReviewHost: opts.changeReviewHost,
    ...(opts.workerEntryPath ? { workerEntryPath: opts.workerEntryPath } : {}),
  })
}
