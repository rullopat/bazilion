import { randomUUID } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionInput,
  AgentQuestionItem,
  AgentQuestionItemAnswer,
  AgentQuestionSecret,
  AgentQuestionToolResult,
} from '@bazilion/api-types'
import { setAgentSecret } from '../core/agent-secrets.ts'
import { getCtx } from './ctx.ts'
import { signalLiveChange } from './live-signal.ts'
import { queueWake } from './wakes.ts'

/** How long `ask_user` waits for the owner before the turn continues without an answer. */
const QUESTION_WAIT_MS = 5 * 60_000
export const QUESTION_LIMITS = Object.freeze({
  promptChars: 2000,
  labelChars: 120,
  descriptionChars: 500,
  answerChars: 4096,
  urlChars: 2048,
})

function text(value: unknown, limit: number, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} must be non-empty text`)
  if (value.length > limit) throw new Error(`${what} is longer than ${limit} characters`)
  return value
}

function parseItem(raw: unknown, at: string): AgentQuestionItem {
  const input = (raw ?? {}) as Record<string, unknown>
  const prompt = text(input.prompt, QUESTION_LIMITS.promptChars, `${at}'s prompt`)
  if (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 4)
    throw new Error(`${at} needs 2 to 4 choices`)
  const labels = new Set<string>()
  const choices = input.choices.map((rawChoice, index) => {
    const choice = (rawChoice ?? {}) as Record<string, unknown>
    const label = text(choice.label, QUESTION_LIMITS.labelChars, `Choice ${index + 1} label`)
    // Two buttons that read the same would be ambiguous answers.
    const key = label.normalize('NFKC').trim().toLowerCase()
    if (labels.has(key)) throw new Error('Choice labels must be distinct')
    labels.add(key)
    if (choice.description === undefined) return { label }
    const description = text(
      choice.description,
      QUESTION_LIMITS.descriptionChars,
      `Choice ${index + 1} description`,
    )
    return { label, description }
  })
  const item: AgentQuestionItem = { prompt, choices }
  const recommended = input.recommendedIndex
  if (recommended !== undefined) {
    if (
      typeof recommended !== 'number' ||
      !Number.isInteger(recommended) ||
      recommended < 0 ||
      recommended >= choices.length
    )
      throw new Error('recommendedIndex must be a choice index')
    item.recommendedIndex = recommended
  }
  if (input.multiple === true) item.multiple = true
  return item
}

/** Validate what the model asks for: questions, or an action. Unknown keys are ignored. */
export function parseQuestionInput(value: unknown): AgentQuestionInput {
  const input = (value ?? {}) as Record<string, unknown>
  const hasQuestions = input.questions !== undefined
  const hasAction = input.action !== undefined
  if (hasQuestions === hasAction)
    throw new Error('ask_user takes either questions or an action, not both and not neither')
  if (hasAction) {
    const action = (input.action ?? {}) as Record<string, unknown>
    const reason = text(action.reason, QUESTION_LIMITS.promptChars, 'The reason')
    const instructions = text(action.instructions, QUESTION_LIMITS.promptChars, 'The instructions')
    if (action.url === undefined) return { action: { reason, instructions } }
    const url = text(action.url, QUESTION_LIMITS.urlChars, 'The url')
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {}
    if (protocol !== 'https:' && protocol !== 'http:')
      throw new Error('The url must start with http:// or https://')
    return { action: { reason, instructions, url } }
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0)
    throw new Error('ask_user needs at least one question')
  return {
    questions: input.questions.map((item, index) => parseItem(item, `Question ${index + 1}`)),
  }
}

/** Validate an owner's answer to one question. */
export function parseItemAnswer(value: unknown, item: AgentQuestionItem): AgentQuestionItemAnswer {
  const answer = (value ?? {}) as Record<string, unknown>
  if (answer.kind === 'skip') return { kind: 'skip' }
  if (answer.kind === 'text')
    return { kind: 'text', text: text(answer.text, QUESTION_LIMITS.answerChars, 'The answer') }
  const valid = (index: unknown): index is number =>
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < item.choices.length
  if (answer.kind === 'choice') {
    if (valid(answer.index)) return { kind: 'choice', index: answer.index }
    const which = Number.isInteger(answer.index)
      ? `Choice ${(answer.index as number) + 1}`
      : 'That choice'
    throw new Error(`${which} does not exist; this question has ${item.choices.length} choices`)
  }
  if (answer.kind === 'choices') {
    if (!item.multiple) throw new Error('This question takes one choice')
    const indexes = Array.isArray(answer.indexes) ? answer.indexes : []
    if (indexes.length === 0 || !indexes.every(valid))
      throw new Error(`Pick one or more of the ${item.choices.length} choices`)
    return { kind: 'choices', indexes: [...new Set(indexes)].sort((a, b) => a - b) }
  }
  throw new Error('An answer is a choice, choices, text or skip')
}

/** Validate an owner's answer against what it answers. */
export function parseQuestionAnswer(
  value: unknown,
  question: AgentQuestionInput,
): AgentQuestionAnswer {
  const answer = (value ?? {}) as Record<string, unknown>
  const note =
    answer.note === undefined
      ? {}
      : { note: text(answer.note, QUESTION_LIMITS.answerChars, 'The note') }
  if (question.action) {
    if (answer.kind === 'done') return { kind: 'done', ...note }
    if (answer.kind === 'cannot') return { kind: 'cannot', ...note }
    throw new Error('An action is answered with done or cannot')
  }
  if (question.secret) {
    if (answer.kind === 'decline') return { kind: 'decline', ...note }
    if (answer.kind === 'secret') {
      // Kept as given: a key file keeps its newlines. Never echoed in an error.
      if (typeof answer.value !== 'string' || !answer.value.trim())
        throw new Error('The secret is empty')
      return { kind: 'secret', value: answer.value }
    }
    throw new Error('A secret request is answered with the secret or decline')
  }
  if (answer.kind === 'skip') return { kind: 'skip' }
  const items = question.questions ?? []
  if (answer.kind !== 'answers' || !Array.isArray(answer.answers))
    throw new Error('Questions are answered with one answer per question, or skip')
  if (answer.answers.length !== items.length)
    throw new Error(`This card has ${items.length} question(s): give one answer for each`)
  return {
    kind: 'answers',
    answers: answer.answers.map((entry, index) =>
      parseItemAnswer(entry, items[index] as AgentQuestionItem),
    ),
  }
}

type Outcome =
  | { kind: 'answer'; answers: AgentQuestionItemAnswer[] }
  | { kind: 'no_answer'; reason: 'skipped' | 'expired' | 'cancelled' }

interface Pending {
  question: AgentQuestion
  result: Promise<AgentQuestionToolResult>
  finish(outcome: Outcome): boolean
}

/** What the Agent is told when the owner answers its action, in a turn of its own. */
function actionWake(
  question: AgentQuestion,
  answer: Extract<AgentQuestionAnswer, { kind: 'done' | 'cannot' }>,
) {
  const action = question.question.action
  if (!action) return
  const done = answer.kind === 'done'
  queueWake({
    id: `action:${question.id}`,
    agentId: question.agentId,
    conversationId: question.conversationId,
    summary: done
      ? `The user did it: ${action.reason}`
      : `The user could not do it: ${action.reason}`,
    text: [
      `You asked the user to do this: ${action.instructions}`,
      done
        ? 'They answered Done. Check that it worked before you rely on it, then carry on.'
        : 'They answered that they cannot. Find another way, or tell them what that means for the work.',
      answer.note ? `Their note: ${answer.note}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    at: Date.now(),
  })
}

/**
 * What the Agent is told when its secret request is answered, in a turn of its own: `hosts` are
 * the ones the secret was given, which may not be the ones it asked for.
 */
function secretWake(
  question: AgentQuestion,
  stored: boolean,
  options: { note?: string; hosts?: readonly string[] } = {},
) {
  const secret = question.question.secret
  if (!secret) return
  const { name } = secret
  const { note } = options
  const hosts = options.hosts ?? secret.hosts ?? []
  queueWake({
    id: `secret:${question.id}`,
    agentId: question.agentId,
    conversationId: question.conversationId,
    summary: stored ? `The user stored ${name}` : `The user declined to give ${name}`,
    text: stored
      ? [
          `The user stored the secret you asked for: ${name}. You never see its value.`,
          `Your commands have it as the environment variable ${name}.`,
          hosts.length > 0
            ? `web_fetch puts it in a header you write as {{secret:${name}}}, for ${hosts.join(', ')} only.`
            : '',
          'Carry on with what you needed it for.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `The user declined to give ${name}.`,
          note ? `Their note: ${note}` : '',
          'Find another way, or tell them what that means for the work.',
        ]
          .filter(Boolean)
          .join('\n\n'),
    at: Date.now(),
  })
}

/** Stores a secret the owner gave in a secret request's card. */
export type SecretStore = (agentId: string, secret: AgentQuestionSecret, value: string) => void

const storeInHome: SecretStore = (agentId, secret, value) => {
  const { db, authToken } = getCtx()
  setAgentSecret(db, authToken, agentId, {
    name: secret.name,
    value,
    reason: secret.reason,
    hosts: secret.hosts ?? [],
  })
}

/**
 * Process-local questions, like shell approvals: an Agent's `ask_user` card waits here until the
 * owner answers from web, CLI or Telegram, the card expires, or the turn ends; the first complete
 * answer wins. An action does not hold the turn: it waits until the owner answers it, and the
 * answer wakes the Agent. Outcomes live in the conversation transcript as the tool result.
 */
export class QuestionRegistry {
  readonly #pending = new Map<string, Pending>()
  readonly #waitMs: number
  readonly #storeSecret: SecretStore

  constructor(waitMs = QUESTION_WAIT_MS, storeSecret: SecretStore = storeInHome) {
    this.#waitMs = waitMs
    this.#storeSecret = storeSecret
  }

  /**
   * Ask the owner for a secret. Like an action it outlives the turn; the owner's answer stores it
   * and wakes the Agent. A request for a name already waiting is that same request.
   */
  askSecret(
    context: { agentId: string; conversationId: string },
    secret: AgentQuestionSecret,
  ): AgentQuestion {
    const waiting = this.list(context.agentId).find(
      (question) => question.question.secret?.name === secret.name,
    )
    if (waiting) return waiting
    const question: AgentQuestion = {
      id: randomUUID(),
      agentId: context.agentId,
      conversationId: context.conversationId,
      question: { secret },
      createdAt: Date.now(),
      expiresAt: null,
    }
    this.#pending.set(question.id, {
      question,
      result: Promise.resolve<AgentQuestionToolResult>({
        questionId: question.id,
        question: question.question,
        kind: 'action_asked',
      }),
      finish: () => this.#pending.delete(question.id),
    })
    signalLiveChange()
    return question
  }

  /**
   * The Agent's secret was stored some other way (its sheet, `bazilion agent secret set`): its
   * waiting request for that name is answered.
   */
  settleSecret(agentId: string, name: string, hosts: readonly string[]): void {
    for (const question of this.list(agentId)) {
      if (question.question.secret?.name !== name) continue
      if (this.#pending.get(question.id)?.finish({ kind: 'no_answer', reason: 'skipped' })) {
        secretWake(question, true, { hosts })
        signalLiveChange()
      }
    }
  }

  /** Register a card or an action. A card's `result` settles on its answer, the timeout or `signal`. */
  ask(
    context: { agentId: string; conversationId: string },
    input: unknown,
    signal?: AbortSignal,
  ): { question: AgentQuestion; result: Promise<AgentQuestionToolResult> } {
    const asked = parseQuestionInput(input)
    if (signal?.aborted) throw new Error('The turn has ended')
    const now = Date.now()
    if (asked.action) {
      // It outlives the turn: no timer, and the turn's end does not cancel it.
      const question: AgentQuestion = {
        id: randomUUID(),
        agentId: context.agentId,
        conversationId: context.conversationId,
        question: asked,
        createdAt: now,
        expiresAt: null,
      }
      const result = Promise.resolve<AgentQuestionToolResult>({
        questionId: question.id,
        question: asked,
        kind: 'action_asked',
      })
      this.#pending.set(question.id, {
        question,
        result,
        finish: () => this.#pending.delete(question.id),
      })
      signalLiveChange()
      return { question, result }
    }
    if (this.list(context.agentId).some((waiting) => !waiting.question.action))
      throw new Error('Another question from this Agent is still waiting for an answer')
    const question: AgentQuestion = {
      id: randomUUID(),
      agentId: context.agentId,
      conversationId: context.conversationId,
      question: asked,
      createdAt: now,
      expiresAt: now + this.#waitMs,
    }
    const { promise, resolve } = Promise.withResolvers<AgentQuestionToolResult>()
    const cancel = () => finish({ kind: 'no_answer', reason: 'cancelled' })
    const timer = setTimeout(() => finish({ kind: 'no_answer', reason: 'expired' }), this.#waitMs)
    timer.unref()
    const finish = (outcome: Outcome): boolean => {
      if (!this.#pending.delete(question.id)) return false
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      resolve({ questionId: question.id, question: asked, ...outcome })
      signalLiveChange()
      return true
    }
    this.#pending.set(question.id, { question, result: promise, finish })
    signalLiveChange()
    signal?.addEventListener('abort', cancel, { once: true })
    return { question, result: promise }
  }

  list(agentId?: string): AgentQuestion[] {
    return [...this.#pending.values()]
      .map((entry) => entry.question)
      .filter((question) => agentId === undefined || question.agentId === agentId)
  }

  get(id: string): AgentQuestion | undefined {
    return this.#pending.get(id)?.question
  }

  /** The outcome of a waiting card; undefined once it has settled. */
  settled(id: string): Promise<AgentQuestionToolResult> | undefined {
    return this.#pending.get(id)?.result
  }

  /** Answer a waiting card or action. False when it is no longer waiting; throws on an invalid answer. */
  answer(agentId: string, id: string, value: unknown): boolean {
    const entry = this.#pending.get(id)
    if (!entry || entry.question.agentId !== agentId) return false
    const answer = parseQuestionAnswer(value, entry.question.question)
    const secret = entry.question.question.secret
    if (secret && (answer.kind === 'secret' || answer.kind === 'decline')) {
      // Stored before the request is closed: a refused name leaves the card open.
      if (answer.kind === 'secret') this.#storeSecret(agentId, secret, answer.value)
      if (!entry.finish({ kind: 'no_answer', reason: 'skipped' })) return false
      secretWake(
        entry.question,
        answer.kind === 'secret',
        answer.kind === 'decline' && answer.note ? { note: answer.note } : {},
      )
      signalLiveChange()
      return true
    }
    if (answer.kind === 'secret' || answer.kind === 'decline')
      throw new Error('Only a secret request takes a secret')
    if (answer.kind === 'done' || answer.kind === 'cannot') {
      if (!entry.finish({ kind: 'no_answer', reason: 'skipped' })) return false
      actionWake(entry.question, answer)
      signalLiveChange()
      return true
    }
    return entry.finish(
      answer.kind === 'skip'
        ? { kind: 'no_answer', reason: 'skipped' }
        : { kind: 'answer', answers: answer.answers },
    )
  }

  /**
   * Answer one question of a card (Telegram answers question by question); the card settles once
   * each has an answer. False when it is no longer waiting.
   */
  answerOne(agentId: string, id: string, index: number, value: unknown): boolean {
    const entry = this.#pending.get(id)
    const items = entry?.question.question.questions
    if (!entry || entry.question.agentId !== agentId || !items) return false
    const item = items[index]
    if (!item) throw new Error('That question is not on this card')
    const answered = entry.question.answered ?? items.map(() => null)
    answered[index] = parseItemAnswer(value, item)
    entry.question.answered = answered
    if (answered.every((answer) => answer !== null)) {
      return entry.finish({ kind: 'answer', answers: answered as AgentQuestionItemAnswer[] })
    }
    signalLiveChange()
    return true
  }
}

export const questionRegistry = new QuestionRegistry()
