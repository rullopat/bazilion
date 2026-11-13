// `/health` — the bot's polling state. The full setup checks run from
// `bazilion telegram health` or the web Telegram page.

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
