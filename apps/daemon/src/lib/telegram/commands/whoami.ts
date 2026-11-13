// `/whoami` — echo the sender's Telegram identity (the user id is what /allow takes).

import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  const u = ctx.from
  const username = u.username ? `@${u.username}` : '(no username set)'
  const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)'
  const langTag = u.language_code ?? '(none)'
  return {
    text: [
      '<b>Your Telegram identity</b>',
      `user_id:    <code>${u.id}</code>`,
      `username:   ${htmlEscape(username)}`,
      `name:       ${htmlEscape(displayName)}`,
      `language:   ${htmlEscape(langTag)}`,
      `is_bot:     ${u.is_bot}`,
    ].join('\n'),
    parseMode: 'HTML',
  }
}
