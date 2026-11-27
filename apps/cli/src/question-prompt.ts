import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionItemAnswer,
} from '@bazilion/api-types'
import { terminalSafe } from './command-helpers.ts'

export interface QuestionPrompt {
  question(text: string, signal: AbortSignal): Promise<string>
  write(text: string): void
}
function hasAnswerControl(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159)
  })
}

/** One question's prompt and choices as terminal lines, with control characters escaped. */
function itemLines(item: AgentQuestionItem, label = ''): string[] {
  const lines = terminalSafe(`${label}${item.prompt}`).split('\n')
  item.choices.forEach((choice, index) => {
    const recommended = index === item.recommendedIndex ? ' (recommended)' : ''
    lines.push(`${index + 1}. ${terminalSafe(choice.label)}${recommended}`)
    if (choice.description) lines.push(`   ${terminalSafe(choice.description)}`)
  })
  if (item.multiple) lines.push('(several may be chosen)')
  return lines
}

/** The model-written card, or action, as terminal lines. */
export function questionLines(question: AgentQuestion): string[] {
  const action = question.question.action
  if (action) {
    return [
      ...terminalSafe(`Needs you: ${action.reason}`).split('\n'),
      ...terminalSafe(action.instructions).split('\n'),
      ...(action.url ? [terminalSafe(action.url)] : []),
    ]
  }
  const items = question.question.questions ?? []
  return items.flatMap((item, index) =>
    itemLines(item, items.length > 1 ? `(${index + 1}/${items.length}) ` : ''),
  )
}

async function promptItem(
  item: AgentQuestionItem,
  prompt: QuestionPrompt,
  signal: AbortSignal,
): Promise<AgentQuestionItemAnswer | null> {
  const count = item.choices.length
  prompt.write(
    item.multiple
      ? 'Choose numbers separated by spaces, o for Other, or s to Skip.'
      : 'Choose a number, o for Other, or s to Skip.',
  )
  while (!signal.aborted) {
    const value = (await prompt.question('Answer: ', signal)).trim()
    if (signal.aborted) return null
    if (value.toLowerCase() === 's') return { kind: 'skip' }
    const numbers = value.split(/[\s,]+/).filter(Boolean)
    const valid =
      numbers.length > 0 &&
      numbers.every((n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= count)
    if (valid && (item.multiple || numbers.length === 1)) {
      return item.multiple
        ? { kind: 'choices', indexes: numbers.map((n) => Number(n) - 1) }
        : { kind: 'choice', index: Number(numbers[0]) - 1 }
    }
    if (value.toLowerCase() === 'o') {
      const text = await prompt.question('Your answer: ', signal)
      if (signal.aborted) return null
      if (text.trim() && text.length <= 4096 && !hasAnswerControl(text))
        return { kind: 'text', text }
      prompt.write('Enter 1–4096 characters without control characters.')
    } else prompt.write('Choose explicit numbers, o, or s; no answer is selected by default.')
  }
  return null
}

/**
 * Uses the chat's sole readline owner. Expiry/EOF never becomes an implicit answer. An action does
 * not hold the turn: it is shown with the command that answers it, and nothing is asked here.
 */
export async function promptForQuestion(
  item: AgentQuestion,
  prompt: QuestionPrompt,
): Promise<AgentQuestionAnswer | null> {
  if (item.question.action) {
    prompt.write(`Action ${item.id}`)
    for (const line of questionLines(item)) prompt.write(line)
    prompt.write(
      `When it is done: bazilion question answer ${item.agentId} ${item.id} --done (or --cannot).`,
    )
    return null
  }
  if (item.expiresAt === null || item.expiresAt <= Date.now()) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, item.expiresAt - Date.now()))
  timer.unref()
  try {
    prompt.write(`Question ${item.id}`)
    const items = item.question.questions ?? []
    const answers: AgentQuestionItemAnswer[] = []
    for (const [index, entry] of items.entries()) {
      for (const line of itemLines(
        entry,
        items.length > 1 ? `(${index + 1}/${items.length}) ` : '',
      ))
        prompt.write(line)
      const answer = await promptItem(entry, prompt, controller.signal)
      if (!answer) return null
      answers.push(answer)
    }
    return { kind: 'answers', answers }
  } catch {
    prompt.write('Question prompt closed or expired. No answer was submitted.')
    return null
  } finally {
    clearTimeout(timer)
  }
}
