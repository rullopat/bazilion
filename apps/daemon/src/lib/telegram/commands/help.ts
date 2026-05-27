// `/help` — static command reference.
//
// Lists the commands shipping in Step 3 and a "Coming next" section so
// users know which doc-listed commands aren't wired yet.

import type { CommandHandler } from './types.ts'

const BODY = [
  '<b>bazilion · service chat commands</b>',
  '',
  '<b>Available now:</b>',
  '/talk &lt;agent&gt; — Open or create the forum topic for an agent',
  '/list — Show all agents (alias: /agents)',
  '/groups — Show bazilion groups',
  '/health — Bot identity + polling state',
  '/whoami — Show your Telegram user id',
  '/help — This message',
  '',
  '<b>Coming next:</b>',
  '/spawn — Create a new agent from a profile (next release)',
  '/close /rebind /unbind — Topic-context commands (later release)',
].join('\n')

export const handle: CommandHandler = async () => ({
  text: BODY,
  parseMode: 'HTML',
})
