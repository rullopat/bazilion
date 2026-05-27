// "Bot saw it" reactions on inbound user messages.
//
// When a Telegram message in a bound agent topic triggers a turn, we react
// to it with 👀 — a Telegram-native equivalent of the user-protocol's
// "read" marker that bots can't access directly. The reaction is cleared
// once the agent's reply lands (the mirror calls clearReactionsFor on the
// first assistant_message / error / fatal frame).
//
// Multiple inbounds can stack while a turn is in flight (the inbound queue
// concatenates them); each gets its own 👀, and they all clear together
// when the combined reply arrives. Reaction failures are silent — the
// indicator is cosmetic and we don't want to interrupt the turn for it.

const SEEN_EMOJI = '👀'

/** Bot API subset reactions.ts uses. */
export interface ReactionsApi {
  setMessageReaction(
    chatId: number,
    messageId: number,
    reaction: Array<{ type: 'emoji'; emoji: string }>,
  ): Promise<boolean>
}

interface ReactionsDeps {
  api: ReactionsApi
  chatId: number
}

let _liveDepsResolver: (() => ReactionsDeps | null) | null = null

export function installReactionsDepsResolver(resolver: () => ReactionsDeps | null): void {
  _liveDepsResolver = resolver
}

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
  const deps = _liveDepsResolver?.()
  if (!deps) return
  const list = _pendingByAgent.get(agentId) ?? []
  list.push({ chatId, messageId })
  _pendingByAgent.set(agentId, list)
  void deps.api
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
  const deps = _liveDepsResolver?.()
  if (!deps) return
  for (const { chatId, messageId } of list) {
    void deps.api.setMessageReaction(chatId, messageId, []).catch(() => undefined)
  }
}

/** Drop all pending reactions (test cleanup). */
export function _resetReactionsForTest(): void {
  _pendingByAgent.clear()
  _liveDepsResolver = null
}

/** Test helper — current pending count for an agent. */
export function _pendingCountForTest(agentId: string): number {
  return _pendingByAgent.get(agentId)?.length ?? 0
}
