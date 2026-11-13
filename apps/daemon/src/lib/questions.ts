import { randomUUID } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionInput,
  AgentQuestionToolResult,
} from '@bazilion/api-types'

/** How long `ask_user` waits for the owner before the turn continues without an answer. */
const QUESTION_WAIT_MS = 5 * 60_000
export const QUESTION_LIMITS = Object.freeze({
  promptChars: 2000,
  labelChars: 120,
  descriptionChars: 500,
  answerChars: 4096,
})

function text(value: unknown, limit: number, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} must be non-empty text`)
  if (value.length > limit) throw new Error(`${what} is longer than ${limit} characters`)
  return value
}

/** Validate what the model asks for. Unknown keys are ignored. */
export function parseQuestionInput(value: unknown): AgentQuestionInput {
  const input = (value ?? {}) as Record<string, unknown>
  const prompt = text(input.prompt, QUESTION_LIMITS.promptChars, 'The prompt')
  if (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 4)
    throw new Error('ask_user needs 2 to 4 choices')
  const labels = new Set<string>()
  const choices = input.choices.map((raw, index) => {
    const choice = (raw ?? {}) as Record<string, unknown>
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
  const recommended = input.recommendedIndex
  if (recommended === undefined) return { prompt, choices }
  if (typeof recommended !== 'number' || !Number.isInteger(recommended))
    throw new Error('recommendedIndex must be a choice index')
  if (recommended < 0 || recommended >= choices.length)
    throw new Error('recommendedIndex must be a choice index')
  return { prompt, choices, recommendedIndex: recommended }
}

/** Validate an owner's answer against the question it answers. */
export function parseQuestionAnswer(
  value: unknown,
  question: AgentQuestionInput,
): AgentQuestionAnswer {
  const answer = (value ?? {}) as Record<string, unknown>
  if (answer.kind === 'skip') return { kind: 'skip' }
  if (answer.kind === 'text')
    return { kind: 'text', text: text(answer.text, QUESTION_LIMITS.answerChars, 'The answer') }
  const index = answer.index
  if (answer.kind === 'choice' && typeof index === 'number' && Number.isInteger(index)) {
    if (index >= 0 && index < question.choices.length) return { kind: 'choice', index }
    throw new Error(
      `Choice ${index + 1} does not exist; this question has ${question.choices.length} choices`,
    )
  }
  throw new Error('An answer is a choice index, text or skip')
}

type Outcome =
  | { kind: 'answer'; answer: Exclude<AgentQuestionAnswer, { kind: 'skip' }> }
  | { kind: 'no_answer'; reason: 'skipped' | 'expired' | 'cancelled' }

interface Pending {
  question: AgentQuestion
  result: Promise<AgentQuestionToolResult>
  finish(outcome: Outcome): boolean
}

/**
 * Process-local questions, like shell approvals: an Agent's `ask_user` waits here until the owner
 * answers from web, CLI or Telegram, the question expires, or the turn ends. The first answer wins.
 * Outcomes live in the conversation transcript as the tool result.
 */
export class QuestionRegistry {
  readonly #pending = new Map<string, Pending>()
  readonly #waitMs: number

  constructor(waitMs = QUESTION_WAIT_MS) {
    this.#waitMs = waitMs
  }

  /** Register a question. `result` settles on the first answer, the timeout or `signal`. */
  ask(
    context: { agentId: string; conversationId: string },
    input: unknown,
    signal?: AbortSignal,
  ): { question: AgentQuestion; result: Promise<AgentQuestionToolResult> } {
    const prompt = parseQuestionInput(input)
    if (this.list(context.agentId).length > 0)
      throw new Error('Another question from this Agent is still waiting for an answer')
    if (signal?.aborted) throw new Error('The turn has ended')
    const now = Date.now()
    const question: AgentQuestion = {
      id: randomUUID(),
      agentId: context.agentId,
      conversationId: context.conversationId,
      question: prompt,
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
      resolve({ questionId: question.id, question: prompt, ...outcome })
      return true
    }
    this.#pending.set(question.id, { question, result: promise, finish })
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

  /** The outcome of a waiting question; undefined once it has settled. */
  settled(id: string): Promise<AgentQuestionToolResult> | undefined {
    return this.#pending.get(id)?.result
  }

  /** Answer a waiting question. False when it is no longer waiting; throws on an invalid answer. */
  answer(agentId: string, id: string, value: unknown): boolean {
    const entry = this.#pending.get(id)
    if (!entry || entry.question.agentId !== agentId) return false
    const answer = parseQuestionAnswer(value, entry.question.question)
    return entry.finish(
      answer.kind === 'skip'
        ? { kind: 'no_answer', reason: 'skipped' }
        : { kind: 'answer', answer },
    )
  }
}

export const questionRegistry = new QuestionRegistry()
