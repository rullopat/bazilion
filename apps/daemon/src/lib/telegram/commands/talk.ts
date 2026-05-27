// `/talk <agent>` — bind a forum topic to the named agent (auto-create if
// not yet bound). Resolution accepts bare names ("/talk researcher") and
// group-qualified names ("/talk home-reno/researcher"). Reply contains a
// deep-link to the new or existing topic.
//
// Step 3 only resolves to existing agents — see the doc's Step 3 design
// decisions. Spawning new agents is `/spawn` and ships in Step 4.

import { htmlEscape } from '../html.ts'
import { parseAndResolveAgent } from '../resolve-agent.ts'
import { ensureAgentTopic } from '../topic-autocreate.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (!ctx.args) {
    return {
      text: 'Usage: <code>/talk &lt;agent&gt;</code> — or <code>/talk &lt;group&gt;/&lt;agent&gt;</code> when ambiguous.\nRun /list to see available agents.',
      parseMode: 'HTML',
    }
  }

  const resolution = parseAndResolveAgent(ctx.db, ctx.args)

  switch (resolution.kind) {
    case 'bad-input':
      return { text: htmlEscape(resolution.message), parseMode: 'HTML' }

    case 'not-found':
      return {
        text:
          `No agent matches <code>${htmlEscape(ctx.args.trim())}</code>.\n` +
          'Try /list to see available agents, or /spawn to create one.',
        parseMode: 'HTML',
      }

    case 'ambiguous': {
      const lines = [
        `Multiple agents match <code>${htmlEscape(ctx.args.trim())}</code>:`,
        ...resolution.matches.map(
          (a) => `  • <code>${htmlEscape(a.groupId)}/${htmlEscape(a.name)}</code>`,
        ),
        '',
        'Use <code>/talk &lt;group&gt;/&lt;agent&gt;</code> to disambiguate.',
      ]
      return { text: lines.join('\n'), parseMode: 'HTML' }
    }

    case 'ok': {
      const ensured = await ensureAgentTopic({
        db: ctx.db,
        paths: ctx.paths,
        api: ctx.api,
        chatId: ctx.chatId,
        agentId: resolution.agent.id,
      })
      if (ensured.kind === 'agent-not-found') {
        // Race condition: the agent existed during resolve but is gone now
        // (concurrent deletion). Rare but handle gracefully.
        return { text: 'Agent disappeared between resolve and topic-create.', parseMode: 'HTML' }
      }
      if (ensured.kind === 'group-not-found') {
        return {
          text: `Agent <code>${htmlEscape(ensured.kind)}</code> exists but its group does not — please re-create the group.`,
          parseMode: 'HTML',
        }
      }
      const verb = ensured.created ? 'Created topic for' : 'Already bound to'
      return {
        text:
          `${verb} agent <code>${htmlEscape(ensured.agent.name)}</code>` +
          ` (group <code>${htmlEscape(ensured.agent.groupId)}</code>).`,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        // URL button reads cleaner than an inline anchor on desktop/Android.
        // See naming.ts:topicDeepLink for the iOS topic-navigation limit
        // (which neither URL form nor tg:// scheme can work around).
        replyMarkup: {
          inline_keyboard: [[{ text: 'Open topic →', url: ensured.deepLink }]],
        },
      }
    }
  }
}
