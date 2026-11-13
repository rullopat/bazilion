// `/list` (alias `/agents`): every agent grouped by team, linked to its topic when bound.

import { agentRepo } from '../../../core/index.ts'
import { agentListLines } from '../directory.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  if (agentRepo.list(ctx.db).length === 0) {
    return { text: '<i>No agents yet. Run /spawn to create one.</i>', parseMode: 'HTML' }
  }
  return {
    text: ['<b>bazilion agents</b>', ...agentListLines(ctx.db, ctx.paths, ctx.chatId)].join('\n'),
    parseMode: 'HTML',
    disableWebPagePreview: true,
  }
}
