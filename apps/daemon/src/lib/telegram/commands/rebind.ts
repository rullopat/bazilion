// `/rebind <agent>`: point the current topic at a different agent. Refuses when the target
// already has a topic, so each agent keeps exactly one: /unbind that topic first, or use /talk.

import { agentRepo } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import { topicDeepLink } from '../naming.ts'
import { resolveAgentArg } from '../resolve-agent.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.agent || ctx.topicId === undefined) {
    return { text: '/rebind is a topic-context command — run it inside an agent topic.' }
  }
  if (!ctx.args) {
    return {
      text: 'Usage: <code>/rebind &lt;agent&gt;</code> — or <code>/rebind &lt;team&gt;/&lt;agent&gt;</code> when ambiguous.',
      parseMode: 'HTML',
    }
  }
  const resolved = resolveAgentArg(ctx.db, ctx.args, 'rebind')
  if ('reply' in resolved) return resolved.reply

  const target = resolved.agent
  if (target.id === ctx.agent.id) {
    return {
      text: `This topic is already bound to <code>${htmlEscape(target.name)}</code>.`,
      parseMode: 'HTML',
    }
  }
  const existingTargetTopic = agentRepo.getTelegramTopicId(ctx.db, target.id)
  if (existingTargetTopic !== null) {
    return {
      text:
        `Agent <code>${htmlEscape(target.name)}</code> is already bound to topic ` +
        `<a href="${topicDeepLink(ctx.chatId, existingTargetTopic)}">#${existingTargetTopic}</a>.\n` +
        'Run /unbind there first, or use /talk to switch surfaces.',
      parseMode: 'HTML',
      disableWebPagePreview: true,
    }
  }

  agentRepo.setTelegramTopicId(ctx.db, ctx.agent.id, null)
  agentRepo.setTelegramTopicId(ctx.db, target.id, ctx.topicId)
  notifyDirectoryDirty()
  return {
    text:
      `Topic rebound from <code>${htmlEscape(ctx.agent.name)}</code> to <code>${htmlEscape(target.name)}</code>.\n` +
      `<code>${htmlEscape(ctx.agent.name)}</code> is now unbound — run /talk to give it a fresh topic.`,
    parseMode: 'HTML',
  }
}
