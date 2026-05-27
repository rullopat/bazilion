// `/groups` — list bazilion groups with their member agent counts.
//
// Read-only. Pure DB call, no Telegram API surface.

import { agentRepo, groupRepo } from '../../../core/index.ts'
import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  const groups = groupRepo.list(ctx.db, ctx.paths)
  if (groups.length === 0) {
    return { text: '<i>No groups registered yet.</i>', parseMode: 'HTML' }
  }

  const lines: string[] = ['<b>bazilion groups</b>', '']
  for (const g of groups) {
    const count = agentRepo.countByGroup(ctx.db, g.id)
    const label = `<code>${htmlEscape(g.id)}</code> · ${htmlEscape(g.name)}`
    lines.push(`${label} — ${count} agent${count === 1 ? '' : 's'}`)
  }
  return { text: lines.join('\n'), parseMode: 'HTML' }
}
