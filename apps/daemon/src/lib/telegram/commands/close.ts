// `/close` — topic-context command. Closes the current forum topic in
// Telegram while preserving the agent ↔ topic binding so the operator can
// reopen the topic (manually in Telegram, or by recreating via /talk if
// the original topic was also deleted).
//
// Telegram's `closeForumTopic` is idempotent on already-closed topics so
// repeat calls are safe.

import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.agent || ctx.topicId === undefined) {
    // Defensive — the router should never call /close outside a bound
    // agent topic. If it ever happens (e.g. future routing change), reply
    // gracefully instead of crashing.
    return {
      text: '/close is a topic-context command — run it inside an agent topic.',
      parseMode: 'HTML',
    }
  }
  try {
    await ctx.api.closeForumTopic(ctx.chatId, ctx.topicId)
  } catch (e) {
    return {
      text: `Couldn't close the topic: ${htmlEscape(e instanceof Error ? e.message : String(e))}`,
      parseMode: 'HTML',
    }
  }
  return {
    text:
      `Topic closed. Agent <code>${htmlEscape(ctx.agent.name)}</code> stays bound — ` +
      'reopen this topic in Telegram, or run /talk to recreate it from the service chat.',
    parseMode: 'HTML',
  }
}
