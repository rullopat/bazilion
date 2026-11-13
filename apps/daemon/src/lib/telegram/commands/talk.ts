// `/talk <agent>`: open the agent's forum topic, creating it on first use. Accepts a bare name
// ("researcher") or a team-qualified one ("home-reno/researcher").

import { htmlEscape } from '../html.ts'
import { resolveAgentArg } from '../resolve-agent.ts'
import { ensureAgentTopic } from '../topic-autocreate.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.args) {
    return {
      text: 'Usage: <code>/talk &lt;agent&gt;</code> — or <code>/talk &lt;team&gt;/&lt;agent&gt;</code> when ambiguous.\nRun /list to see available agents.',
      parseMode: 'HTML',
    }
  }
  const resolved = resolveAgentArg(ctx.db, ctx.args, 'talk')
  if ('reply' in resolved) return resolved.reply

  const ensured = await ensureAgentTopic({
    db: ctx.db,
    paths: ctx.paths,
    api: ctx.api,
    chatId: ctx.chatId,
    agentId: resolved.agent.id,
  })
  if (ensured.kind === 'agent-not-found') {
    // Deleted between resolving and creating the topic.
    return { text: 'That agent no longer exists.' }
  }
  if (ensured.kind === 'team-not-found') {
    return {
      text: `Agent <code>${htmlEscape(resolved.agent.name)}</code> exists but its team does not — please re-create the team.`,
      parseMode: 'HTML',
    }
  }
  const verb = ensured.created ? 'Created topic for' : 'Already bound to'
  return {
    text:
      `${verb} agent <code>${htmlEscape(ensured.agent.name)}</code>` +
      ` (team <code>${htmlEscape(ensured.agent.teamId)}</code>).`,
    parseMode: 'HTML',
    disableWebPagePreview: true,
    // A URL button reads better than an inline link on desktop and Android. iOS opens the
    // topic list instead of the topic (see naming.ts:topicDeepLink).
    replyMarkup: {
      inline_keyboard: [[{ text: 'Open topic →', url: ensured.deepLink }]],
    },
  }
}
