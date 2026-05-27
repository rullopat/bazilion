// `/whoami` — echo the sender's Telegram identity.
//
// Seed for a future per-user ACL system (the doc's "command_allow_from"
// allowlist keyed on Telegram user_id). For now it's diagnostic: lets the
// operator confirm the bot is actually reading their inputs.

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
