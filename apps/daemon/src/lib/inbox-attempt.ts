import { createHash } from 'node:crypto'
import type { Message } from '@bazilion/api-types'

/** Bounded opaque correlation, not authorization. Keep the ordered claimed IDs, never payloads. */
export function inboxAttemptId(agentId: string, messages: readonly Pick<Message, 'id'>[]): string {
  const hash = createHash('sha256').update('bazilion-inbox-turn-v1\0')
  const add = (value: string) => {
    const bytes = Buffer.from(value, 'utf8')
    hash.update(`${bytes.length}:`)
    hash.update(bytes)
  }
  add(agentId)
  for (const message of messages) add(message.id)
  return `inbox:${hash.digest('hex')}`
}
