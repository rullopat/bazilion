// `/unbind` — topic-context command. Clears the bound agent's
// `telegram_topic_id`, leaving the topic in Telegram as an orphan. Future
// inbound to the orphan topic routes through routing.ts's "unknown_topic"
// branch (replies "isn't bound to a bazilion agent…").
//
// Doesn't delete the Telegram topic — that's `/close` followed by a manual
// "delete topic" tap, or `bazilion agent delete --purge-telegram` from the
// CLI when that ships.

import { agentRepo } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.agent) {
    return {
      text: '/unbind is a topic-context command — run it inside an agent topic.',
      parseMode: 'HTML',
    }
  }
  agentRepo.setTelegramTopicId(ctx.db, ctx.agent.id, null)
  notifyDirectoryDirty()
  return {
    text:
      `Unbound agent <code>${htmlEscape(ctx.agent.name)}</code> from this topic. ` +
      'The topic stays in Telegram as an orphan — run /talk to bind it to another agent, or close + delete it manually.',
    parseMode: 'HTML',
  }
}
