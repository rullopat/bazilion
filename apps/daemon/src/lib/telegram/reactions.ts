// "Bot saw it" reactions on inbound user messages.
//
// When a Telegram message in a bound agent topic triggers a turn, we react
// to it with 👀 — a Telegram-native equivalent of the user-protocol's
// "read" marker that bots can't access directly. The reaction is cleared
// once the agent's reply lands (the mirror calls clearReactionsFor on the
// first assistant_message / error / fatal frame).
//
// Several messages can wait in the queue while a turn runs; each gets its own 👀 and they all
// clear on the next reply. Reaction failures are silent — the indicator is cosmetic.

import { telegramLive } from './live.ts'

const SEEN_EMOJI = '👀'

interface Pending {
  chatId: number
  messageId: number
}

const _pendingByAgent = new Map<string, Pending[]>()

/**
 * React with 👀 to the user's message + track it so `clearReactionsFor`
 * can remove it when the reply lands. No-op when the bot isn't running.
 *
 * Fired directly (not through the per-supergroup outbound queue) because
 * reactions are cheap, cosmetic, and shouldn't compete with sendMessage
 * for the per-chat rate budget. Failures are silently swallowed.
 */
export function reactSeen(agentId: string, chatId: number, messageId: number): void {
  const live = telegramLive()
  if (!live) return
  const list = _pendingByAgent.get(agentId) ?? []
  list.push({ chatId, messageId })
  _pendingByAgent.set(agentId, list)
  void live.api
    .setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji: SEEN_EMOJI }])
    .catch(() => undefined)
}

/**
 * Clear every pending 👀 for this agent. Called by the mirror when the
 * first assistant_message / error / fatal frame goes out, so the user sees
 * their reaction clear at the same moment the reply appears.
 */
export function clearReactionsFor(agentId: string): void {
  const list = _pendingByAgent.get(agentId)
  if (!list || list.length === 0) return
  _pendingByAgent.delete(agentId)
  const live = telegramLive()
  if (!live) return
  for (const { chatId, messageId } of list) {
    void live.api.setMessageReaction(chatId, messageId, []).catch(() => undefined)
  }
}

/** Drop all pending reactions (test cleanup). */
export function _resetReactionsForTest(): void {
  _pendingByAgent.clear()
}

/** Test helper — current pending count for an agent. */
export function _pendingCountForTest(agentId: string): number {
  return _pendingByAgent.get(agentId)?.length ?? 0
}
