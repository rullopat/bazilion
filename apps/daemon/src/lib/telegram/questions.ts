// Agent questions in Telegram. Each question of a waiting card goes to the Agent's topic as a
// message of its own, with one button per choice and Skip; the owner taps a button or replies to
// the message with their own answer (for a question with several choices: their numbers). The card
// is answered once each question is. An action comes with Done and Can't. A secret request comes
// with a link to its masked field on the web, never asking for the value here, and Decline. Once a
// card settles (here, on web or CLI, or by timing out) the buttons are replaced by the outcome.

import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionItemAnswer,
  AgentQuestionToolResult,
} from '@bazilion/api-types'
import type { InlineKeyboardMarkup, Message } from 'grammy/types'
import { publicOrigin } from '../notification-message.ts'
import { questionRegistry } from '../questions.ts'
import { type TelegramLive, telegramLive } from './live.ts'
import { clip, TELEGRAM_SAFE_BUDGET } from './markdown.ts'
import { enqueueOutbound } from './outbound-queue.ts'

/**
 * `bq:<card>:<question>:<choice|s>` for a question, `bq:<card>:a:<d|c>` for an action and
 * `bq:<card>:a:x` to decline a secret request.
 */
const CALLBACK = /^bq:([0-9a-f-]{36}):(?:(\d+):(\d+|s)|a:(d|c|x))$/
const ACTION_ANSWERS = { d: 'done', c: 'cannot', x: 'decline' } as const
const FOOTER = 'Tap a choice, or reply to this message with your own answer.'
const FOOTER_MULTIPLE =
  'Reply to this message with the numbers of your choices (such as 1 3), or your own answer.'
const ACTION_FOOTER = "Tap Done once it is done, or Can't if you cannot."
/** Prompt message id → the card and the question it shows, while the card waits. */
const prompts = new Map<number, { questionId: string; index: number }>()

function itemBody(item: AgentQuestionItem, index: number, total: number): string {
  const options = item.choices
    .map(
      (choice, at) =>
        `${at + 1}. ${choice.label}${at === item.recommendedIndex ? ' (recommended)' : ''}${choice.description ? ` — ${choice.description}` : ''}`,
    )
    .join('\n')
  const room = TELEGRAM_SAFE_BUDGET - options.length - FOOTER_MULTIPLE.length - 64
  const count = total > 1 ? ` (${index + 1}/${total})` : ''
  return `❓${count} ${clip(item.prompt, Math.max(room, 200))}\n\n${clip(options, TELEGRAM_SAFE_BUDGET / 2)}`
}

function actionBody(question: AgentQuestion): string {
  const action = question.question.action
  if (!action) return ''
  return [
    `🙋 ${clip(action.reason, 500)}`,
    clip(action.instructions, TELEGRAM_SAFE_BUDGET / 2),
    action.url ? clip(action.url, 500) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * A secret request: what it is for and where to type it. A Telegram message is not masked, so the
 * value is never asked for here.
 */
function secretBody(question: AgentQuestion): string {
  const secret = question.question.secret
  if (!secret) return ''
  const origin = publicOrigin(process.env)
  const where = origin
    ? `Type it in Bazilion, never here: ${origin}/?${new URLSearchParams({ agent: question.agentId })}`
    : 'Type it in Bazilion on your computer (the chat with this Agent), never here.'
  const hosts = secret.hosts ?? []
  return [
    `🔑 ${clip(`The Agent asks for a secret: ${secret.name}`, 300)}`,
    clip(secret.reason, 500),
    hosts.length > 0
      ? clip(`It asks that web_fetch may send it to ${hosts.join(', ')}.`, 500)
      : 'For its commands only.',
    `${where}\nOr in a terminal: bazilion agent secret set ${question.agentId} ${secret.name}${hosts.length > 0 ? ` --hosts ${hosts.join(',')}` : ''}`,
    'Do not reply with it here: a reply is not private and is not passed on.',
  ].join('\n\n')
}

function answerLine(item: AgentQuestionItem, answer: AgentQuestionItemAnswer | undefined): string {
  if (!answer || answer.kind === 'skip') return 'Skipped.'
  if (answer.kind === 'choice') return `Answered: ${item.choices[answer.index]?.label ?? ''}`
  if (answer.kind === 'choices')
    return `Answered: ${answer.indexes.map((at) => item.choices[at]?.label ?? '').join(', ')}`
  return `Answered: ${clip(answer.text, 500)}`
}

function outcomeLine(
  result: AgentQuestionToolResult,
  item: AgentQuestionItem,
  index: number,
): string {
  if (result.kind === 'answer') return answerLine(item, result.answers[index])
  if (result.kind !== 'no_answer') return ''
  if (result.reason === 'skipped') return 'Skipped.'
  return result.reason === 'expired' ? 'No answer in time.' : 'The turn ended before an answer.'
}

async function post(
  live: TelegramLive,
  topicId: number,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<Message.TextMessage> {
  return enqueueOutbound(live.chatId, () =>
    live.api.sendMessage(live.chatId, text, { message_thread_id: topicId, reply_markup: keyboard }),
  )
}

/** Replace a prompt's buttons by its outcome, unless the bot stopped or moved to another chat. */
function settle(live: TelegramLive, messageId: number, text: string): Promise<unknown> | undefined {
  const current = telegramLive()
  if (!current || current.chatId !== live.chatId) return
  return enqueueOutbound(current.chatId, () =>
    current.api.editMessageText(current.chatId, messageId, text, {
      reply_markup: { inline_keyboard: [] },
    }),
  )
}

/** Post a waiting card, question by question, or an action, to the Agent's topic. */
export async function sendQuestionPrompt(
  live: TelegramLive,
  topicId: number,
  question: AgentQuestion,
): Promise<void> {
  if (question.question.secret) {
    const body = secretBody(question)
    const sent = await post(live, topicId, body, {
      inline_keyboard: [[{ text: 'Decline', callback_data: `bq:${question.id}:a:x` }]],
    })
    actionPrompts.set(question.id, { live, messageId: sent.message_id, body })
    secretPrompts.add(sent.message_id)
    return
  }
  if (question.question.action) {
    const body = actionBody(question)
    const sent = await post(live, topicId, `${body}\n\n${ACTION_FOOTER}`, {
      inline_keyboard: [
        [
          { text: 'Done', callback_data: `bq:${question.id}:a:d` },
          { text: "Can't", callback_data: `bq:${question.id}:a:c` },
        ],
      ],
    })
    actionPrompts.set(question.id, { live, messageId: sent.message_id, body })
    return
  }
  const settled = questionRegistry.settled(question.id)
  const items = question.question.questions ?? []
  if (!settled) return
  const sent: Array<{ messageId: number; body: string }> = []
  for (const [index, item] of items.entries()) {
    const body = itemBody(item, index, items.length)
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        // Several choices are given by reply; one by a tap.
        ...(item.multiple
          ? []
          : item.choices.map((choice, at) => [
              {
                text: clip(`${at + 1}. ${choice.label}`, 64),
                callback_data: `bq:${question.id}:${index}:${at}`,
              },
            ])),
        [{ text: 'Skip', callback_data: `bq:${question.id}:${index}:s` }],
      ],
    }
    const message = await post(
      live,
      topicId,
      `${body}\n\n${item.multiple ? FOOTER_MULTIPLE : FOOTER}`,
      keyboard,
    )
    prompts.set(message.message_id, { questionId: question.id, index })
    sent.push({ messageId: message.message_id, body })
  }
  void settled
    .then((result) => {
      for (const [index, message] of sent.entries()) {
        prompts.delete(message.messageId)
        const item = items[index]
        if (!item) continue
        const outcome = outcomeLine(result, item, index)
        void settle(
          live,
          message.messageId,
          `${clip(message.body, TELEGRAM_SAFE_BUDGET - outcome.length - 2)}\n\n${outcome}`,
        )?.catch(() => undefined)
      }
    })
    .catch(() => undefined)
}

/** Posted actions, so their buttons can be replaced once they are answered. */
const actionPrompts = new Map<string, { live: TelegramLive; messageId: number; body: string }>()
/** The messages that asked for a secret: a reply to one is never passed on. */
const secretPrompts = new Set<number>()

/** A reply to a secret request's message: it may hold the secret, so it goes nowhere. */
export function isSecretPromptReply(message: Message): boolean {
  const replyTo = message.reply_to_message?.message_id
  return replyTo !== undefined && secretPrompts.has(replyTo)
}

/** A button tap on a question or action prompt; null for any other callback. */
export function questionCallback(data: string | undefined):
  | { questionId: string; index: number; answer: AgentQuestionItemAnswer }
  | {
      questionId: string
      action: Extract<AgentQuestionAnswer, { kind: 'done' | 'cannot' | 'decline' }>
    }
  | null {
  const match = data?.match(CALLBACK)
  if (!match?.[1]) return null
  if (match[4])
    return {
      questionId: match[1],
      action: { kind: ACTION_ANSWERS[match[4] as keyof typeof ACTION_ANSWERS] },
    }
  if (match[2] === undefined || match[3] === undefined) return null
  return {
    questionId: match[1],
    index: Number(match[2]),
    answer: match[3] === 's' ? { kind: 'skip' } : { kind: 'choice', index: Number(match[3]) },
  }
}

/** The waiting question a text message answers by replying to its prompt. */
export function questionReply(message: Message): { questionId: string; index: number } | undefined {
  const replyTo = message.reply_to_message?.message_id
  return message.text && replyTo !== undefined ? prompts.get(replyTo) : undefined
}

/** A reply as an answer: numbers for a question with several choices, else the words. */
export function replyAnswer(
  questionId: string,
  index: number,
  text: string,
): AgentQuestionItemAnswer {
  const item = questionRegistry.get(questionId)?.question.questions?.[index]
  const numbers = text.trim().split(/[\s,]+/)
  if (item?.multiple && numbers.every((value) => /^\d+$/.test(value))) {
    return { kind: 'choices', indexes: numbers.map((value) => Number(value) - 1) }
  }
  return { kind: 'text', text }
}

/** Answer one question of a card from Telegram; returns the line to show the sender. */
export function answerFromTelegram(
  questionId: string,
  index: number,
  answer: AgentQuestionItemAnswer,
): string {
  const question = questionRegistry.get(questionId)
  try {
    if (question && questionRegistry.answerOne(question.agentId, questionId, index, answer))
      return answer.kind === 'skip' ? 'Skipped.' : 'Answered.'
  } catch {
    return 'That is not a valid answer to this question.'
  }
  return 'That question is no longer open.'
}

/** Answer an action, or decline a secret request, from Telegram; the Agent's next turn starts with it. */
export function answerActionFromTelegram(
  questionId: string,
  answer: Extract<AgentQuestionAnswer, { kind: 'done' | 'cannot' | 'decline' }>,
): string {
  const question = questionRegistry.get(questionId)
  if (!question || !questionRegistry.answer(question.agentId, questionId, answer))
    return 'That is no longer waiting.'
  const posted = actionPrompts.get(questionId)
  actionPrompts.delete(questionId)
  const line = answer.kind === 'done' ? 'Done.' : answer.kind === 'decline' ? 'Declined.' : "Can't."
  if (posted)
    void settle(posted.live, posted.messageId, `${posted.body}\n\n${line}`)?.catch(() => undefined)
  return line
}

/** Test-only. */
export function _resetQuestionPromptsForTest(): void {
  prompts.clear()
  actionPrompts.clear()
  secretPrompts.clear()
}
