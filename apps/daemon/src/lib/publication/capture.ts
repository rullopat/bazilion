import { PUBLICATION_LIMITS } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  createPublication,
  PublicationError,
  type PublicationRecord,
} from '../../core/repos/publications.ts'
import { getReviewPacket, listReviewConclusions } from '../../core/repos/review-packets.ts'
import { resolvePublicationTarget } from './config.ts'
import { readReviewedRevisionFiles } from './revision-content.ts'

// BAZ-046: turning an operator's decision into a publication row, or into a refusal that sent nothing.
//
// Capture does the whole validation, because every one of these checks has to happen *before* the row
// exists: a publication that is refused must leave no claim behind, and the operator needs the reason in
// the same answer as the decision. Nothing here touches Git or the network — capture is a decision.

export type PublicationCaptureResult =
  | { kind: 'captured'; publication: PublicationRecord }
  | { kind: 'refused'; reason: string; detail: string }

export interface PublicationCaptureIntent {
  teamId: string
  packetId: string
  headBranch?: string | null
  commitMessage?: string | null
}

/** The branch a publication defaults to, derived from the packet so two packets cannot collide. */
export function defaultHeadBranch(packetId: string): string {
  return `bazilion/review-${packetId.slice(0, 8)}`
}

/** A branch name this build is willing to push to. No leading dash, no traversal, no ref tricks. */
export function validateHeadBranch(branch: string): { ok: true } | { ok: false; detail: string } {
  if (branch.length === 0 || branch.length > PUBLICATION_LIMITS.branch) {
    return { ok: false, detail: 'the branch name is empty or too long' }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
    return {
      ok: false,
      detail: `the branch name has characters this build will not publish: ${branch}`,
    }
  }
  if (
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock')
  ) {
    return { ok: false, detail: `the branch name is not a valid ref: ${branch}` }
  }
  const protectedName = PUBLICATION_LIMITS.protectedBranches.find(
    (name) => name === branch || branch.endsWith(`/${name}`),
  )
  if (protectedName) {
    return {
      ok: false,
      detail: `this build never publishes to ${branch}: it is the protected branch ${protectedName}`,
    }
  }
  return { ok: true }
}

export async function capturePublication(
  db: BazilionDb,
  paths: Paths,
  authToken: string,
  intent: PublicationCaptureIntent,
): Promise<PublicationCaptureResult> {
  const packet = getReviewPacket(db, intent.packetId)
  if (!packet || packet.teamId !== intent.teamId) {
    return refused('packet_unknown', 'the review packet is unknown in this Team')
  }
  if (packet.state !== 'reviewed') {
    return refused(
      'packet_not_reviewed',
      `the packet is ${packet.state}: publishing is a decision about a reviewed revision, not a promise about one`,
    )
  }
  const conclusions = listReviewConclusions(db, packet.id)
  if (conclusions.length === 0) {
    return refused(
      'missing_reviewer_conclusion',
      'the packet has no recorded conclusion, so there is nothing reviewed to publish',
    )
  }
  const target = resolvePublicationTarget(db, authToken)
  if (!target.ok) return refused(target.reason, target.detail)

  const headBranch = (intent.headBranch ?? '').trim() || defaultHeadBranch(packet.id)
  const branch = validateHeadBranch(headBranch)
  if (!branch.ok) return refused('branch_protected', branch.detail)

  // The reviewed revision must still be reproducible: publishing bytes that are no longer the reviewed
  // ones would put an unreviewed change on a code host under a reviewed packet's name.
  const files = readReviewedRevisionFiles(db, paths, packet)
  if (!files.ok) {
    if (files.reason === 'revision_not_reproducible') {
      return refused('revision_not_reproducible', files.detail)
    }
    return refused('revision_unavailable', files.detail)
  }
  if (files.files.length === 0 && files.removed.length === 0) {
    return refused('nothing_to_publish', 'the reviewed revision holds no change to publish')
  }

  const commitMessage =
    (intent.commitMessage ?? '').trim() ||
    `${conclusionTitle(conclusions[0]?.conclusion ?? 'reviewed')}: ${packet.summary?.trim() || 'reviewed change'}`

  try {
    const publication = createPublication(db, {
      teamId: intent.teamId,
      packetId: packet.id,
      snapshotId: packet.snapshotId,
      host: target.target.host,
      repository: target.target.repository,
      baseBranch: target.target.baseBranch,
      headBranch,
      baseOid: packet.baseOid,
      commitMessage: bounded(commitMessage, PUBLICATION_LIMITS.commitMessage),
      notifyAgentId: packet.requesterKind === 'agent' ? packet.requesterAgentId : null,
    })
    return { kind: 'captured', publication }
  } catch (error) {
    if (error instanceof PublicationError) {
      return refused(error.code, error.message)
    }
    throw error
  }
}

function conclusionTitle(conclusion: string): string {
  return conclusion === 'changes_requested'
    ? 'Reviewed change with requested changes'
    : conclusion === 'recommended'
      ? 'Reviewed change'
      : 'Reviewed change (inconclusive review)'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function refused(reason: string, detail: string): PublicationCaptureResult {
  return { kind: 'refused', reason, detail: bounded(detail, PUBLICATION_LIMITS.refusalDetail) }
}
