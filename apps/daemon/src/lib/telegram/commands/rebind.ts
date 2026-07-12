// `/rebind <agent>` — topic-context command. Points the current topic at
// a different agent. Resolution accepts bare names ("/rebind researcher")
// and qualified `team/name` ("/rebind home-reno/researcher"), same as
// `/talk`.
//
// Refuses if the target agent already has a topic — the operator should
// /unbind on the target's existing topic first, or use /talk to switch
// surfaces. This keeps each agent ↔ topic mapping unambiguous.

import { agentRepo } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import { topicDeepLink } from '../naming.ts'
import { parseAndResolveAgent } from '../resolve-agent.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.agent || ctx.topicId === undefined) {
    return {
      text: '/rebind is a topic-context command — run it inside an agent topic.',
      parseMode: 'HTML',
    }
  }

  if (!ctx.args) {
    return {
      text: 'Usage: <code>/rebind &lt;agent&gt;</code> — or <code>/rebind &lt;team&gt;/&lt;agent&gt;</code> when ambiguous.',
      parseMode: 'HTML',
    }
  }

  const resolution = parseAndResolveAgent(ctx.db, ctx.args)

  switch (resolution.kind) {
    case 'bad-input':
      return { text: htmlEscape(resolution.message), parseMode: 'HTML' }

    case 'not-found':
      return {
        text: `No agent matches <code>${htmlEscape(ctx.args.trim())}</code>. Try /list to see available agents.`,
        parseMode: 'HTML',
      }

    case 'ambiguous': {
      const lines = [
        `Multiple agents match <code>${htmlEscape(ctx.args.trim())}</code>:`,
        ...resolution.matches.map(
          (a) => `  • <code>${htmlEscape(a.teamId)}/${htmlEscape(a.name)}</code>`,
        ),
        '',
        'Use <code>/rebind &lt;team&gt;/&lt;agent&gt;</code> to disambiguate.',
      ]
      return { text: lines.join('\n'), parseMode: 'HTML' }
    }

    case 'ok': {
      const target = resolution.agent

      // Refuse to clobber an existing binding. Forces the operator to
      // /unbind the target's old topic first — keeps each agent's history
      // anchored to a single topic.
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

      // Swap: clear current agent's binding, set target's binding.
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
  }
}
