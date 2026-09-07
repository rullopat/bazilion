import type { ResultReference } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import * as results from '../core/repos/results.ts'

/** Resolve the captured receipt before authorization captures an outbound attempt. */
export function capturedResultFile(
  db: BazilionDb,
  agentId: string,
  file: { name: string; mimeType: string; data: string; result?: ResultReference },
) {
  if (!file.result) return file
  const receipt = results.getReceipt(db, file.result.resultId)
  if (!receipt || receipt.agentId !== agentId)
    throw new Error('Captured result does not belong to this producer')
  return {
    name: receipt.name,
    mimeType: receipt.mimeType,
    data: results.readCaptured(db, receipt.id).toString('base64'),
    result: { resultId: receipt.id },
  }
}

/** Only the existing egress authorizer and approval dispatcher call this after allow. */
export function releaseResultFile(db: BazilionDb, agentId: string, result?: ResultReference): void {
  if (result) results.release(db, result.resultId, agentId)
}
