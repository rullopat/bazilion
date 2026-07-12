// `/teams` — list bazilion teams with their member agent counts.
//
// Read-only. Pure DB call, no Telegram API surface.

import { agentRepo, teamRepo } from '../../../core/index.ts'
import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  const teams = teamRepo.list(ctx.db, ctx.paths)
  if (teams.length === 0) {
    return { text: '<i>No teams registered yet.</i>', parseMode: 'HTML' }
  }

  const lines: string[] = ['<b>bazilion teams</b>', '']
  for (const g of teams) {
    const count = agentRepo.countByGroup(ctx.db, g.id)
    const label = `<code>${htmlEscape(g.id)}</code> · ${htmlEscape(g.name)}`
    lines.push(`${label} — ${count} agent${count === 1 ? '' : 's'}`)
  }
  return { text: lines.join('\n'), parseMode: 'HTML' }
}
