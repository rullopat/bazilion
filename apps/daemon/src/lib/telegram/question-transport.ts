import { createHash } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionResponseInput,
} from '@bazilion/api-types'
import type { CallbackQuery, InlineKeyboardMarkup, Message } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { QuestionTelegramTransport } from '../question-service.ts'
import { enqueueOutbound } from './outbound-queue.ts'
import {
  captureTelegramQueueBinding,
  requireTelegramQueueBinding,
  type TelegramQueueBinding,
} from './queue-binding.ts'

interface Transport {
  edit?(chatId: number, messageId: number, text: string, signal: AbortSignal): Promise<unknown>
  db: BazilionDb
  authToken: string
  botToken: string
  send(
    chatId: number,
    topicId: number,
    text: string,
    keyboard: InlineKeyboardMarkup | undefined,
    signal: AbortSignal,
  ): Promise<{ message_id: number }>
}
let liveTransport: (() => Transport | null) | null = null
export function installQuestionTransport(resolver: (() => Transport | null) | null): void {
  liveTransport = resolver
}
interface Prompt {
  question: AgentQuestion
  binding: TelegramQueueBinding
  messageId: number
}
const prompts = new WeakMap<BazilionDb, Map<string, Prompt>>()
function records(db: BazilionDb): Map<string, Prompt> {
  let map = prompts.get(db)
  if (!map) {
    map = new Map()
    prompts.set(db, map)
  }
  for (const [id, item] of map) if (item.question.expiresAt <= Date.now()) map.delete(id)
  return map
}
function live(db: BazilionDb, authToken: string, binding: TelegramQueueBinding): Transport {
  const transport = liveTransport?.()
  if (!transport || transport.db !== db || transport.authToken !== authToken)
    throw new Error('Question transport unavailable')
  const current = requireTelegramQueueBinding(db, authToken, binding)
  captureTelegramQueueBinding(db, authToken, current.authorization, transport.botToken)
  return transport
}

/** Bounded paced delivery. A timeout never automatically retries a possibly delivered prompt. */
export function telegramQuestionTransport(
  db: BazilionDb,
  authToken: string,
): QuestionTelegramTransport {
  return {
    async settled(question, authorize) {
      const prompt = prompts.get(db)?.get(question.id)
      if (!prompt) return
      const { chatId } = prompt.binding.authorization.approvalPayload
      await enqueueOutbound(chatId, async () => {
        authorize()
        const transport = live(db, authToken, prompt.binding)
        if (!transport.edit) return
        const outcome =
          question.status === 'answered'
            ? 'Answer accepted; consumption is not yet confirmed.'
            : question.status === 'skipped'
              ? 'Skipped.'
              : `No answer: ${question.noAnswerReason ?? question.status}.`
        await transport.edit(
          chatId,
          prompt.messageId,
          `Question ${question.id}\n${outcome}\nTask completion is separate. Inspect web chat for the current conversation outcome.`,
          AbortSignal.timeout(10_000),
        )
      })
    },
    available(binding) {
      try {
        live(db, authToken, binding)
        return true
      } catch {
        return false
      }
    },
    async send(question, binding, authorize, signal) {
      const map = records(db)
      if (map.has(question.id)) throw new Error('Question prompt already delivered')
      if (map.size >= 100) {
        for (const [id, record] of map) {
          const current = db.raw
            .query<{ status: string }, [string]>('SELECT status FROM agent_questions WHERE id = ?')
            .get(id)
          if (current?.status !== 'pending') map.delete(record.question.id)
          if (map.size < 100) break
        }
      }
      if (map.size >= 100) throw new Error('Telegram question prompt capacity reached')
      const { chatId, threadId } = binding.authorization.approvalPayload
      const deadline = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let abort: (() => void) | undefined
      const expired = new Promise<never>((_resolve, reject) => {
        abort = () => {
          deadline.abort()
          reject(new Error('Question turn ended'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        timer = setTimeout(
          () => {
            deadline.abort()
            reject(new Error('Question delivery expired'))
          },
          Math.max(1, question.expiresAt - Date.now()),
        )
        timer.unref()
      })
      const guard = () => {
        deadline.signal.throwIfAborted()
        if (Date.now() >= question.expiresAt) throw new Error('Question expired')
        authorize()
        return live(db, authToken, binding)
      }
      const send = (text: string, keyboard?: InlineKeyboardMarkup) =>
        enqueueOutbound(chatId, async () => {
          const transport = guard()
          return transport.send(
            chatId,
            threadId,
            text,
            keyboard,
            AbortSignal.any([deadline.signal, AbortSignal.timeout(10_000)]),
          )
        })
      try {
        await Promise.race([
          (async () => {
            const header = `Question ${question.id}\n`
            // Keep every chunk below Telegram's text bound, including the maximum ASCII prompt.
            const prompt = Array.from(question.question.prompt)
            for (let start = 0; start < prompt.length; start += 2500)
              await send(`${header}${prompt.slice(start, start + 2500).join('')}`)
            const options = question.question.choices
              .map(
                (choice, index) =>
                  `${index + 1}. ${choice.label}${index === question.question.recommendedIndex ? ' (Recommended)' : ''}${choice.description ? `\n${choice.description}` : ''}`,
              )
              .join('\n\n')
            const keyboard: InlineKeyboardMarkup = {
              inline_keyboard: [
                ...question.question.choices.map((_choice, index) => [
                  { text: String(index + 1), callback_data: `bq:${question.id}:${index}` },
                ]),
                [
                  { text: 'Other', callback_data: `bq:${question.id}:o` },
                  { text: 'Skip', callback_data: `bq:${question.id}:s` },
                ],
              ],
            }
            const sent = await send(
              `${header}${options}\n\nReply to THIS message with Other text, or /answer ${question.id} your answer. Clarification grants no permission.`,
              keyboard,
            )
            guard()
            map.set(question.id, { question, binding, messageId: sent.message_id })
          })(),
          expired,
        ])
      } finally {
        if (timer) clearTimeout(timer)
        if (abort) signal?.removeEventListener('abort', abort)
      }
    },
  }
}

function requestId(identity: string): string {
  const hex = createHash('sha256').update(identity).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
export type QuestionReply =
  | { kind: 'unrelated' }
  | { kind: 'rejected' }
  | { kind: 'other' }
  | {
      kind: 'answer'
      agentId: string
      questionId: string
      input: AgentQuestionResponseInput
    }

/** Correlation precedes the ordinary queue. Identity validation never trusts button data alone. */
export function parseTelegramQuestionReply(
  db: BazilionDb,
  authToken: string,
  update: { message?: Message; callback?: CallbackQuery },
): QuestionReply {
  const callback = update.callback
  const message = update.message
  const match = callback?.data?.match(/^bq:([a-f0-9-]{36}):([0-3os])$/)
  const explicit = message?.text?.match(/^\/answer(?:@\w+)?\s+([a-f0-9-]{36})\s+([\s\S]+)$/)
  const quoted = message?.reply_to_message?.text?.match(/^Question ([a-f0-9-]{36})\n/)
  const id = match?.[1] ?? explicit?.[1] ?? quoted?.[1]
  if (!id)
    return callback?.data?.startsWith('bq:') || message?.text?.startsWith('/answer')
      ? { kind: 'rejected' }
      : { kind: 'unrelated' }
  const prompt = records(db).get(id)
  if (!prompt) return { kind: 'rejected' }
  const source = callback?.message ?? message
  const from = callback?.from ?? message?.from
  const bound = prompt.binding.authorization.approvalPayload
  if (
    !source ||
    !from ||
    from.is_bot ||
    ('sender_chat' in source && source.sender_chat) ||
    prompt.binding.authorization.requester !== `telegram:${from.id}` ||
    source.chat.id !== bound.chatId ||
    !('message_thread_id' in source) ||
    source.message_thread_id !== bound.threadId ||
    (callback && source.message_id !== prompt.messageId) ||
    (!callback && !explicit && message?.reply_to_message?.message_id !== prompt.messageId)
  )
    return { kind: 'rejected' }
  try {
    live(db, authToken, prompt.binding)
  } catch {
    return { kind: 'rejected' }
  }
  if (match?.[2] === 'o') return { kind: 'other' }
  let answer: AgentQuestionAnswer
  if (match)
    answer = match[2] === 's' ? { kind: 'skip' } : { kind: 'choice', index: Number(match[2]) }
  else {
    if (!message?.text || message.photo || message.document || message.audio || message.voice)
      return { kind: 'rejected' }
    answer = { kind: 'text', text: explicit?.[2] ?? message.text }
  }
  return {
    kind: 'answer',
    agentId: bound.agentId,
    questionId: id,
    input: {
      requestId: requestId(
        `question:${id}:${callback ? `callback:${callback.id}` : `message:${source.chat.id}:${source.message_id}`}`,
      ),
      conversationId: prompt.question.conversationId,
      answer,
    },
  }
}
