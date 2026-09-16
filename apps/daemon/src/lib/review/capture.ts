import type {
  ReviewAttempt,
  ReviewConclusionEntry,
  ReviewFinding,
  ReviewPacketReport,
  ReviewPacketSummary,
  ReviewPacket as ReviewPacketWire,
  ReviewRequester,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import {
  createReviewPacket,
  getTeamReviewPacket,
  listReviewAttempts,
  listReviewConclusions,
  listReviewFindings,
  listReviewPackets,
  type ReviewConclusionRow,
  type ReviewFindingRow,
  type ReviewPacketRecord,
} from '../../core/repos/review-packets.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import { readSnapshotApplicability, requireTeam } from '../git-review/service.ts'

// BAZ-043: capture a review packet, and read it back for the operator surfaces.
//
// Capture validates the *actual* inputs rather than the caller's description of them: the revision must
// be a snapshot of this Team inside its window, the reviewer (when there is one) must be a live member
// of the same Team, and the requester must be a member and never the reviewer. Anything unavailable is
// reported as a blocker — never substituted, and never captured as a packet that fails later.
//
// Findings are read with per-path staleness rather than a single packet-level flag, because that is the
// property a review has to keep: a finding is about a path in a revision, and it stops applying when
// that path moves.

export type ReviewCaptureIntent = {
  teamId: string
  snapshotId: string
  reviewerAgentId?: string | null
  summary?: string | null
} & (
  | { requesterKind: 'agent'; requesterAgentId: string }
  | { requesterKind: 'operator'; requesterAgentId?: null }
)

export type ReviewCaptureBlocker =
  | { reason: 'team_unavailable'; detail: string }
  | { reason: 'snapshot_unavailable'; detail: string }
  | { reason: 'snapshot_incomplete'; detail: string }
  | { reason: 'requester_unavailable'; detail: string }
  | { reason: 'reviewer_unavailable'; detail: string }
  | { reason: 'reviewer_is_requester'; detail: string }

export type ReviewCaptureResult =
  | { kind: 'captured'; packet: ReviewPacketRecord }
  | { kind: 'blocked'; blocker: ReviewCaptureBlocker }

function blocked(reason: ReviewCaptureBlocker['reason'], detail: string): ReviewCaptureResult {
  return { kind: 'blocked', blocker: { reason, detail } }
}

function safeTeam(db: BazilionDb, paths: Paths, teamId: string) {
  try {
    return requireTeam(db, paths, teamId)
  } catch {
    return null
  }
}

/** Capture one packet, or explain precisely why the requested review cannot happen. */
export function captureReviewPacket(
  db: BazilionDb,
  paths: Paths,
  intent: ReviewCaptureIntent,
): ReviewCaptureResult {
  const team = safeTeam(db, paths, intent.teamId)
  if (!team) return blocked('team_unavailable', 'the request does not name a known Team')

  if (intent.requesterKind === 'agent') {
    const requester = getAgent(db, intent.requesterAgentId)
    if (!requester || requester.teamId !== team.id || requester.status === 'archived') {
      return blocked('requester_unavailable', 'the requester is not a live member of this Team')
    }
  }

  if (intent.reviewerAgentId) {
    const reviewer = getAgent(db, intent.reviewerAgentId)
    // Membership is re-read here rather than trusted from the caller: the reviewer must be a live
    // member of *this* Team right now.
    if (!reviewer || reviewer.teamId !== team.id || reviewer.status === 'archived') {
      return blocked('reviewer_unavailable', 'the reviewer is not a live member of this Team')
    }
    if (intent.requesterKind === 'agent' && intent.requesterAgentId === reviewer.id) {
      // Self-review is not a review. The schema also refuses it, so this is the friendly refusal.
      return blocked('reviewer_is_requester', 'the reviewer and the requester are the same Agent')
    }
  }

  const snapshot = getSourceSnapshot(db, team.id, intent.snapshotId)
  if (!snapshot) {
    // Covers "never captured" and "past its window": neither can support a review of a revision.
    return blocked(
      'snapshot_unavailable',
      'the revision was not captured in this Team, or its evidence window has passed',
    )
  }
  let manifest: { complete?: boolean; head?: string | null; base?: { resolvedOid?: string } }
  try {
    manifest = JSON.parse(snapshot.manifestJson) as typeof manifest
  } catch {
    return blocked('snapshot_unavailable', 'the captured revision could not be read')
  }
  if (!manifest.complete) {
    // An incomplete capture cannot support a claim about the revision, and reviewing part of a change
    // while presenting it as the change is worse than refusing.
    return blocked(
      'snapshot_incomplete',
      'the revision was captured with incomplete coverage, so a fresh capture is required',
    )
  }
  const baseOid = manifest.base?.resolvedOid
  if (!baseOid)
    return blocked('snapshot_unavailable', 'the captured revision has no comparison base')

  return {
    kind: 'captured',
    packet: createReviewPacket(db, {
      teamId: team.id,
      requesterKind: intent.requesterKind,
      requesterAgentId: intent.requesterKind === 'agent' ? intent.requesterAgentId : null,
      reviewerAgentId: intent.reviewerAgentId ?? null,
      snapshotId: intent.snapshotId,
      snapshotComplete: true,
      head: manifest.head ?? null,
      baseOid,
      summary: intent.summary ?? null,
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Wire views. One composer per shape, so a list and a detail view cannot disagree about the same packet.
// ---------------------------------------------------------------------------------------------

function requesterOf(kind: 'agent' | 'operator', agentId: string | null): ReviewRequester {
  return { kind, agentId }
}

export function toWirePacket(packet: ReviewPacketRecord): ReviewPacketWire {
  return {
    id: packet.id,
    requester: requesterOf(packet.requesterKind, packet.requesterAgentId),
    reviewerAgentId: packet.reviewerAgentId,
    snapshot: {
      id: packet.snapshotId,
      complete: packet.snapshotComplete,
      head: packet.head,
      baseOid: packet.baseOid,
    },
    summary: packet.summary,
    state: packet.state,
    createdAt: packet.createdAt,
    expiresAt: packet.expiresAt,
    exportedAt: packet.exportedAt,
    exportRevision: packet.exportRevision,
  }
}

function toWireFinding(
  finding: ReviewFindingRow,
  applicability: ReviewFinding['applicability'],
): ReviewFinding {
  return {
    id: finding.id,
    path: finding.path,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    severity: finding.severity,
    note: finding.note,
    author: requesterOf(finding.authorKind, finding.authorAgentId),
    snapshotId: finding.snapshotId,
    state: finding.state,
    resolution:
      finding.state === 'resolved' && finding.resolutionKind && finding.resolvedAt !== null
        ? {
            kind: finding.resolutionKind,
            note: finding.resolutionNote ?? '',
            at: finding.resolvedAt,
            by: requesterOf(
              finding.resolvedByKind ?? 'operator',
              finding.resolvedByAgentId ?? null,
            ),
          }
        : null,
    createdAt: finding.createdAt,
    applicability,
  }
}

function toWireConclusion(entry: ReviewConclusionRow): ReviewConclusionEntry {
  return {
    reviewer: requesterOf(entry.reviewerKind, entry.reviewerAgentId),
    conclusion: entry.conclusion,
    note: entry.note,
    snapshotId: entry.snapshotId,
    createdAt: entry.createdAt,
  }
}

function toWireAttempt(attempt: ReviewAttempt): ReviewAttempt {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    state: attempt.state,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    error: attempt.error,
  }
}

/**
 * Per-path applicability for a packet's findings.
 *
 * A finding of the reviewed revision is `identical` while that path has not moved, `changed` once it
 * has. Both are facts about the *source*: neither says the finding was addressed, which is why
 * resolution stays an explicit decision.
 */
async function findingApplicability(
  db: BazilionDb,
  paths: Paths,
  packet: ReviewPacketRecord,
): Promise<{
  comparison: 'identical' | 'changed' | 'unknown'
  perPath: Map<string, 'identical' | 'changed' | 'unknown'>
}> {
  try {
    const applicability = await readSnapshotApplicability(
      db,
      paths,
      packet.teamId,
      packet.snapshotId,
    )
    // Whole-tree comparison establishes the packet's status. Per-path detail is the same answer for
    // every path in this revision: the capture either still matches or it does not.
    const perPath = new Map<string, 'identical' | 'changed' | 'unknown'>()
    for (const finding of listReviewFindings(db, packet.id)) {
      perPath.set(finding.path, applicability.comparison)
    }
    return { comparison: applicability.comparison, perPath }
  } catch {
    return { comparison: 'unknown', perPath: new Map() }
  }
}

/** The detail view: the packet, its findings, its reviewers' conclusions and how the tree stands now. */
export async function readReviewPacketReport(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  packetId: string,
): Promise<ReviewPacketReport | null> {
  const packet = getTeamReviewPacket(db, teamId, packetId)
  if (!packet) return null
  const attempts = listReviewAttempts(db, packet.id).map(toWireAttempt)
  const conclusions = listReviewConclusions(db, packet.id).map(toWireConclusion)
  const applicability = await findingApplicability(db, paths, packet)
  const findings = listReviewFindings(db, packet.id).map((finding) =>
    toWireFinding(finding, applicability.perPath.get(finding.path) ?? applicability.comparison),
  )
  const reviewed = conclusions.length > 0
  return {
    packet: toWirePacket(packet),
    findings,
    conclusions,
    attempts,
    applicability: {
      comparison: applicability.comparison,
      stale: applicability.comparison !== 'identical',
    },
    facts: {
      // Preparing a change is not reviewing it, and neither is acceptance. Only what has evidence.
      changePrepared: packet.snapshotComplete,
      // Checks are BAZ-041 evidence and are not implied by a packet; a caller that has them adds them.
      checksCurrent: false,
      reviewed,
      // Operator-reported external states start empty: this story records what it is told, and nothing
      // here may claim a commit, a pull request or a deployment on its own.
      reported: {
        committed: null,
        pushed: null,
        pullRequest: null,
        merged: null,
        deployed: null,
        productionAccepted: null,
      },
    },
  }
}

/** The list view: no per-path applicability, because establishing it walks the repository. */
export function readReviewPacketSummaries(
  db: BazilionDb,
  teamId: string,
  limit = 50,
): ReviewPacketSummary[] {
  return listReviewPackets(db, teamId, limit).map((packet) => {
    const findings = listReviewFindings(db, packet.id)
    const conclusion = listReviewConclusions(db, packet.id).at(-1)?.conclusion ?? null
    return {
      packet: toWirePacket(packet),
      counts: {
        findings: findings.length,
        unresolved: findings.filter((finding) => finding.state !== 'resolved').length,
        blockers: findings.filter(
          (finding) => finding.severity === 'blocker' && finding.state !== 'resolved',
        ).length,
      },
      conclusion,
    }
  })
}
