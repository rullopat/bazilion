import type { AgentQuestion, AgentQuestionAnswer } from '@bazilion/api-types'
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
/** The model-written prompt and choices as terminal lines, with control characters escaped. */
export function questionLines(item: AgentQuestion): string[] {
  const lines = terminalSafe(item.question.prompt).split('\n')
  item.question.choices.forEach((choice, index) => {
    const recommended = index === item.question.recommendedIndex ? ' (recommended)' : ''
    lines.push(`${index + 1}. ${terminalSafe(choice.label)}${recommended}`)
    if (choice.description) lines.push(`   ${terminalSafe(choice.description)}`)
  })
  return lines
}
/** Uses the chat's sole readline owner. Expiry/EOF never becomes an implicit answer. */
export async function promptForQuestion(
  item: AgentQuestion,
  prompt: QuestionPrompt,
): Promise<AgentQuestionAnswer | null> {
  if (item.expiresAt <= Date.now()) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, item.expiresAt - Date.now()))
  timer.unref()
  try {
    prompt.write(`Question ${item.id}`)
    for (const line of questionLines(item)) prompt.write(line)
    prompt.write('Choose a number, o for Other, or s to Skip.')
    while (!controller.signal.aborted) {
      const value = (await prompt.question('Answer: ', controller.signal)).trim()
      if (controller.signal.aborted) return null
      if (value.toLowerCase() === 's') return { kind: 'skip' }
      if (/^[1-4]$/.test(value) && Number(value) <= item.question.choices.length)
        return { kind: 'choice', index: Number(value) - 1 }
      if (value.toLowerCase() === 'o') {
        const text = await prompt.question('Your answer: ', controller.signal)
        if (controller.signal.aborted) return null
        if (text.trim() && text.length <= 4096 && !hasAnswerControl(text))
          return { kind: 'text', text }
        prompt.write('Enter 1–4096 characters without control characters.')
      } else prompt.write('Choose an explicit number, o, or s; no answer is selected by default.')
    }
    return null
  } catch {
    prompt.write('Question prompt closed or expired. No answer was submitted.')
    return null
  } finally {
    clearTimeout(timer)
  }
}
