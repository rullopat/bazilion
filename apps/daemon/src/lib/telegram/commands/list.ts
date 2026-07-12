// `/list` (alias `/agents`) — list every non-archived agent grouped by its
// bazilion team, with a deep-link if a topic is bound and a "(unbound)"
// marker if not. The directory message in Step 5 will subsume this in
// real-time form; for now `/list` is the canonical "where are my agents?"
// query.

import { agentRepo, teamRepo } from '../../../core/index.ts'
import { htmlEscape } from '../html.ts'
import { topicDeepLink } from '../naming.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  const teams = teamRepo.list(ctx.db, ctx.paths)
  const allAgents = agentRepo.list(ctx.db)
  if (allAgents.length === 0) {
    return {
      text: '<i>No agents yet. Run /spawn to create one.</i>',
      parseMode: 'HTML',
    }
  }

  // Build a map: teamId → agents[] so teams with no agents drop out.
  const byGroup = new Map<string, typeof allAgents>()
  for (const a of allAgents) {
    const bucket = byGroup.get(a.teamId) ?? []
    bucket.push(a)
    byGroup.set(a.teamId, bucket)
  }

  const lines: string[] = ['<b>bazilion agents</b>']
  for (const g of teams) {
    const members = byGroup.get(g.id)
    if (!members || members.length === 0) continue
    lines.push('', `<b>${htmlEscape(g.id)}</b>`)
    for (const a of members) {
      const topicId = agentRepo.getTelegramTopicId(ctx.db, a.id)
      const label = `  • <code>${htmlEscape(a.name)}</code>`
      if (topicId !== null) {
        const url = topicDeepLink(ctx.chatId, topicId)
        lines.push(`${label} → <a href="${url}">open</a>`)
      } else {
        lines.push(`${label} <i>(unbound)</i>`)
      }
    }
  }
  return {
    text: lines.join('\n'),
    parseMode: 'HTML',
    disableWebPagePreview: true,
  }
}
