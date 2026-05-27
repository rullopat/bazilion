// `/health` — diagnostic snapshot of the bot + polling state.
//
// Reads the live polling state from the bot lifecycle module (no extra
// Telegram API calls — the data is already in process). The preflight
// section reads the cached preflight result from the most recent
// `/api/config/telegram/health` call would be ideal, but we don't cache,
// so /health here just surfaces polling. Operators who want preflight can
// run `bazilion telegram health` or hit the HTTP endpoint.

import { getTelegramBotState } from '../bot.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async () => {
  const polling = getTelegramBotState()

  const lines: string[] = ['<b>bazilion · health</b>']

  if (!polling) {
    lines.push('polling: <i>not running</i>')
  } else {
    const startedAt = polling.startedAt ? new Date(polling.startedAt).toISOString() : '(never)'
    const lastPoll = polling.lastSuccessfulPollAt
      ? new Date(polling.lastSuccessfulPollAt).toISOString()
      : '(never)'
    lines.push(
      '<b>Polling</b>',
      `running:        ${polling.running ? '✓' : '✕'}`,
      `activated:      ${polling.activated ? '✓' : '✕'}`,
      `last update id: <code>${polling.lastUpdateId ?? '(none)'}</code>`,
      `started:        <code>${startedAt}</code>`,
      `last poll:      <code>${lastPoll}</code>`,
    )
    if (polling.error) lines.push(`error: <code>${polling.error}</code>`)
  }

  return {
    text: lines.join('\n'),
    parseMode: 'HTML',
  }
}
