import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import * as results from '../../core/repos/results.ts'
import { getReviewPacket } from '../../core/repos/review-packets.ts'
import {
  authorizeAgentEgress,
  CommunicationDeniedError,
  CommunicationPendingError,
  sendAgentMessage,
} from '../communication.ts'
import { releaseResultFile } from '../result-delivery.ts'
import { buildReviewExport } from './export.ts'

// BAZ-043 criterion 4: an export is a *publication*, not a download.
//
// The story requires exports to use BAZ-034's durable publication and access contract, so that an export —
// or a Telegram notification about one — cannot bypass an approval-held Agent delivery. This is that path,
// and it deliberately adds no new mechanism:
//
//   1. The export bytes are published **held**: `agent_results` stores them with a SHA-256 and a provenance
//      that names the packet and the revision, and nobody can read them yet.
//   2. The existing egress authorizer decides. `approval_required` captures the same closed `agent_result`
//      tuple every other result publication uses, leaving the bytes held and the approval queue holding it.
//   3. Only an `allow` releases the bytes, and only then does the requester get a message pointing at them.
//
// So a held export is not "created but unshared": it is stored, unreadable, with a durable approval that
// names it. That is the difference between a contract and a promise.

export type ReviewExportDelivery =
  | {
      kind: 'delivered'
      resultId: string
      resultName: string
      revision: string
      /** The artifact is released and readable; the requester's notice is waiting on its own edge. */
      noticeHeld?: boolean
    }
  | { kind: 'held'; resultId: string; revision: string; detail: string }
  | { kind: 'denied'; revision: string; detail: string }
  | { kind: 'refused'; detail: string }

export async function deliverReviewExport(
  db: BazilionDb,
  paths: Paths,
  packetId: string,
): Promise<ReviewExportDelivery> {
  const packet = getReviewPacket(db, packetId)
  if (!packet) return { kind: 'refused', detail: 'unknown review packet' }
  // A delivery needs someone to deliver *to*. An operator-only packet belongs to whoever asked for it, and
  // the export route already serves them the bytes directly.
  if (packet.requesterKind !== 'agent' || !packet.requesterAgentId) {
    return {
      kind: 'refused',
      detail:
        'this packet was not requested by an Agent, so there is nobody to deliver the export to',
    }
  }

  const exported = await buildReviewExport(db, paths, packet.teamId, packet.id)
  if (exported.kind === 'refused') return { kind: 'refused', detail: exported.refusal.detail }
  const payload = renderExportDocument(exported.export)
  const revision = exported.export.revision

  // The artifact belongs to the reviewer whose work it describes, not to the reader: ownership decides who
  // may delete it, and the reader's access comes from the authorization below.
  const producerAgentId = packet.reviewerAgentId
  if (!producerAgentId) {
    return {
      kind: 'refused',
      detail: 'this packet has no reviewer, so there is no artifact to own',
    }
  }
  const receipt = results.publish(db, {
    teamId: packet.teamId,
    agentId: producerAgentId,
    reviewPacketId: packet.id,
    reviewRevision: revision,
    name: `review-${packet.id.slice(0, 8)}-${revision.slice(0, 8)}.md`,
    mimeType: 'text/markdown',
    bytes: Buffer.from(payload, 'utf8'),
  })

  try {
    // The shipped egress tuple, unchanged: releasing an artifact into the Team's result library is the
    // disclosure, and it is the same decision for a review export as for any other result. A different
    // origin or attempt kind here would capture an approval the dispatcher cannot release.
    authorizeAgentEgress(db, producerAgentId, {
      origin: 'result_library',
      attemptKind: 'result_publication',
      attemptId: receipt.id,
      approvalPayloadKind: 'agent_result',
      approvalPayload: { agentId: producerAgentId, resultId: receipt.id },
      requester: producerAgentId,
    })
  } catch (error) {
    if (error instanceof CommunicationPendingError) {
      // Held, durable and named: the approval queue owns the disclosure, and the bytes stay unreadable.
      return {
        kind: 'held',
        resultId: receipt.id,
        revision,
        detail: 'the export is held for approval; it stays unreadable until it is released',
      }
    }
    if (error instanceof CommunicationDeniedError) {
      return {
        kind: 'denied',
        revision,
        detail: 'the current Team policy does not permit publishing this export',
      }
    }
    throw error
  }

  // Reached only on an allow. The release is what makes the bytes readable, and the notice is sent *after*
  // it, so a message can never be the thing that discloses a held artifact.
  releaseResultFile(db, producerAgentId, { resultId: receipt.id })
  const notice = deliverExportNotice(db, packet.id, receipt.id, revision)
  return {
    kind: 'delivered',
    resultId: receipt.id,
    resultName: receipt.name,
    revision,
    ...(notice === 'held' ? { noticeHeld: true } : {}),
  }
}

/**
 * Tell the requester where the export is.
 *
 * A reference, not the bytes: the access rules for a released result still apply to whoever reads it, and
 * this message is authorized by the canonical messenger like any other peer message.
 */
function deliverExportNotice(
  db: BazilionDb,
  packetId: string,
  resultId: string,
  revision: string,
): 'sent' | 'held' | 'not_sent' {
  const packet = getReviewPacket(db, packetId)
  if (!packet?.requesterAgentId || !packet.reviewerAgentId) return 'not_sent'
  try {
    sendAgentMessage(db, {
      from: packet.reviewerAgentId,
      to: packet.requesterAgentId,
      payload: [
        `A handoff for the change you asked to be reviewed is available as result:${resultId}.`,
        `It describes revision ${revision}.`,
        '',
        'It carries that revision’s patch — or says why it cannot — plus its unresolved findings and its',
        'limitations. It is a handoff, not an approval: nothing was published on your behalf.',
      ].join('\n'),
      origin: 'review_export',
      attemptKind: 'review_export_notice',
      // Per result: a re-export of a later revision is its own delivery.
      attemptId: resultId,
    })
    return 'sent'
  } catch (error) {
    // The notice is its own edge. Held means the requester will learn about a *released* export when the
    // approval is granted; it never means the artifact was disclosed.
    if (error instanceof CommunicationPendingError) return 'held'
    // A refused notice is not a failed export, and the payload is never logged.
    console.warn(
      JSON.stringify({
        event: 'review_export_notice_not_delivered',
        packetId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return 'not_sent'
  }
}

/** One document: the handoff, then the patch it refers to. Bounded by the export's own limits. */
function renderExportDocument(exported: {
  revision: string
  patch: string
  patchTruncated: boolean
  handoff: string
}): string {
  const parts = [exported.handoff]
  if (exported.patch) {
    parts.push(
      '## Patch',
      '',
      `This is the reviewed revision’s patch (${exported.revision.slice(0, 16)})${
        exported.patchTruncated ? ', truncated' : ''
      }:`,
      '',
      '```diff',
      exported.patch,
      '```',
      '',
    )
  }
  return parts.join('\n')
}
