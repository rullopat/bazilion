import type { ChatFrame, CommunicationApproval } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import {
  authorizeAgentEgress,
  CommunicationDeniedError,
  CommunicationPendingError,
} from './communication.ts'
import { capturedResultFile, releaseResultFile } from './result-delivery.ts'

export type LibraryResultAuthorization =
  | { status: 'released' }
  | { status: 'denied' }
  | { status: 'approval_required'; approval: CommunicationApproval }

/** One canonical library egress path, also used by explicit operator image recovery. */
export function authorizeCapturedLibraryResult(
  db: BazilionDb,
  agentId: string,
  resultId: string,
): LibraryResultAuthorization {
  const file = capturedResultFile(db, agentId, {
    name: '',
    mimeType: '',
    data: '',
    result: { resultId },
  })
  try {
    authorizeAgentEgress(db, agentId, {
      origin: 'result_library',
      attemptKind: 'result_publication',
      attemptId: resultId,
      approvalPayloadKind: 'agent_result',
      approvalPayload: { agentId, resultId },
      requester: agentId,
    })
    releaseResultFile(db, agentId, file.result)
    return { status: 'released' }
  } catch (error) {
    if (error instanceof CommunicationPendingError)
      return { status: 'approval_required', approval: error.approval }
    if (error instanceof CommunicationDeniedError) return { status: 'denied' }
    throw error
  }
}

/** Background turns have no HTTP consumer to authorize their library delivery. */
export function authorizeBackgroundResult(db: BazilionDb, agentId: string, frame: ChatFrame): void {
  if (frame.kind !== 'event' || frame.event.type !== 'file' || !frame.event.result) return
  authorizeCapturedLibraryResult(db, agentId, frame.event.result.resultId)
}
