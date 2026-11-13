// Agent questions in Telegram. A waiting question goes to the Agent's topic with one button per
// choice and Skip; the owner taps a button or replies to the prompt with their own answer. Once
// the question settles (here, on web or CLI, or by timing out) the buttons are replaced by the
// outcome.

import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionToolResult,
} from '@bazilion/api-types'
import type { InlineKeyboardMarkup, Message } from 'grammy/types'
import { questionRegistry } from '../questions.ts'
import { type TelegramLive, telegramLive } from './live.ts'
import { clip, TELEGRAM_SAFE_BUDGET } from './markdown.ts'
import { enqueueOutbound } from './outbound-queue.ts'

const CALLBACK = /^bq:([0-9a-f-]{36}):(\d|s)$/
const FOOTER = 'Tap a choice, or reply to this message with your own answer.'
/** Prompt message id → question id, while the question waits. */
const prompts = new Map<number, string>()

function promptBody(question: AgentQuestion): string {
  const { prompt, choices, recommendedIndex } = question.question
  const options = choices
    .map(
      (choice, index) =>
        `${index + 1}. ${choice.label}${index === recommendedIndex ? ' (recommended)' : ''}${choice.description ? ` — ${choice.description}` : ''}`,
    )
    .join('\n')
  const room = TELEGRAM_SAFE_BUDGET - options.length - FOOTER.length - 64
  return `❓ ${clip(prompt, Math.max(room, 200))}\n\n${clip(options, TELEGRAM_SAFE_BUDGET / 2)}`
}

function outcomeLine(result: AgentQuestionToolResult): string {
  if (result.kind === 'answer')
    return result.answer.kind === 'choice'
      ? `Answered: ${result.question.choices[result.answer.index]?.label ?? ''}`
      : `Answered: ${clip(result.answer.text, 500)}`
  if (result.reason === 'skipped') return 'Skipped.'
  return result.reason === 'expired' ? 'No answer in time.' : 'The turn ended before an answer.'
}

/** Post a waiting question to the Agent's topic. */
export async function sendQuestionPrompt(
  live: TelegramLive,
  topicId: number,
  question: AgentQuestion,
): Promise<void> {
  const settled = questionRegistry.settled(question.id)
  if (!settled) return
  const body = promptBody(question)
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      ...question.question.choices.map((choice, index) => [
        {
          text: clip(`${index + 1}. ${choice.label}`, 64),
          callback_data: `bq:${question.id}:${index}`,
        },
      ]),
      [{ text: 'Skip', callback_data: `bq:${question.id}:s` }],
    ],
  }
  const sent = await enqueueOutbound(live.chatId, () =>
    live.api.sendMessage(live.chatId, `${body}\n\n${FOOTER}`, {
      message_thread_id: topicId,
      reply_markup: keyboard,
    }),
  )
  prompts.set(sent.message_id, question.id)
  void settled
    .then((result) => {
      prompts.delete(sent.message_id)
      // Minutes may have passed: nothing goes out once the bot stopped or moved to another chat.
      const current = telegramLive()
      if (!current || current.chatId !== live.chatId) return
      const outcome = outcomeLine(result)
      const text = `${clip(body, TELEGRAM_SAFE_BUDGET - outcome.length - 2)}\n\n${outcome}`
      return enqueueOutbound(current.chatId, () =>
        current.api.editMessageText(current.chatId, sent.message_id, text, {
          reply_markup: { inline_keyboard: [] },
        }),
      )
    })
    .catch(() => undefined)
}

/** A button tap on a question prompt; null for any other callback. */
export function questionCallback(
  data: string | undefined,
): { questionId: string; answer: AgentQuestionAnswer } | null {
  const match = data?.match(CALLBACK)
  if (!match?.[1] || !match[2]) return null
  return {
    questionId: match[1],
    answer: match[2] === 's' ? { kind: 'skip' } : { kind: 'choice', index: Number(match[2]) },
  }
}

/** The waiting question a text message answers by replying to its prompt. */
export function questionReply(message: Message): string | undefined {
  const replyTo = message.reply_to_message?.message_id
  return message.text && replyTo !== undefined ? prompts.get(replyTo) : undefined
}

/** Answer a question from Telegram; returns the line to show the sender. */
export function answerFromTelegram(questionId: string, answer: AgentQuestionAnswer): string {
  const question = questionRegistry.get(questionId)
  try {
    if (question && questionRegistry.answer(question.agentId, questionId, answer))
      return answer.kind === 'skip' ? 'Skipped.' : 'Answered.'
  } catch {
    return 'That is not a valid answer to this question.'
  }
  return 'That question is no longer open.'
}

/** Test-only. */
export function _resetQuestionPromptsForTest(): void {
  prompts.clear()
}
