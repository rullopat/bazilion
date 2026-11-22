// Commands waiting for approval, in Telegram. One that is still waiting after half a minute (the
// operator has likely stepped away from the web chat) goes to the Agent's topic with Allow and
// Deny. Only the paired owner can decide; other allowed members are refused. Once it settles,
// here or in the web UI or by timing out, the buttons are replaced by the outcome.

import type { CommandApproval } from '@bazilion/api-types'
import type { InlineKeyboardMarkup } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo } from '../../core/index.ts'
import * as acl from '../../core/repos/telegram-acl.ts'
import { commandApprovalRegistry } from '../bash-approval.ts'
import { telegramLive } from './live.ts'
import { clip } from './markdown.ts'
import { enqueueOutbound } from './outbound-queue.ts'

/** How long a command waits in the web UI before it is also sent to Telegram. */
export const APPROVAL_TELEGRAM_DELAY_MS = 30_000
const CALLBACK = /^ba:([0-9a-f-]{36}):(a|d)$/
const COMMAND_CHARS = 1_500

function promptBody(agentName: string, approval: CommandApproval): string {
  const risks = [...new Set(approval.risks.map((risk) => risk.message))].join(' ')
  return [
    `⚠️ ${agentName} wants to run a command that needs your approval:`,
    clip(approval.command, COMMAND_CHARS),
    risks ? `Why it asks: ${clip(risks, 500)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function outcomeLine(status: CommandApproval['status']): string {
  switch (status) {
    case 'allowed':
      return 'Allowed once.'
    case 'denied':
      return 'Denied.'
    case 'expired':
      return 'No answer in time: denied.'
    default:
      return 'The turn ended before an answer.'
  }
}

/**
 * Send the approval to the Agent's topic if it still waits after `delayMs`. Nothing goes out when
 * Telegram is off, the Agent has no topic, or the command was decided meanwhile. `approval` is
 * the one in the turn's frame, whose command text is already redacted of the turn's secrets.
 */
export function scheduleApprovalPrompt(
  approval: CommandApproval,
  delayMs = APPROVAL_TELEGRAM_DELAY_MS,
): void {
  if (approval.status !== 'pending') return
  const timer = setTimeout(() => void sendApprovalPrompt(approval), delayMs)
  timer.unref()
  void commandApprovalRegistry.settled(approval.id)?.finally(() => clearTimeout(timer))
}

export async function sendApprovalPrompt(approval: CommandApproval): Promise<boolean> {
  const settled = commandApprovalRegistry.settled(approval.id)
  const live = telegramLive()
  if (!commandApprovalRegistry.get(approval.id) || !settled || !live) return false
  const agent = agentRepo.get(live.db, approval.agentId)
  const topicId = agent ? agentRepo.getTelegramTopicId(live.db, agent.id) : null
  if (!agent || topicId === null) return false
  const body = promptBody(agent.name, approval)
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: 'Allow once', callback_data: `ba:${approval.id}:a` },
        { text: 'Deny', callback_data: `ba:${approval.id}:d` },
      ],
    ],
  }
  const sent = await enqueueOutbound(live.chatId, () =>
    live.api.sendMessage(live.chatId, body, {
      message_thread_id: topicId,
      reply_markup: keyboard,
    }),
  ).catch(() => null)
  if (!sent) return false
  void settled
    .then((result) => {
      // Minutes may have passed: nothing goes out once the bot stopped or moved to another chat.
      const current = telegramLive()
      if (!current || current.chatId !== live.chatId) return
      return enqueueOutbound(current.chatId, () =>
        current.api.editMessageText(
          current.chatId,
          sent.message_id,
          `${body}\n\n${outcomeLine(result.status)}`,
          { reply_markup: { inline_keyboard: [] } },
        ),
      )
    })
    .catch(() => undefined)
  return true
}

/** A button tap on an approval prompt; null for any other callback. */
export function approvalCallback(
  data: string | undefined,
): { approvalId: string; decision: 'allow' | 'deny' } | null {
  const match = data?.match(CALLBACK)
  if (!match?.[1] || !match[2]) return null
  return { approvalId: match[1], decision: match[2] === 'a' ? 'allow' : 'deny' }
}

/** Decide on a command from Telegram; returns the line to show the sender. */
export function decideFromTelegram(
  db: BazilionDb,
  userId: number,
  approvalId: string,
  decision: 'allow' | 'deny',
): string {
  if (acl.get(db, userId)?.role !== 'owner') return 'Only the owner can decide on a command.'
  const settled = commandApprovalRegistry.respond(approvalId, decision)
  if (!settled) return 'That command is no longer waiting.'
  return settled.status === 'allowed' ? 'Allowed once.' : 'Denied.'
}
