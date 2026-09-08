import type { AgentQuestionInput, AgentQuestionResponseInput } from '@bazilion/api-types'

export const QUESTION_LIMITS = Object.freeze({
  promptBytes: 4096,
  labelBytes: 120,
  descriptionBytes: 500,
  answerBytes: 4096,
  waitMs: 5 * 60_000,
  perTurn: 16,
  pendingPerHome: 100,
  recordsPerHome: 10_000,
  terminalRetentionMs: 7 * 24 * 60 * 60_000,
})

function invalid(): never {
  throw new Error('Invalid question input')
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid()
}
function bounded(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > limit)
    return invalid()
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) invalid()
  }
  return value
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    return invalid()
  return value
}

/** The model may supply content only; reject recipient, timeout and authority fields. */
export function parseQuestionInput(value: unknown): AgentQuestionInput {
  const input = record(value)
  exact(input, ['prompt', 'choices'], ['recommendedIndex'])
  if (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > 4)
    return invalid()
  const labels = new Set<string>()
  const choices = input.choices.map((value) => {
    const option = record(value)
    exact(option, ['label'], ['description'])
    const label = bounded(option.label, QUESTION_LIMITS.labelBytes)
    const identity = label.normalize('NFKC').trim().toLowerCase()
    if (labels.has(identity)) return invalid()
    labels.add(identity)
    return {
      label,
      ...(option.description === undefined
        ? {}
        : {
            description: bounded(option.description, QUESTION_LIMITS.descriptionBytes),
          }),
    }
  })
  const recommendedIndex = input.recommendedIndex
  if (
    recommendedIndex !== undefined &&
    (typeof recommendedIndex !== 'number' ||
      !Number.isInteger(recommendedIndex) ||
      recommendedIndex < 0 ||
      recommendedIndex >= choices.length)
  )
    return invalid()
  return {
    prompt: bounded(input.prompt, QUESTION_LIMITS.promptBytes),
    choices,
    ...(recommendedIndex === undefined ? {} : { recommendedIndex }),
  }
}

/** Validate against the captured question, never the Agent's current selected conversation. */
export function parseQuestionResponse(
  value: unknown,
  question: AgentQuestionInput,
  conversationId: string,
): AgentQuestionResponseInput {
  const input = record(value)
  exact(input, ['requestId', 'conversationId', 'answer'])
  const target = uuid(input.conversationId)
  if (target !== conversationId) return invalid()
  const answer = record(input.answer)
  const base = { requestId: uuid(input.requestId), conversationId: target }
  if (answer.kind === 'skip') {
    exact(answer, ['kind'])
    return { ...base, answer: { kind: 'skip' } }
  }
  if (answer.kind === 'text') {
    exact(answer, ['kind', 'text'])
    return {
      ...base,
      answer: { kind: 'text', text: bounded(answer.text, QUESTION_LIMITS.answerBytes) },
    }
  }
  if (answer.kind === 'choice') {
    exact(answer, ['kind', 'index'])
    if (
      typeof answer.index !== 'number' ||
      !Number.isInteger(answer.index) ||
      answer.index < 0 ||
      answer.index >= question.choices.length
    )
      return invalid()
    return { ...base, answer: { kind: 'choice', index: answer.index } }
  }
  return invalid()
}
