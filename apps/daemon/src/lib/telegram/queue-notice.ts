import type { BazilionDb } from '../../core/db/client.ts'
import * as queue from '../../core/repos/user-queue.ts'
import { enqueueOutbound } from './outbound-queue.ts'
import { captureTelegramQueueBinding, requireTelegramQueueBinding } from './queue-binding.ts'

interface QueueNoticeTransport {
  db: BazilionDb
  authToken: string
  botToken: string
  send: (chatId: number, topicId: number, text: string, signal: AbortSignal) => Promise<unknown>
}
let resolveTransport: (() => QueueNoticeTransport | null) | null = null
export function installQueueNoticeTransport(
  resolver: (() => QueueNoticeTransport | null) | null,
): void {
  resolveTransport = resolver
}

/** Best-effort operator receipt, never model content or a retry of the queued turn. */
export async function notifyTelegramQueueStatus(
  db: BazilionDb,
  agentId: string,
  itemId: string,
): Promise<void> {
  try {
    const transport = resolveTransport?.()
    if (!transport || transport.db !== db) return
    const item = queue.get(db, agentId, itemId)
    if (
      item?.source !== 'telegram' ||
      !['held', 'failed', 'cancelled', 'uncertain'].includes(item.status)
    )
      return
    const provenance = queue.readProvenance(db, agentId, itemId)
    const binding = requireTelegramQueueBinding(db, transport.authToken, provenance)
    if (
      binding.authorization.approvalPayload.agentId !== agentId ||
      binding.authorization.attemptId !== item.attemptId
    )
      return
    const { chatId, threadId } = binding.authorization.approvalPayload
    const text = `Follow-up ${item.id}: ${item.status}. Inspect /queue or /queue history for its receipt.${item.status === 'uncertain' ? ' It may already have acted; do not blindly retry.' : ''}`
    await enqueueOutbound(chatId, async () => {
      const live = resolveTransport?.()
      if (!live || live.db !== db || live.botToken !== transport.botToken) return
      if (queue.get(db, agentId, itemId)?.revision !== item.revision) return
      const current = requireTelegramQueueBinding(db, transport.authToken, provenance)
      captureTelegramQueueBinding(
        db,
        transport.authToken,
        current.authorization,
        transport.botToken,
      )
      await transport.send(chatId, threadId, text, AbortSignal.timeout(10_000))
    })
  } catch {
    // The durable queue outcome remains authoritative. Transport failure is never
    // reported as turn failure and does not cause automatic message replay.
  }
}
