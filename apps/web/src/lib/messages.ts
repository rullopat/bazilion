import type { Message } from '@bazilion/api-types'

/** The text of a message between Agents: its payload is JSON `{ text }`, or plain text. */
export function messageText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text
  } catch {
    // Not JSON: shown as is.
  }
  return payload
}

/** Two Agents as one key, whichever way the message went. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

export interface PairTraffic {
  /** Messages from the first id of the key to the second, and back. */
  forward: number
  back: number
  lastAt: number
}

/** How many messages went each way between each two Agents. */
export function trafficByPair(messages: readonly Message[]): Map<string, PairTraffic> {
  const pairs = new Map<string, PairTraffic>()
  for (const message of messages) {
    const key = pairKey(message.fromAgentId, message.toAgentId)
    const pair = pairs.get(key) ?? { forward: 0, back: 0, lastAt: 0 }
    if (message.fromAgentId < message.toAgentId) pair.forward++
    else pair.back++
    pair.lastAt = Math.max(pair.lastAt, message.createdAt)
    pairs.set(key, pair)
  }
  return pairs
}
