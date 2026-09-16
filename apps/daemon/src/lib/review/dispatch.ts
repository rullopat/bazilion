import { randomUUID } from 'node:crypto'
import type { BazilionDb } from '../../core/db/client.ts'
import {
  claimReviewAttempt,
  finishReviewAttempt,
  getReviewPacket,
  listDispatchableReviewPackets,
  listReviewConclusions,
  type ReviewPacketRecord,
  setReviewPacketState,
} from '../../core/repos/review-packets.ts'
import { authorizeCommunication } from '../../core/team-policy/authorization.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from '../agent-cancel.ts'
import { acquireAgentLifecycleLease } from '../agent-lifecycle-lease.ts'
import { authorizeReviewRequest, teamPolicyEnforcementEnabled } from '../communication.ts'
import { getCtx } from '../ctx.ts'
import { protectedFailureMessage } from '../protected-failure.ts'
import {
  bindChangeReviewCapability,
  executePreparedChangeReview,
  prepareChangeReviewTurn,
} from './preparation.ts'
import { deliverReviewResult } from './result.ts'
import { createReviewCapabilityHost } from './reviewer-capability.ts'

// BAZ-043 slice 6: one dispatch owner for a packet's reviewer turn.
//
// The shape is BAZ-044's, deliberately: exactly one path claims a packet, revalidates membership and policy
// under that claim, runs the restricted turn, settles it, and hands the result back. Nothing here streams
// to a client and nothing here is resumable — an interrupted attempt becomes `uncertain` and is never
// replayed.

/** Dispatch owner for every assertion this process makes about a review attempt. */
export const REVIEW_DISPATCH_OWNER = randomUUID()

const REVIEW_LEASE_MS = 10 * 60 * 1000

/** Registered per packet so a cancellation can reach the running turn without touching other turns. */
const dispatchRegistry = (): { controllers: Map<string, AbortController> } => {
  const global = globalThis as unknown as Record<
    symbol,
    { controllers: Map<string, AbortController> } | undefined
  >
  const key = Symbol.for('bazilion.review.dispatch')
  global[key] ??= { controllers: new Map() }
  return global[key]
}

export function isReviewDispatching(packetId: string): boolean {
  return dispatchRegistry().controllers.has(packetId)
}

export async function cancelReviewDispatch(packetId: string): Promise<boolean> {
  const controller = dispatchRegistry().controllers.get(packetId)
  if (!controller) return false
  controller.abort()
  return true
}

export interface ReviewDispatchOptions {
  /** Internal integration-test override, forwarded to the worker spawner. */
  workerEntryPath?: string
}

export type ReviewDispatchOutcome = 'dispatched' | 'settled' | 'deferred' | 'held'

/**
 * Dispatch one packet's reviewer.
 *
 * Order matters: the busy check happens before the claim so a busy reviewer defers without consuming an
 * attempt; the policy decision happens under the claim so a held packet cannot be claimed twice.
 */
export async function dispatchReviewPacket(
  packetId: string,
  opts: ReviewDispatchOptions = {},
): Promise<ReviewDispatchOutcome> {
  const { db, paths } = getCtx()
  const packet = getReviewPacket(db, packetId)
  if (!packet || packet.state !== 'open' || !packet.reviewerAgentId) return 'settled'
  const reviewerAgentId = packet.reviewerAgentId

  // A busy Agent defers rather than failing: it will be picked up on a later tick.
  if (isActiveAgent(reviewerAgentId)) return 'deferred'
  if (isReviewDispatching(packetId)) return 'deferred'

  const releaseLease = await acquireAgentLifecycleLease(reviewerAgentId)
  const controller = new AbortController()
  const registry = dispatchRegistry()
  let registered = false
  let attemptId: string | null = null
  try {
    if (isActiveAgent(reviewerAgentId)) return 'deferred'

    // Revalidate the directed edge on every dispatch: a packet that was allowed when it was captured is
    // not allowed forever. A hold is durable — the packet waits and nothing is read.
    if (teamPolicyEnforcementEnabled()) {
      const decision = authorizeCommunication(db, {
        source: { kind: 'agent', id: packet.requesterAgentId ?? reviewerAgentId },
        target: { kind: 'agent', id: reviewerAgentId },
        origin: 'review_request',
        attemptKind: 'review_request',
        attemptId: packet.id,
      })
      if (decision.decision === 'deny') {
        setHeldPacketState(db, packet.id, 'blocked')
        return 'settled'
      }
      if (decision.decision === 'approval_required') {
        const requesterAgentId = packet.requesterAgentId
        if (!requesterAgentId) {
          // The policy edge is requester → reviewer, and an operator-only packet has no agent requester,
          // so there is no edge to hold. Refusing keeps the packet from being dispatched unreviewed.
          setHeldPacketState(db, packet.id, 'blocked')
          return 'settled'
        }
        try {
          authorizeReviewRequest(db, {
            from: requesterAgentId,
            to: reviewerAgentId,
            packetId: packet.id,
          })
          // A policy that reports approval_required without holding the attempt is a contract breach.
          setHeldPacketState(db, packet.id, 'blocked')
          return 'settled'
        } catch {
          setHeldPacketState(db, packet.id, 'awaiting_approval')
          return 'held'
        }
      }
    }

    const claim = claimReviewAttempt(db, {
      packetId: packet.id,
      leaseOwner: REVIEW_DISPATCH_OWNER,
      leaseMs: REVIEW_LEASE_MS,
    })
    if (!claim) return 'deferred'
    attemptId = claim.attempt.id

    registerAgent(reviewerAgentId, controller)
    registered = true
    registry.controllers.set(packet.id, controller)

    const prepared = await prepareChangeReviewTurn({
      packet: claim.packet,
      attemptId: claim.attempt.id,
    })
    const capability = bindChangeReviewCapability(
      createReviewCapabilityHost({
        db,
        paths,
        packet: claim.packet,
        attemptId: claim.attempt.id,
        // Bound to the live turn: a tool call that arrives after the turn ended is refused, so a late
        // call cannot annotate a packet nobody is reviewing any more.
        assertActive: () => {
          if (controller.signal.aborted) throw new Error('Review turn ended')
          if (isActiveAgent(reviewerAgentId) && !registered) throw new Error('Review turn ended')
        },
      }),
      { packetId: packet.id, attemptId: claim.attempt.id },
    )

    let failure: string | null = null
    for await (const frame of executePreparedChangeReview(prepared, {
      changeReviewHost: capability,
      signal: controller.signal,
      ...(opts.workerEntryPath ? { workerEntryPath: opts.workerEntryPath } : {}),
    })) {
      if (frame.kind === 'fatal') failure ??= frame.error
      else if (frame.kind === 'event' && frame.event.type === 'error') failure ??= frame.event.error
    }

    if (controller.signal.aborted) {
      finishReviewAttempt(db, {
        attemptId: claim.attempt.id,
        leaseOwner: REVIEW_DISPATCH_OWNER,
        state: 'cancelled',
        error: 'the review was cancelled before it concluded',
      })
      return 'settled'
    }
    if (failure) {
      // The turn failed. The packet stays `open` (see finishReviewAttempt) so the failure is visible as
      // "no review happened" rather than as a review that found nothing.
      finishReviewAttempt(db, {
        attemptId: claim.attempt.id,
        leaseOwner: REVIEW_DISPATCH_OWNER,
        state: 'failed',
        error: failure,
      })
      return 'settled'
    }

    // A conclusion is what makes a review a review. A turn that ends without one did not review anything,
    // so it settles as failed with no conclusion rather than as a completed review.
    const concluded = listReviewConclusions(db, packet.id).some(
      (entry) => entry.reviewerKind === 'agent' && entry.reviewerAgentId === reviewerAgentId,
    )
    const settled = finishReviewAttempt(db, {
      attemptId: claim.attempt.id,
      leaseOwner: REVIEW_DISPATCH_OWNER,
      state: concluded ? 'completed' : 'failed',
      error: concluded ? null : 'the reviewer finished without recording a conclusion',
    })
    // Awaited, not fired and forgotten: the delivery compares the tree to the capture first, and a
    // caller (or a test) that reads the inbox immediately after dispatch must not race it.
    if (settled && concluded) await deliverReviewResult(db, paths, packet.id)
    return 'dispatched'
  } catch (error) {
    if (attemptId) {
      finishReviewAttempt(db, {
        attemptId,
        leaseOwner: REVIEW_DISPATCH_OWNER,
        state: controller.signal.aborted ? 'cancelled' : 'failed',
        error: protectedFailureMessage(error, 'Review'),
      })
    }
    return 'settled'
  } finally {
    registry.controllers.delete(packet.id)
    if (registered) unregisterAgent(reviewerAgentId)
    releaseLease()
  }
}

/**
 * Packets waiting for a reviewer, oldest first.
 *
 * Deliberately excludes anything not `open`: a held packet waits for its approval and a `blocked` one for
 * a decision, and re-dispatching either would run a review the policy has not released.
 */
export function dispatchableReviews(limit = 5): ReviewPacketRecord[] {
  return listDispatchableReviewPackets(getCtx().db).slice(0, limit)
}

/** Move a still-waiting packet. A concurrent cancel or completion wins over a late policy decision. */
function setHeldPacketState(
  db: BazilionDb,
  packetId: string,
  state: 'blocked' | 'awaiting_approval',
): void {
  const packet = getReviewPacket(db, packetId)
  if (packet?.state === 'open') setReviewPacketState(db, packetId, state)
}
