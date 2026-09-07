import type { ChatFrame } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import {
  authorizeAgentEgress,
  CommunicationDeniedError,
  CommunicationPendingError,
} from './communication.ts'
import { capturedResultFile, releaseResultFile } from './result-delivery.ts'

/** Background turns have no HTTP consumer to authorize their library delivery. */
export function authorizeBackgroundResult(db: BazilionDb, agentId: string, frame: ChatFrame): void {
  if (frame.kind !== 'event' || frame.event.type !== 'file' || !frame.event.result) return
  const file = capturedResultFile(db, agentId, frame.event)
  const resultId = frame.event.result.resultId
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
  } catch (error) {
    if (error instanceof CommunicationDeniedError || error instanceof CommunicationPendingError)
      return
    throw error
  }
}
