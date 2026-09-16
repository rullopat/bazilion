import type {
  ReviewConclusionInput,
  ReviewFindingInput,
  ReviewPacketBrief,
  ReviewPathContent,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  addReviewFinding,
  getReviewPacket,
  listReviewConclusions,
  listReviewFindings,
  type ReviewPacketRecord,
  recordReviewConclusion,
} from '../../core/repos/review-packets.ts'
import type { ReviewCapabilityHost } from '../../runtime/tools/review.ts'
import { readSnapshotApplicability } from '../git-review/service.ts'
import { readRevisionChanges, readRevisionPatch } from './revision.ts'

// BAZ-043: what a reviewer Agent is allowed to reach.
//
// The host is the authority, not the tools: it decides which paths exist in the reviewed revision, whether
// that revision's content can still be reproduced, and what a finding may attach to. A reviewer is
// read-only by construction — there is no execution path in this file at all.
//
// Content is the interesting part. A BAZ-042 snapshot stores paths and digests, never bytes, so a patch
// for the reviewed revision exists only while the working tree still matches the capture. The host reports
// which of the two a reviewer has instead of handing it the current tree as if it were the reviewed one.

export interface ReviewCapabilityInput {
  db: BazilionDb
  paths: Paths
  packet: ReviewPacketRecord
  attemptId: string
  /** Re-checked before anything is read or written, so a finished turn cannot act. */
  assertActive: () => void
}

export function createReviewCapabilityHost(input: ReviewCapabilityInput): ReviewCapabilityHost {
  const packet = input.packet

  async function revisions(): Promise<{
    changes: Array<{ path: string; status: string; previousPath: string | null }>
    contentAvailable: boolean
    contentUnavailableReason: string | null
  }> {
    const revision = await readRevisionChanges(input.db, input.paths, packet)
    if (!revision.ok) {
      return {
        changes: [],
        contentAvailable: false,
        contentUnavailableReason: revision.reason,
      }
    }
    const applicability = await readSnapshotApplicability(
      input.db,
      input.paths,
      packet.teamId,
      packet.snapshotId,
    ).catch(() => null)
    const contentAvailable = applicability?.comparison === 'identical'
    return {
      changes: revision.changes,
      contentAvailable,
      contentUnavailableReason: contentAvailable
        ? null
        : applicability?.comparison === 'changed'
          ? 'the working tree changed after the capture, so the reviewed revision’s content is no longer reproducible'
          : 'the reviewed revision could not be compared with the working tree',
    }
  }

  return {
    async read(): Promise<ReviewPacketBrief> {
      input.assertActive()
      const revision = await revisions()
      const findings = listReviewFindings(input.db, packet.id)
      const conclusion = listReviewConclusions(input.db, packet.id).at(-1) ?? null
      return {
        packetId: packet.id,
        summary: packet.summary,
        snapshot: {
          id: packet.snapshotId,
          complete: packet.snapshotComplete,
          head: packet.head,
          baseOid: packet.baseOid,
        },
        changes: revision.changes,
        contentAvailable: revision.contentAvailable,
        contentUnavailableReason: revision.contentUnavailableReason,
        findings: findings.map((finding) => ({
          id: finding.id,
          path: finding.path,
          severity: finding.severity,
          note: finding.note,
          authorKind: finding.authorKind,
        })),
        conclusion: conclusion?.conclusion ?? null,
      }
    },

    async path(path): Promise<ReviewPathContent> {
      input.assertActive()
      const revision = await revisions()
      // Only a path the capture recorded exists in this revision. A path that is merely present in the
      // working tree is a different code base's file.
      if (!revision.changes.some((change) => change.path === path)) {
        return {
          path,
          patch: null,
          truncated: false,
          reason: 'that path is not part of the reviewed revision',
        }
      }
      if (!revision.contentAvailable) {
        return {
          path,
          patch: null,
          truncated: false,
          reason:
            revision.contentUnavailableReason ??
            'the reviewed revision’s content is no longer reproducible',
        }
      }
      const patch = await readRevisionPatch(input.db, input.paths, packet, path)
      input.assertActive()
      return patch
    },

    async addFinding(finding: ReviewFindingInput) {
      input.assertActive()
      const revision = await revisions()
      if (revision.changes.length === 0) {
        return refused(
          `the reviewed revision could not be read: ${revision.contentUnavailableReason}`,
        )
      }
      // A finding attaches to a path in the reviewed revision. Anything else cannot be correlated to it,
      // which would make the finding unverifiable rather than useful.
      if (!revision.changes.some((change) => change.path === finding.path)) {
        return refused(
          `${finding.path} is not part of the reviewed revision; findings must name one of: ${revision.changes
            .map((change) => change.path)
            .join(', ')}`,
        )
      }
      const before = listReviewFindings(input.db, packet.id).length
      const created = addReviewFinding(input.db, {
        packetId: packet.id,
        authorKind: 'agent',
        authorAgentId: packet.reviewerAgentId,
        path: finding.path,
        severity: finding.severity,
        note: finding.note,
        lineStart: finding.lineStart ?? null,
        lineEnd: finding.lineEnd ?? null,
        // The revision the finding was made against — the packet's capture, never "whatever is on disk".
        snapshotId: packet.snapshotId,
        // A finding whose content could not be read is recorded as unverified: it is a statement about a
        // revision the reviewer could only see the shape of, and saying so is the honest outcome.
        state: revision.contentAvailable ? 'open' : 'unverified',
      })
      return { findingId: created.id, ordinal: before + 1 }
    },

    async conclude(conclusion: ReviewConclusionInput) {
      input.assertActive()
      const recorded = recordReviewConclusion(input.db, {
        packetId: packet.id,
        reviewerKind: 'agent',
        reviewerAgentId: packet.reviewerAgentId,
        conclusion: conclusion.conclusion,
        note: conclusion.note ?? null,
        snapshotId: packet.snapshotId,
      })
      return { conclusion: recorded.conclusion }
    },
  }
}

/** A capability refusal is a typed error so the tool reports it and the model can correct itself. */
function refused(message: string): never {
  throw new Error(message)
}

/** Read back a packet for a reviewer, refusing anything but this Team's live packet. */
export function requireReviewPacket(db: BazilionDb, packetId: string): ReviewPacketRecord {
  const packet = getReviewPacket(db, packetId)
  if (!packet) throw new Error('review packet is no longer available')
  return packet
}
